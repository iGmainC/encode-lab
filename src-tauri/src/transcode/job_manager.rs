use std::{
    collections::{HashMap, VecDeque},
    io::Read,
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};

use chrono::Utc;
use tauri::{AppHandle, Emitter, Runtime};

use crate::{models::JobHistory, storage::AppStorage};

/** FFmpeg 子进程共享槽位，用于退出时从主线程中断后台进程。 */
type ChildSlot = Arc<Mutex<ChildState>>;

/** 当前 FFmpeg child 与提前取消标记。 */
struct ChildState {
    /** 正在运行的 FFmpeg 子进程。 */
    child: Option<Child>,
    /** 退出流程早于 child 创建时，后续 spawn 后要立即中断。 */
    canceled: bool,
}

/** 转码任务执行请求。 */
#[derive(Debug)]
pub struct TranscodeJobRequest {
    /** 入队时已经写入历史记录的任务对象。 */
    pub job: JobHistory,
    /** 可能包含两段式编码的 FFmpeg 参数列表。 */
    pub command_args: Vec<Vec<String>>,
}

/** 正在执行的任务状态。 */
struct RunningJob {
    /** 最近一次已知任务状态，用于退出时回写 interrupted。 */
    job: JobHistory,
    /** 当前正在等待的 FFmpeg child；两段式任务每段执行时会替换。 */
    child: ChildSlot,
}

/** 转码队列内部状态。 */
struct TranscodeManagerInner {
    /** FIFO 等待队列。 */
    queue: VecDeque<TranscodeJobRequest>,
    /** 当前运行中的任务，以 jobId 索引。 */
    running: HashMap<String, RunningJob>,
    /** 全局并发上限，来自 settings.concurrencyN。 */
    concurrency_n: usize,
    /** 应用退出中时停止拉起新任务。 */
    shutting_down: bool,
}

/** 全局转码队列管理器，负责并发槽位、FIFO 调度和退出中断。 */
#[derive(Clone)]
pub struct TranscodeManager {
    inner: Arc<Mutex<TranscodeManagerInner>>,
}

