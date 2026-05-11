use std::{
    collections::{HashMap, VecDeque},
    fs,
    io::{BufRead, BufReader, Read},
    path::Path,
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};

use chrono::Utc;
use tauri::{AppHandle, Emitter, Runtime};

use crate::{
    models::JobHistory, probe::video_metadata::read_video_track_size_bytes, refresh_tray_menu,
    storage::AppStorage, transcode::command_builder::build_passlog_path,
};

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
    /** 输入视频总时长，单位秒；未知时只上报瞬时指标。 */
    pub duration_sec: Option<f64>,
}

/** 任务运行指标事件。 */
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobMetricsEvent {
    /** 任务 id。 */
    pub job_id: String,
    /** 当前执行阶段，从 1 开始；2-pass 时为 1 或 2。 */
    pub step_index: usize,
    /** 总阶段数。 */
    pub step_count: usize,
    /** 当前已处理媒体时间，单位毫秒。 */
    pub time_ms: Option<u64>,
    /** 当前帧号。 */
    pub frame: Option<u64>,
    /** 当前 fps。 */
    pub fps: Option<f64>,
    /** 当前 speed 倍速。 */
    pub speed: Option<f64>,
    /** 总体进度，范围 0..=100；时长未知时为空。 */
    pub progress: Option<f64>,
    /** 预计剩余秒数；时长或 speed 未知时为空。 */
    pub eta_sec: Option<f64>,
    /** 更新时间。 */
    pub updated_at: String,
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

    /** 取消指定任务；支持等待队列和运行中的 FFmpeg 子进程。 */
    pub fn cancel_job<R: Runtime>(
        &self,
        app: AppHandle<R>,
        storage: AppStorage,
        job_id: &str,
    ) -> bool {
        let cancel_target = {
            let mut inner = self.inner.lock().expect("transcode manager lock poisoned");

            if let Some(index) = inner
                .queue
                .iter()
                .position(|request| request.job.id == job_id)
            {
                // 等待队列任务尚未启动，直接移除即可释放队列位置。
                inner.queue.remove(index).map(CancelTarget::Queued)
            } else {
                inner.running.get(job_id).map(|running| {
                    // 运行中任务保留在 running 表里，等执行线程收敛后统一释放槽位。
                    CancelTarget::Running {
                        job: running.job.clone(),
                        child: Arc::clone(&running.child),
                    }
                })
            }
        };

        let Some(cancel_target) = cancel_target else {
            return false;
        };

        match cancel_target {
            CancelTarget::Queued(request) => {
                let mut job = request.job;
                mark_canceled(&app, &storage, &mut job, "用户取消了排队中的任务。");
            }
            CancelTarget::Running { mut job, child } => {
                {
                    let mut guard = child.lock().expect("ffmpeg child lock poisoned");
                    guard.canceled = true;
                    if let Some(mut child) = guard.child.take() {
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                }
                mark_canceled(&app, &storage, &mut job, "用户取消了运行中的任务。");
            }
        }

        self.start_available_jobs(app, storage);
        true
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
                request.duration_sec,
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
            refresh_tray_menu(&app);
        }

        self.start_available_jobs(app, storage);
    }
}

/** 取消目标，区分排队任务和运行任务。 */
enum CancelTarget {
    /** 还在 FIFO 队列里的任务。 */
    Queued(TranscodeJobRequest),
    /** 已经占用槽位并可能持有 FFmpeg 子进程的任务。 */
    Running {
        /** 取消时的任务快照。 */
        job: JobHistory,
        /** 正在运行的 FFmpeg child slot。 */
        child: ChildSlot,
    },
}

