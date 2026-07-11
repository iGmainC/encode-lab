use std::{
    collections::{HashMap, VecDeque},
    fs,
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};

use chrono::Utc;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Runtime};

use crate::{
    ffmpeg_runtime::{dovi_tool_command, ffmpeg_command},
    mark_open_jobs_on_notification_activate_if_hidden,
    models::JobHistory,
    probe::video_metadata::{read_video_metadata, read_video_track_size_bytes},
    refresh_tray_menu,
    storage::AppStorage,
    transcode::{
        command_builder::build_passlog_path,
        execution_plan::{
            DolbyVisionVerification, ProcessStep, RuntimeProgram, TranscodePlan, TranscodeStep,
        },
    },
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
    /** 入队时已经解析完成的多阶段执行计划。 */
    pub plan: TranscodePlan,
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
    /** 当前阶段的用户可读名称。 */
    pub step_label: String,
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
                request.plan,
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
            notify_job_completed(&app, job);
        }

        self.start_available_jobs(app, storage);
    }
}

/** 在任务成功完成后发送系统通知；通知失败不影响任务历史和后续调度。 */
fn notify_job_completed<R: Runtime>(app: &AppHandle<R>, job: &JobHistory) {
    if job.status != "completed" {
        return;
    }

    let output_name = Path::new(&job.output_file)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(&job.output_file);
    let title = job.name.as_deref().unwrap_or("转码任务");

    // 系统通知属于完成后的附加反馈，权限或平台失败都不能反向影响任务状态。
    mark_open_jobs_on_notification_activate_if_hidden(app);
    show_completed_notification(
        app.clone(),
        format!("{title} 已完成"),
        format!("输出文件：{output_name}"),
    );
}

/** 展示完成通知；Linux 支持监听默认点击，其他桌面平台依赖系统点击激活应用。 */
fn show_completed_notification<R: Runtime>(app: AppHandle<R>, title: String, body: String) {
    tauri::async_runtime::spawn(async move {
        #[cfg(target_os = "linux")]
        {
            show_clickable_completed_notification(app, &title, &body);
        }

        #[cfg(not(target_os = "linux"))]
        {
            let _ = &app;
            let _ = notify_rust::Notification::new()
                .summary(&title)
                .body(&body)
                .auto_icon()
                .show();
        }
    });
}