impl TranscodeManager {
    /** 创建默认转码管理器。 */
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(TranscodeManagerInner {
                queue: VecDeque::new(),
                running: HashMap::new(),
                concurrency_n: 1,
                shutting_down: false,
            })),
        }
    }

    /** 入队并按当前并发配置尝试启动任务。 */
    pub fn enqueue<R: Runtime>(
        &self,
        app: AppHandle<R>,
        storage: AppStorage,
        request: TranscodeJobRequest,
        concurrency_n: u8,
    ) {
        {
            let mut inner = self.inner.lock().expect("transcode manager lock poisoned");
            // settings 已做 1..=8 校验；这里仍兜底，避免异常配置导致无槽位。
            inner.concurrency_n = usize::from(concurrency_n.max(1));
            inner.queue.push_back(request);
        }

        self.start_available_jobs(app, storage);
    }

    /** 刷新全局并发配置；增加槽位时会立即调度等待队列。 */
    pub fn update_concurrency<R: Runtime>(
        &self,
        app: AppHandle<R>,
        storage: AppStorage,
        concurrency_n: u8,
    ) {
        {
            let mut inner = self.inner.lock().expect("transcode manager lock poisoned");
            // 降低并发不会抢停已运行任务，只限制后续新任务启动。
            inner.concurrency_n = usize::from(concurrency_n.max(1));
        }

        self.start_available_jobs(app, storage);
    }

    /** 退出应用前中断所有排队和运行中的任务。 */
    pub fn shutdown<R: Runtime>(&self, app: &AppHandle<R>, storage: &AppStorage) {
        let (queued_jobs, running_jobs) = {
            let mut inner = self.inner.lock().expect("transcode manager lock poisoned");
            inner.shutting_down = true;
            let queued_jobs = inner
                .queue
                .drain(..)
                .map(|request| request.job)
                .collect::<Vec<_>>();
            let running_jobs = inner
                .running
                .drain()
                .map(|(_, job)| job)
                .collect::<Vec<_>>();
            (queued_jobs, running_jobs)
        };

        for mut job in queued_jobs {
            mark_interrupted(app, storage, &mut job, "应用退出，排队任务已中断。");
        }

        for mut running in running_jobs {
            // 先终止 FFmpeg child，再回写任务状态，避免退出后留下孤儿进程。
            {
                let mut guard = running.child.lock().expect("ffmpeg child lock poisoned");
                guard.canceled = true;
                if let Some(mut child) = guard.child.take() {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
            mark_interrupted(
                app,
                storage,
                &mut running.job,
                "应用退出，运行中的任务已中断。",
            );
        }
    }

    /** 根据空闲槽位启动 FIFO 队列中的任务。 */
    fn start_available_jobs<R: Runtime>(&self, app: AppHandle<R>, storage: AppStorage) {
        loop {
            let next = {
                let mut inner = self.inner.lock().expect("transcode manager lock poisoned");
                if inner.shutting_down || inner.running.len() >= inner.concurrency_n {
                    return;
                }

                let Some(request) = inner.queue.pop_front() else {
                    return;
                };

                let child = Arc::new(Mutex::new(ChildState {
                    child: None,
                    canceled: false,
                }));
                inner.running.insert(
                    request.job.id.clone(),
                    RunningJob {
                        job: request.job.clone(),
                        child: Arc::clone(&child),
                    },
                );
                (request, child)
            };

            self.spawn_job(app.clone(), storage.clone(), next.0, next.1);
        }
    }

    /** 在后台线程执行一个转码任务。 */
    fn spawn_job<R: Runtime>(
        &self,
        app: AppHandle<R>,
        storage: AppStorage,
        request: TranscodeJobRequest,
        child: ChildSlot,
    ) {
        let manager = self.clone();
        thread::spawn(move || {
            let mut final_job = run_transcode_job(
                app.clone(),
                storage.clone(),
                request.job,
                request.command_args,
                child,
            );
            manager.finish_job(app, storage, &mut final_job);
        });
    }

    /** 任务结束后释放槽位并继续调度等待队列。 */
    fn finish_job<R: Runtime>(&self, app: AppHandle<R>, storage: AppStorage, job: &mut JobHistory) {
        let removed = {
            let mut inner = self.inner.lock().expect("transcode manager lock poisoned");
            inner.running.remove(&job.id).is_some()
        };

        // shutdown 已经抢先回写 interrupted 时，这里避免 completed/failed 再覆盖它。
        if removed {
            let _ = storage.jobs_history.update(job);
            let _ = app.emit("job:updated", &*job);
        }

        self.start_available_jobs(app, storage);
    }
}

/** 执行 FFmpeg 命令并返回最终任务状态。 */
fn run_transcode_job<R: Runtime>(
    app: AppHandle<R>,
    storage: AppStorage,
    mut job: JobHistory,
    command_args: Vec<Vec<String>>,
    child: ChildSlot,
) -> JobHistory {
    job.status = "running".to_string();
    job.started_at = Some(Utc::now().to_rfc3339());
    let _ = storage.jobs_history.update(&job);
    let _ = app.emit("job:updated", &job);

    for args in command_args {
        match run_ffmpeg_step(&args, &child) {
            Ok(()) => {}
            Err(FfmpegStepError::Interrupted) => {
                job.status = "interrupted".to_string();
                job.error = Some("转码任务已中断。".to_string());
                break;
            }
            Err(FfmpegStepError::Failed(message)) => {
                job.status = "failed".to_string();
                job.error = Some(message);
                break;
            }
        }
    }

    if job.status == "running" {
        job.status = "completed".to_string();
        job.error = None;
    }

    job.ended_at = Some(Utc::now().to_rfc3339());
    job
}

/** 单段 FFmpeg 执行结果。 */
enum FfmpegStepError {
    /** 子进程被退出流程或后续取消逻辑中断。 */
    Interrupted,
    /** FFmpeg 启动或执行失败。 */
    Failed(String),
}

/** 执行单段 FFmpeg，并允许其他线程通过 child slot 中断它。 */
fn run_ffmpeg_step(args: &[String], child_slot: &ChildSlot) -> Result<(), FfmpegStepError> {
    let mut child = Command::new("ffmpeg")
        .args(args)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| FfmpegStepError::Failed(err.to_string()))?;
    let stderr_text = Arc::new(Mutex::new(String::new()));
    let stderr_reader = child.stderr.take().map(|mut stderr| {
        let stderr_text = Arc::clone(&stderr_text);
        thread::spawn(move || {
            let mut text = String::new();
            // 持续读取 stderr，避免 FFmpeg 日志填满 pipe 后阻塞进程退出。
            let _ = stderr.read_to_string(&mut text);
            if let Ok(mut guard) = stderr_text.lock() {
                *guard = text;
            }
        })
    });

    {
        // child 放入共享槽位后，退出流程即可 kill/wait 当前进程。
        let mut guard = child_slot.lock().expect("ffmpeg child lock poisoned");
        if guard.canceled {
            let _ = child.kill();
            let _ = child.wait();
            return Err(FfmpegStepError::Interrupted);
        }
        guard.child = Some(child);
    }

    loop {
        let maybe_result = {
            let mut guard = child_slot.lock().expect("ffmpeg child lock poisoned");
            let Some(child) = guard.child.as_mut() else {
                return Err(FfmpegStepError::Interrupted);
            };

            match child.try_wait() {
                Ok(Some(status)) => {
                    guard.child.take();
                    Some(status.success())
                }
                Ok(None) => None,
                Err(err) => {
                    guard.child.take();
                    return Err(FfmpegStepError::Failed(err.to_string()));
                }
            }
        };

        if let Some(success) = maybe_result {
            if let Some(reader) = stderr_reader {
                let _ = reader.join();
            }
            let stderr = stderr_text
                .lock()
                .map(|text| text.clone())
                .unwrap_or_default();
            return if success {
                Ok(())
            } else {
                Err(FfmpegStepError::Failed(tail_text(&stderr)))
            };
        }

        thread::sleep(Duration::from_millis(100));
    }
}

/** 将任务标记为中断并广播给前端任务列表。 */
fn mark_interrupted<R: Runtime>(
    app: &AppHandle<R>,
    storage: &AppStorage,
    job: &mut JobHistory,
    message: &str,
) {
    job.status = "interrupted".to_string();
    job.error = Some(message.to_string());
    job.ended_at = Some(Utc::now().to_rfc3339());
    let _ = storage.jobs_history.update(job);
    let _ = app.emit("job:updated", &*job);
}

/** 提取 FFmpeg stderr 尾部，避免把超长日志写入 history。 */
fn tail_text(value: &str) -> String {
    let lines: Vec<&str> = value.lines().rev().take(20).collect();
    lines.into_iter().rev().collect::<Vec<_>>().join("\n")
}