/** 执行 FFmpeg 命令并返回最终任务状态。 */
fn run_transcode_job<R: Runtime>(
    app: AppHandle<R>,
    storage: AppStorage,
    mut job: JobHistory,
    command_args: Vec<Vec<String>>,
    duration_sec: Option<f64>,
    child: ChildSlot,
) -> JobHistory {
    {
        let guard = child.lock().expect("ffmpeg child lock poisoned");
        if guard.canceled {
            job.status = "canceled".to_string();
            job.error = Some("用户取消了任务。".to_string());
            job.ended_at = Some(Utc::now().to_rfc3339());
            cleanup_job_artifacts(&job);
            return job;
        }

        // 取消命令也需要拿同一把锁；持锁写 running 可避免取消先写 canceled 后又被这里覆盖。
        job.status = "running".to_string();
        job.started_at = Some(Utc::now().to_rfc3339());
        let _ = storage.jobs_history.update(&job);
        let _ = app.emit("job:updated", &job);
        refresh_tray_menu(&app);
    }

    let step_count = command_args.len().max(1);
    for (step_index, args) in command_args.into_iter().enumerate() {
        match run_ffmpeg_step(
            &app,
            &job.id,
            step_index + 1,
            step_count,
            duration_sec,
            &args,
            &child,
        ) {
            Ok(()) => {}
            Err(FfmpegStepError::Interrupted) => {
                if child_is_canceled(&child) {
                    job.status = "canceled".to_string();
                    job.error = Some("用户取消了任务。".to_string());
                    cleanup_job_artifacts(&job);
                } else {
                    job.status = "interrupted".to_string();
                    job.error = Some("转码任务已中断。".to_string());
                }
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
        attach_size_changes(&mut job);
    }

    job.ended_at = Some(Utc::now().to_rfc3339());
    job
}

/** 在任务成功后记录容器文件与视频轨道的体积变化率。 */
fn attach_size_changes(job: &mut JobHistory) {
    let Some(input_size) = file_size_bytes(Path::new(&job.input_file)) else {
        return;
    };
    let Some(output_size) = file_size_bytes(Path::new(&job.output_file)) else {
        return;
    };

    job.input_size_bytes = Some(input_size);
    job.output_size_bytes = Some(output_size);

    if input_size > 0 {
        // 变化率以输入文件为基准，正数表示输出更大，负数表示输出更小。
        job.size_change_percent =
            Some(((output_size as f64 - input_size as f64) / input_size as f64) * 100.0);
    }

    attach_video_track_size_change(job);
}

/** 读取普通文件体积；目录、不存在或权限失败时返回空值。 */
fn file_size_bytes(path: &Path) -> Option<u64> {
    let metadata = fs::metadata(path).ok()?;
    metadata.is_file().then_some(metadata.len())
}

/** 记录视频轨道体积变化；无法读取时保持为空，不影响任务成功状态。 */
fn attach_video_track_size_change(job: &mut JobHistory) {
    let Ok(input_video_size) = read_video_track_size_bytes(&job.input_file) else {
        return;
    };
    let Ok(output_video_size) = read_video_track_size_bytes(&job.output_file) else {
        return;
    };

    job.input_video_size_bytes = Some(input_video_size);
    job.output_video_size_bytes = Some(output_video_size);

    if input_video_size > 0 {
        // 视频轨道变化只比较视频流，不把音频、字幕和容器开销计入。
        job.video_size_change_percent = Some(
            ((output_video_size as f64 - input_video_size as f64) / input_video_size as f64)
                * 100.0,
        );
    }
}

/** 单段 FFmpeg 执行结果。 */
enum FfmpegStepError {
    /** 子进程被退出流程或后续取消逻辑中断。 */
    Interrupted,
    /** FFmpeg 启动或执行失败。 */
    Failed(String),
}

/** 执行单段 FFmpeg，并允许其他线程通过 child slot 中断它。 */
fn run_ffmpeg_step<R: Runtime>(
    app: &AppHandle<R>,
    job_id: &str,
    step_index: usize,
    step_count: usize,
    duration_sec: Option<f64>,
    args: &[String],
    child_slot: &ChildSlot,
) -> Result<(), FfmpegStepError> {
    let mut child = Command::new("ffmpeg")
        .args(progress_args(args))
        .stdout(Stdio::piped())
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
    let progress_reader = child.stdout.take().map(|stdout| {
        let app = app.clone();
        let job_id = job_id.to_string();
        thread::spawn(move || {
            read_progress_output(app, job_id, step_index, step_count, duration_sec, stdout);
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
            if let Some(reader) = progress_reader {
                let _ = reader.join();
            }
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

/** 给正式转码命令注入 FFmpeg 机器可读进度输出参数。 */
fn progress_args(args: &[String]) -> Vec<String> {
    let mut next = vec![
        "-progress".to_string(),
        "pipe:1".to_string(),
        "-nostats".to_string(),
    ];
    next.extend(args.iter().cloned());
    next
}

/** 读取 FFmpeg -progress 输出并推送任务指标事件。 */
fn read_progress_output<R: Runtime>(
    app: AppHandle<R>,
    job_id: String,
    step_index: usize,
    step_count: usize,
    duration_sec: Option<f64>,
    stdout: impl Read,
) {
    let mut snapshot = FfmpegProgressSnapshot::default();
    let reader = BufReader::new(stdout);

    for line in reader.lines().map_while(Result::ok) {
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };

        snapshot.apply(key, value);

        if key == "progress" {
            emit_metrics(
                &app,
                &job_id,
                step_index,
                step_count,
                duration_sec,
                &snapshot,
            );
        }
    }
}

/** 单次 FFmpeg progress 快照。 */
#[derive(Debug, Default)]
struct FfmpegProgressSnapshot {
    /** 当前帧号。 */
    frame: Option<u64>,
    /** 当前 fps。 */
    fps: Option<f64>,
    /** 当前处理媒体时间，单位毫秒。 */
    out_time_ms: Option<u64>,
    /** 当前 speed 倍速。 */
    speed: Option<f64>,
}

impl FfmpegProgressSnapshot {
    /** 应用 FFmpeg progress key/value。 */
    fn apply(&mut self, key: &str, value: &str) {
        match key {
            "frame" => self.frame = value.trim().parse().ok(),
            "fps" => self.fps = parse_progress_f64(value),
            "out_time_ms" => self.out_time_ms = parse_out_time_ms(value),
            "out_time_us" if self.out_time_ms.is_none() => {
                self.out_time_ms = parse_out_time_ms(value)
            }
            "speed" => self.speed = parse_speed(value),
            _ => {}
        }
    }
}

/** 解析 FFmpeg progress 数字。 */
fn parse_progress_f64(value: &str) -> Option<f64> {
    let parsed = value.trim().parse::<f64>().ok()?;
    parsed.is_finite().then_some(parsed)
}

/** 解析 FFmpeg progress 的媒体时间，输入单位为微秒，输出单位为毫秒。 */
fn parse_out_time_ms(value: &str) -> Option<u64> {
    let micros = value.trim().parse::<u64>().ok()?;
    Some(micros / 1000)
}

/** 解析 speed=1.23x。 */
fn parse_speed(value: &str) -> Option<f64> {
    parse_progress_f64(value.trim().trim_end_matches('x'))
}

/** 发送任务指标事件。 */
fn emit_metrics<R: Runtime>(
    app: &AppHandle<R>,
    job_id: &str,
    step_index: usize,
    step_count: usize,
    duration_sec: Option<f64>,
    snapshot: &FfmpegProgressSnapshot,
) {
    let progress = calculate_progress(duration_sec, snapshot.out_time_ms, step_index, step_count);
    let eta_sec = calculate_eta(duration_sec, snapshot.out_time_ms, snapshot.speed);
    let _ = app.emit(
        "job:metrics",
        JobMetricsEvent {
            job_id: job_id.to_string(),
            step_index,
            step_count,
            time_ms: snapshot.out_time_ms,
            frame: snapshot.frame,
            fps: snapshot.fps,
            speed: snapshot.speed,
            progress,
            eta_sec,
            updated_at: Utc::now().to_rfc3339(),
        },
    );
}

/** 计算总体进度；2-pass 时每个阶段按相同权重折算。 */
fn calculate_progress(
    duration_sec: Option<f64>,
    out_time_ms: Option<u64>,
    step_index: usize,
    step_count: usize,
) -> Option<f64> {
    let duration_sec = duration_sec.filter(|value| *value > 0.0)?;
    let processed_sec = out_time_ms? as f64 / 1000.0;
    let step_progress = (processed_sec / duration_sec).clamp(0.0, 1.0);
    let completed_steps = step_index.saturating_sub(1) as f64;
    let total = ((completed_steps + step_progress) / step_count.max(1) as f64) * 100.0;
    Some(total.clamp(0.0, 100.0))
}

/** 根据当前 speed 估算剩余时间。 */
fn calculate_eta(
    duration_sec: Option<f64>,
    out_time_ms: Option<u64>,
    speed: Option<f64>,
) -> Option<f64> {
    let duration_sec = duration_sec.filter(|value| *value > 0.0)?;
    let speed = speed.filter(|value| *value > 0.0)?;
    let remaining = (duration_sec - out_time_ms? as f64 / 1000.0).max(0.0);
    Some(remaining / speed)
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
    refresh_tray_menu(app);
}

/** 将任务标记为用户取消并广播给前端任务列表。 */
fn mark_canceled<R: Runtime>(
    app: &AppHandle<R>,
    storage: &AppStorage,
    job: &mut JobHistory,
    message: &str,
) {
    job.status = "canceled".to_string();
    job.error = Some(message.to_string());
    job.ended_at = Some(Utc::now().to_rfc3339());
    cleanup_job_artifacts(job);
    let _ = storage.jobs_history.update(job);
    let _ = app.emit("job:updated", &*job);
    refresh_tray_menu(app);
}

/** 判断当前任务是否由用户取消触发中断。 */
fn child_is_canceled(child: &ChildSlot) -> bool {
    child.lock().map(|guard| guard.canceled).unwrap_or(false)
}

/** 清理取消任务留下的部分输出和 2-pass passlog 文件。 */
fn cleanup_job_artifacts(job: &JobHistory) {
    remove_file_if_exists(Path::new(&job.output_file));
    cleanup_passlog_files(&build_passlog_path(&job.input_file, &job.output_file));
}

/** 删除存在的普通文件；不存在或目录路径不视为错误。 */
fn remove_file_if_exists(path: &Path) {
    if path.is_file() {
        let _ = fs::remove_file(path);
    }
}

/** 删除 FFmpeg 2-pass 以 passlog 前缀派生出的临时文件。 */
fn cleanup_passlog_files(passlog_path: &str) {
    let path = Path::new(passlog_path);
    remove_file_if_exists(path);

    let Some(parent) = path.parent() else {
        return;
    };
    let Some(prefix) = path.file_name().and_then(|value| value.to_str()) else {
        return;
    };

    let Ok(entries) = fs::read_dir(parent) else {
        return;
    };

    for entry in entries.flatten() {
        let entry_path = entry.path();
        let matches_prefix = entry_path
            .file_name()
            .and_then(|value| value.to_str())
            .map(|name| name.starts_with(prefix))
            .unwrap_or(false);
        if matches_prefix {
            remove_file_if_exists(&entry_path);
        }
    }
}

/** 提取 FFmpeg stderr 尾部，避免把超长日志写入 history。 */
fn tail_text(value: &str) -> String {
    let lines: Vec<&str> = value.lines().rev().take(20).collect();
    lines.into_iter().rev().collect::<Vec<_>>().join("\n")
}