/** Linux 通知中心会回传 default action，点击后立即通知前端跳转任务中心。 */
#[cfg(target_os = "linux")]
fn show_clickable_completed_notification<R: Runtime>(app: AppHandle<R>, title: &str, body: &str) {
    let Ok(handle) = notify_rust::Notification::new()
        .summary(title)
        .body(body)
        .auto_icon()
        .action("default", "打开任务中心")
        .show()
    else {
        return;
    };

    handle.wait_for_action(|action| {
        if action == "default" {
            crate::show_main_window(&app);
            let _ = app.emit("app:navigate", "/jobs");
        }
    });
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

/** 执行类型化转码计划并返回最终任务状态。 */
fn run_transcode_job<R: Runtime>(
    app: AppHandle<R>,
    storage: AppStorage,
    mut job: JobHistory,
    plan: TranscodePlan,
    duration_sec: Option<f64>,
    child: ChildSlot,
) -> JobHistory {
    if let Some(workspace) = &plan.workspace {
        if let Err(error) = fs::create_dir_all(workspace) {
            job.status = "failed".to_string();
            job.error = Some(format!("创建任务临时目录失败：{error}"));
            job.ended_at = Some(Utc::now().to_rfc3339());
            return job;
        }
    }

    {
        let guard = child.lock().expect("ffmpeg child lock poisoned");
        if guard.canceled {
            job.status = "canceled".to_string();
            job.error = Some("用户取消了任务。".to_string());
            job.ended_at = Some(Utc::now().to_rfc3339());
            cleanup_plan_artifacts(&job, &plan.cleanup_paths);
            return job;
        }

        // 取消命令也需要拿同一把锁；持锁写 running 可避免取消先写 canceled 后又被这里覆盖。
        job.status = "running".to_string();
        job.started_at = Some(Utc::now().to_rfc3339());
        let _ = storage.jobs_history.update(&job);
        let _ = app.emit("job:updated", &job);
        refresh_tray_menu(&app);
    }

    let step_count = plan.steps.len().max(1);
    for (step_index, step) in plan.steps.iter().enumerate() {
        let result = match step {
            TranscodeStep::Process(process) => run_process_step(
                &app,
                &job.id,
                step_index + 1,
                step_count,
                step.label(),
                duration_sec,
                process,
                &child,
            ),
            TranscodeStep::VerifyDolbyVision(verification) => {
                verify_dolby_vision_output(verification).map_err(StepError::Failed)
            }
            TranscodeStep::FinalizeOutput { source, target } => {
                finalize_output(source, target).map_err(StepError::Failed)
            }
        };

        match result {
            Ok(()) => emit_stage_completed(&app, &job.id, step_index + 1, step_count, step.label()),
            Err(StepError::Interrupted) => {
                if child_is_canceled(&child) {
                    job.status = "canceled".to_string();
                    job.error = Some("用户取消了任务。".to_string());
                    cleanup_plan_artifacts(&job, &plan.cleanup_paths);
                } else {
                    job.status = "interrupted".to_string();
                    job.error = Some("转码任务已中断。".to_string());
                }
                break;
            }
            Err(StepError::Failed(message)) => {
                job.status = "failed".to_string();
                job.error = Some(message);
                cleanup_plan_artifacts(&job, &plan.cleanup_paths);
                break;
            }
        }
    }

    if job.status == "running" {
        job.status = "completed".to_string();
        job.error = None;
        attach_size_changes(&mut job);
        cleanup_transient_paths(&plan.cleanup_paths);
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

/** 校验输出容器、DOVI configuration record、RPU 帧数和逐帧语义内容。 */
fn verify_dolby_vision_output(verification: &DolbyVisionVerification) -> Result<(), String> {
    let output_path = verification.output_file.to_string_lossy();
    let metadata = read_video_metadata(&output_path)
        .map_err(|error| format!("读取 Dolby Vision 输出失败：{}", error.message))?;
    let video = metadata
        .video
        .as_ref()
        .ok_or_else(|| "Dolby Vision 输出缺少视频流".to_string())?;

    if video.dolby_vision_profile != Some(verification.expected_profile)
        || video.dolby_vision_compatibility_id != Some(verification.expected_compatibility_id)
        || video.dolby_vision_rpu_present != Some(true)
        || video.dolby_vision_bl_present != Some(true)
        || video.dolby_vision_el_present == Some(true)
    {
        return Err(format!(
            "输出 DOVI 配置不匹配：profile={:?}, compatibility={:?}, rpu={:?}, bl={:?}, el={:?}",
            video.dolby_vision_profile,
            video.dolby_vision_compatibility_id,
            video.dolby_vision_rpu_present,
            video.dolby_vision_bl_present,
            video.dolby_vision_el_present
        ));
    }
    if video.width != Some(verification.expected_width)
        || video.height != Some(verification.expected_height)
        || video.bit_depth.unwrap_or_default() < 10
    {
        return Err(format!(
            "输出画面格式不匹配：{}x{}, bitDepth={:?}",
            video.width.unwrap_or_default(),
            video.height.unwrap_or_default(),
            video.bit_depth
        ));
    }
    if video
        .fps
        .is_none_or(|fps| (fps - verification.expected_fps).abs() > 0.001)
    {
        return Err(format!(
            "输出帧率与源片不一致：source={}, output={:?}",
            verification.expected_fps, video.fps
        ));
    }

    let source_rpu_frames = read_rpu_frame_count(&verification.source_rpu_file)?;
    let output_rpu_frames = read_rpu_frame_count(&verification.output_rpu_file)?;
    if source_rpu_frames != output_rpu_frames {
        return Err(format!(
            "RPU 帧数不一致：source={source_rpu_frames}, output={output_rpu_frames}"
        ));
    }
    if verification
        .expected_frame_count
        .is_some_and(|frames| frames != source_rpu_frames)
    {
        return Err(format!(
            "源视频帧数与 RPU 帧数不一致：video={}, rpu={source_rpu_frames}",
            verification.expected_frame_count.unwrap_or_default()
        ));
    }

    verify_rpu_semantic_equality(
        &verification.source_rpu_json_file,
        &verification.output_rpu_json_file,
    )?;

    Ok(())
}

/** 比较 dovi_tool 导出的逐帧 RPU；忽略重封装时允许变化的 CRC 与扩展块排列。 */
fn verify_rpu_semantic_equality(source_file: &Path, output_file: &Path) -> Result<(), String> {
    let mut source = read_rpu_json(source_file, "源")?;
    let mut output = read_rpu_json(output_file, "输出")?;
    canonicalize_rpu_json(&mut source, None);
    canonicalize_rpu_json(&mut output, None);

    if source != output {
        return Err("输出 RPU 的逐帧动态元数据与源片不一致".to_string());
    }
    Ok(())
}

/** 读取 dovi_tool 导出的完整 RPU JSON。 */
fn read_rpu_json(path: &Path, label: &str) -> Result<Value, String> {
    let contents =
        fs::read_to_string(path).map_err(|error| format!("读取{label} RPU JSON 失败：{error}"))?;
    serde_json::from_str(&contents).map_err(|error| format!("解析{label} RPU JSON 失败：{error}"))
}

/** 规范化不影响 RPU 语义、但可能在 libx265 重写时变化的序列化细节。 */
fn canonicalize_rpu_json(value: &mut Value, parent_key: Option<&str>) {
    match value {
        Value::Object(object) => {
            // CRC 会随扩展块序列化顺序重算，比较其余字段即可证明元数据语义一致。
            object.remove("rpu_data_crc32");
            for (key, child) in object.iter_mut() {
                canonicalize_rpu_json(child, Some(key));
            }
        }
        Value::Array(items) => {
            for item in items.iter_mut() {
                canonicalize_rpu_json(item, None);
            }
            if parent_key == Some("ext_metadata_blocks") {
                items.sort_by_key(extension_block_sort_key);
            }
        }
        _ => {}
    }
}

/** 返回 Level1/Level2 等扩展块的稳定排序键。 */
fn extension_block_sort_key(value: &Value) -> String {
    value
        .as_object()
        .and_then(|object| object.keys().next())
        .cloned()
        .unwrap_or_default()
}

/** 调用固定版本 dovi_tool 读取 RPU summary 中的帧数。 */
fn read_rpu_frame_count(rpu_file: &Path) -> Result<u64, String> {
    let output = dovi_tool_command()
        .args(["info", "--input", &rpu_file.to_string_lossy(), "--summary"])
        .output()
        .map_err(|error| format!("启动 dovi_tool RPU 校验失败：{error}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    if !output.status.success() {
        return Err(format!("dovi_tool RPU 校验失败：{}", tail_text(&stderr)));
    }

    stdout
        .lines()
        .map(str::trim)
        .find_map(|line| line.strip_prefix("Frames:"))
        .and_then(|value| value.trim().parse::<u64>().ok())
        .ok_or_else(|| "dovi_tool summary 缺少 Frames 字段".to_string())
}

/** 校验完成后在同一文件系统内原子发布最终输出。 */
fn finalize_output(source: &Path, target: &Path) -> Result<(), String> {
    if !source.is_file() {
        return Err(format!("待发布输出不存在：{}", source.display()));
    }
    if target.exists() {
        return Err(format!("最终输出已存在：{}", target.display()));
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("创建输出目录失败：{error}"))?;
    }
    fs::rename(source, target).map_err(|error| format!("发布最终输出失败：{error}"))
}

/** 单个执行计划阶段的结果。 */
enum StepError {
    /** 子进程被退出流程或后续取消逻辑中断。 */
    Interrupted,
    /** 外部命令或内部校验执行失败。 */
    Failed(String),
}

/** 执行单个外部工具阶段，并允许其他线程通过 child slot 中断它。 */
fn run_process_step<R: Runtime>(
    app: &AppHandle<R>,
    job_id: &str,
    step_index: usize,
    step_count: usize,
    step_label: &str,
    duration_sec: Option<f64>,
    step: &ProcessStep,
    child_slot: &ChildSlot,
) -> Result<(), StepError> {
    let args = if step.program == RuntimeProgram::Ffmpeg && step.reports_media_progress {
        progress_args(&step.args)
    } else {
        step.args.clone()
    };
    let mut child = runtime_command(step.program)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| StepError::Failed(format!("{} 启动失败：{err}", step.label)))?;
    let stdout_text = Arc::new(Mutex::new(String::new()));
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
    let stdout_reader = child.stdout.take().map(|mut stdout| {
        if step.program == RuntimeProgram::Ffmpeg && step.reports_media_progress {
            let app = app.clone();
            let job_id = job_id.to_string();
            let step_label = step_label.to_string();
            thread::spawn(move || {
                read_progress_output(
                    app,
                    job_id,
                    step_index,
                    step_count,
                    step_label,
                    duration_sec,
                    stdout,
                );
            })
        } else {
            let stdout_text = Arc::clone(&stdout_text);
            thread::spawn(move || {
                let mut text = String::new();
                let _ = stdout.read_to_string(&mut text);
                if let Ok(mut guard) = stdout_text.lock() {
                    *guard = text;
                }
            })
        }
    });

    {
        // child 放入共享槽位后，退出流程即可 kill/wait 当前进程。
        let mut guard = child_slot.lock().expect("ffmpeg child lock poisoned");
        if guard.canceled {
            let _ = child.kill();
            let _ = child.wait();
            return Err(StepError::Interrupted);
        }
        guard.child = Some(child);
    }

    loop {
        let maybe_result = {
            let mut guard = child_slot.lock().expect("ffmpeg child lock poisoned");
            let Some(child) = guard.child.as_mut() else {
                return Err(StepError::Interrupted);
            };

            match child.try_wait() {
                Ok(Some(status)) => {
                    guard.child.take();
                    Some(status.success())
                }
                Ok(None) => None,
                Err(err) => {
                    guard.child.take();
                    return Err(StepError::Failed(err.to_string()));
                }
            }
        };

        if let Some(success) = maybe_result {
            if let Some(reader) = stdout_reader {
                let _ = reader.join();
            }
            if let Some(reader) = stderr_reader {
                let _ = reader.join();
            }
            let stderr = stderr_text
                .lock()
                .map(|text| text.clone())
                .unwrap_or_default();
            let stdout = stdout_text
                .lock()
                .map(|text| text.clone())
                .unwrap_or_default();
            return if success {
                Ok(())
            } else {
                let details = if stderr.trim().is_empty() {
                    tail_text(&stdout)
                } else {
                    tail_text(&stderr)
                };
                Err(StepError::Failed(format!("{}失败：{details}", step.label)))
            };
        }

        thread::sleep(Duration::from_millis(100));
    }
}

/** 为执行计划选择 bundled runtime 程序。 */
fn runtime_command(program: RuntimeProgram) -> Command {
    match program {
        RuntimeProgram::Ffmpeg => ffmpeg_command(),
        RuntimeProgram::DoviTool => dovi_tool_command(),
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
    step_label: String,
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
                &step_label,
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
    step_label: &str,
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
            step_label: step_label.to_string(),
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

/** 非媒体阶段完成后也推进总体进度，避免 RPU/校验阶段看起来停住。 */
fn emit_stage_completed<R: Runtime>(
    app: &AppHandle<R>,
    job_id: &str,
    step_index: usize,
    step_count: usize,
    step_label: &str,
) {
    let _ = app.emit(
        "job:metrics",
        JobMetricsEvent {
            job_id: job_id.to_string(),
            step_index,
            step_count,
            step_label: step_label.to_string(),
            time_ms: None,
            frame: None,
            fps: None,
            speed: None,
            progress: Some((step_index as f64 / step_count.max(1) as f64) * 100.0),
            eta_sec: None,
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

/** 清理普通任务产物和执行计划声明的 workspace/partial 文件。 */
fn cleanup_plan_artifacts(job: &JobHistory, cleanup_paths: &[PathBuf]) {
    cleanup_job_artifacts(job);
    cleanup_transient_paths(cleanup_paths);
}

/** 清理计划临时路径；目录递归删除，普通文件按存在性删除。 */
fn cleanup_transient_paths(cleanup_paths: &[PathBuf]) {
    for path in cleanup_paths {
        if path.is_dir() {
            let _ = fs::remove_dir_all(path);
        } else {
            remove_file_if_exists(path);
        }
    }
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

#[cfg(test)]
mod tests {
    use super::canonicalize_rpu_json;
    use serde_json::json;

    #[test]
    fn rpu_canonicalization_should_ignore_crc_and_extension_block_order() {
        let mut source = json!([{
            "rpu_data_crc32": 1,
            "vdr_dm_data": {
                "cmv29_metadata": {
                    "ext_metadata_blocks": [{"Level5": {"top": 0}}, {"Level1": {"max": 10}}]
                }
            }
        }]);
        let mut output = json!([{
            "rpu_data_crc32": 2,
            "vdr_dm_data": {
                "cmv29_metadata": {
                    "ext_metadata_blocks": [{"Level1": {"max": 10}}, {"Level5": {"top": 0}}]
                }
            }
        }]);

        canonicalize_rpu_json(&mut source, None);
        canonicalize_rpu_json(&mut output, None);
        assert_eq!(source, output);
    }
}
