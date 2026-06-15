use std::{
    collections::HashMap,
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::{Child, Stdio},
    sync::{Arc, Mutex, OnceLock},
    thread,
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Runtime};
use uuid::Uuid;

use crate::{
    commands::error::{CommandError, CommandResult},
    ffmpeg_runtime::ffmpeg_command,
    models::{task::Resolution, FileLocation, TaskConfigPayload, Validate},
    transcode::command_builder::{
        build_preview_decode_frame_command_args, build_preview_encoded_frame_command_args,
        build_source_frame_command_args, PreviewCommandOptions, PreviewSdrTonemapMode,
        PreviewSourceColor,
    },
};

const MIN_RENDER_INTERVAL_MS: u64 = 500;

/** 预览 HDR/DV 转 SDR 的 FFmpeg filter 能力缓存，避免每次拖动时间轴都探测一次。 */
static PREVIEW_SDR_TONEMAP_SUPPORT: OnceLock<PreviewSdrTonemapSupport> = OnceLock::new();

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewClipRange {
    pub start_ms: u64,
    pub end_ms: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewConfig {
    pub input_file: String,
    /** 可选输入节点位置；当前预览执行仍使用 input_file 保持本机兼容。 */
    #[serde(default)]
    pub input_location: Option<FileLocation>,
    /** 源视频 HDR 类型；仅用于决定预览 PNG 是否需要 SDR 映射。 */
    #[serde(default)]
    pub source_hdr_type: Option<String>,
    /** 源视频色彩原色；普通 HDR fallback 映射时传给 zscale 的输入端。 */
    #[serde(default)]
    pub source_color_primaries: Option<String>,
    /** 源视频传递函数；普通 HDR fallback 映射时传给 zscale 的输入端。 */
    #[serde(default)]
    pub source_color_transfer: Option<String>,
    /** 源视频色彩矩阵；普通 HDR fallback 映射时传给 zscale 的输入端。 */
    #[serde(default)]
    pub source_color_space: Option<String>,
    /** 源视频色彩范围；普通 HDR fallback 映射时传给 zscale 的输入端。 */
    #[serde(default)]
    pub source_color_range: Option<String>,
    pub clip_range: Option<PreviewClipRange>,
    pub render_scale: f64,
    pub compare_orientation: CompareOrientation,
    pub splitter_position: f64,
    pub time_ms: Option<u64>,
    pub task_config_snapshot: TaskConfigPayload,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewUpdatePatch {
    pub clip_range: Option<PreviewClipRange>,
    pub render_scale: Option<f64>,
    pub compare_orientation: Option<CompareOrientation>,
    pub splitter_position: Option<f64>,
    pub time_ms: Option<u64>,
    pub task_config_snapshot: Option<TaskConfigPayload>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CompareOrientation {
    Vertical,
    Horizontal,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartPreviewResponse {
    pub preview_session_id: String,
    pub degraded_from_two_pass: bool,
    pub degraded_from_dolby_vision: bool,
    pub degraded_from_sdr_tonemap: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePreviewResponse {
    pub ok: bool,
    pub degraded_from_two_pass: bool,
    pub degraded_from_dolby_vision: bool,
    pub degraded_from_sdr_tonemap: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StopPreviewResponse {
    pub ok: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewFrameEvent {
    pub preview_session_id: String,
    pub time_ms: u64,
    pub source_image_path: Option<String>,
    pub preview_image_path: Option<String>,
    pub width: u32,
    pub height: u32,
    pub seq: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewStateEvent {
    pub preview_session_id: String,
    pub state: PreviewState,
    pub preview_speed: Option<f64>,
    pub estimated_transcode_speed: Option<f64>,
    pub degraded_from_two_pass: bool,
    pub degraded_from_dolby_vision: bool,
    pub degraded_from_sdr_tonemap: bool,
    pub error: Option<PreviewErrorEvent>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewErrorEvent {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PreviewState {
    Idle,
    Warming,
    Running,
    Updating,
    Stopped,
    Error,
}

#[derive(Debug, Clone)]
struct PreviewSession {
    id: String,
    config: PreviewConfig,
    degraded_from_two_pass: bool,
    degraded_from_dolby_vision: bool,
    degraded_from_sdr_tonemap: bool,
    sdr_tonemap_mode: PreviewSdrTonemapMode,
    seq: u64,
    last_render_started_at: Option<Instant>,
    deferred_seq: Option<u64>,
}

#[derive(Debug, Clone, Copy)]
struct PreviewSdrToneMapDecision {
    sdr_tonemap_mode: PreviewSdrTonemapMode,
    degraded_from_sdr_tonemap: bool,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct PreviewSdrTonemapSupport {
    zscale: bool,
    libplacebo: bool,
}

#[derive(Clone)]
struct RunningPreviewProcess {
    seq: u64,
    child: Arc<Mutex<Option<Child>>>,
    encoded_path: PathBuf,
}

struct RenderRequest {
    session: PreviewSession,
    decision: RenderDecision,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum RenderDecision {
    Immediate,
    Deferred { delay_ms: u64 },
}

#[derive(Clone, Default)]
pub struct PreviewManager {
    sessions: Arc<Mutex<HashMap<String, PreviewSession>>>,
    processes: Arc<Mutex<HashMap<String, RunningPreviewProcess>>>,
    runtime_dir: Arc<Mutex<Option<PathBuf>>>,
}

impl PreviewManager {
    pub fn new(runtime_dir: PathBuf) -> Self {
        cleanup_stale_preview_runtime(&runtime_dir);

        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            processes: Arc::new(Mutex::new(HashMap::new())),
            runtime_dir: Arc::new(Mutex::new(Some(runtime_dir))),
        }
    }

    pub fn start_session<R: Runtime>(
        &self,
        _app: AppHandle<R>,
        payload: PreviewConfig,
    ) -> CommandResult<StartPreviewResponse> {
        validate_preview_input(&payload)?;

        let degraded_from_two_pass = payload.task_config_snapshot.video.enable_two_pass;
        let degraded_from_dolby_vision = should_degrade_dolby_vision_preview(&payload);
        let sdr_tonemap = resolve_preview_sdr_tonemap(&payload);
        let session = PreviewSession {
            id: Uuid::new_v4().to_string(),
            config: sanitize_preview_config(payload)?,
            degraded_from_two_pass,
            degraded_from_dolby_vision,
            degraded_from_sdr_tonemap: sdr_tonemap.degraded_from_sdr_tonemap,
            sdr_tonemap_mode: sdr_tonemap.sdr_tonemap_mode,
            seq: 1,
            last_render_started_at: None,
            deferred_seq: None,
        };

        let response = StartPreviewResponse {
            preview_session_id: session.id.clone(),
            degraded_from_two_pass,
            degraded_from_dolby_vision,
            degraded_from_sdr_tonemap: session.degraded_from_sdr_tonemap,
        };

        self.sessions
            .lock()
            .map_err(|_| CommandError::new("preview_lock_failed", "preview session lock poisoned"))?
            .insert(session.id.clone(), session.clone());

        Ok(response)
    }

    pub fn update_session<R: Runtime>(
        &self,
        app: AppHandle<R>,
        preview_session_id: &str,
        patch: PreviewUpdatePatch,
    ) -> CommandResult<UpdatePreviewResponse> {
        let render_request = {
            let mut sessions = self.sessions.lock().map_err(|_| {
                CommandError::new("preview_lock_failed", "preview session lock poisoned")
            })?;
            let session = sessions
                .get_mut(preview_session_id)
                .ok_or_else(|| CommandError::new("not_found", "preview session not found"))?;

            merge_patch(session, patch)?;
            session.seq += 1;
            build_render_request(session, MIN_RENDER_INTERVAL_MS)
        };

        let response = UpdatePreviewResponse {
            ok: true,
            degraded_from_two_pass: render_request.session.degraded_from_two_pass,
            degraded_from_dolby_vision: render_request.session.degraded_from_dolby_vision,
            degraded_from_sdr_tonemap: render_request.session.degraded_from_sdr_tonemap,
        };

        match render_request.decision {
            RenderDecision::Immediate => {
                self.cancel_process(preview_session_id);
                self.schedule_render(app, render_request.session, PreviewState::Updating)?;
            }
            RenderDecision::Deferred { delay_ms } => {
                self.schedule_deferred_render(app, render_request.session, delay_ms);
            }
        }
        Ok(response)
    }

    pub fn stop_session<R: Runtime>(
        &self,
        app: AppHandle<R>,
        preview_session_id: &str,
    ) -> CommandResult<StopPreviewResponse> {
        let removed = self
            .sessions
            .lock()
            .map_err(|_| CommandError::new("preview_lock_failed", "preview session lock poisoned"))?
            .remove(preview_session_id);

        self.cancel_process(preview_session_id);
        self.cleanup_session_dir(preview_session_id);

        if removed.is_none() {
            return Err(CommandError::new("not_found", "preview session not found"));
        }

        let _ = app.emit(
            "preview:state",
            PreviewStateEvent {
                preview_session_id: preview_session_id.to_string(),
                state: PreviewState::Stopped,
                preview_speed: None,
                estimated_transcode_speed: None,
                degraded_from_two_pass: false,
                degraded_from_dolby_vision: false,
                degraded_from_sdr_tonemap: false,
                error: None,
            },
        );

        Ok(StopPreviewResponse { ok: true })
    }

    fn schedule_render<R: Runtime>(
        &self,
        app: AppHandle<R>,
        session: PreviewSession,
        transition: PreviewState,
    ) -> CommandResult<()> {
        let (session, process) = self.spawn_preview_process_with_sdr_fallback(session)?;
        let manager = self.clone();
        std::thread::spawn(move || {
            let _ = app.emit(
                "preview:state",
                PreviewStateEvent {
                    preview_session_id: session.id.clone(),
                    state: transition,
                    preview_speed: None,
                    estimated_transcode_speed: None,
                    degraded_from_two_pass: session.degraded_from_two_pass,
                    degraded_from_dolby_vision: session.degraded_from_dolby_vision,
                    degraded_from_sdr_tonemap: session.degraded_from_sdr_tonemap,
                    error: None,
                },
            );

            let started = Instant::now();
            let (session, render_result) =
                manager.wait_preview_process_with_sdr_fallback(session, process);

            let latest_seq = manager
                .sessions
                .lock()
                .ok()
                .and_then(|sessions| sessions.get(&session.id).map(|item| item.seq));

            if latest_seq != Some(session.seq) {
                return;
            }

            match render_result {
                Ok(frame) => {
                    let elapsed = started.elapsed().as_secs_f64().max(0.001);
                    let speed = 1.0 / elapsed;
                    let _ = app.emit("preview:frame", frame);
                    let _ = app.emit(
                        "preview:state",
                        PreviewStateEvent {
                            preview_session_id: session.id,
                            state: PreviewState::Running,
                            preview_speed: Some(speed),
                            estimated_transcode_speed: Some(speed),
                            degraded_from_two_pass: session.degraded_from_two_pass,
                            degraded_from_dolby_vision: session.degraded_from_dolby_vision,
                            degraded_from_sdr_tonemap: session.degraded_from_sdr_tonemap,
                            error: None,
                        },
                    );
                }
                Err(error) => {
                    let _ = app.emit(
                        "preview:state",
                        PreviewStateEvent {
                            preview_session_id: session.id,
                            state: PreviewState::Error,
                            preview_speed: None,
                            estimated_transcode_speed: None,
                            degraded_from_two_pass: session.degraded_from_two_pass,
                            degraded_from_dolby_vision: session.degraded_from_dolby_vision,
                            degraded_from_sdr_tonemap: session.degraded_from_sdr_tonemap,
                            error: Some(PreviewErrorEvent {
                                code: error.code.clone(),
                                message: error.message.clone(),
                            }),
                        },
                    );
                }
            }
        });

        Ok(())
    }

    /** 启动预览编码进程；如果 SDR 映射在源帧阶段失败，则立即降级后重试一次。 */
    fn spawn_preview_process_with_sdr_fallback(
        &self,
        session: PreviewSession,
    ) -> Result<(PreviewSession, RunningPreviewProcess), CommandError> {
        match self.spawn_preview_process(&session) {
            Ok(process) => Ok((session, process)),
            Err(error) if should_retry_without_sdr_tonemap(&session, &error) => {
                let fallback_session = self.apply_sdr_tonemap_runtime_fallback(&session);
                self.spawn_preview_process(&fallback_session)
                    .map(|process| (fallback_session, process))
            }
            Err(error) => Err(error),
        }
    }

    /** 等待预览编码完成；如果 SDR 映射在编码阶段失败，则降级后重试一次。 */
    fn wait_preview_process_with_sdr_fallback(
        &self,
        session: PreviewSession,
        process: RunningPreviewProcess,
    ) -> (PreviewSession, Result<PreviewFrameEvent, CommandError>) {
        match self.wait_preview_process(&session, process) {
            Ok(frame) => (session, Ok(frame)),
            Err(error) if should_retry_without_sdr_tonemap(&session, &error) => {
                let fallback_session = self.apply_sdr_tonemap_runtime_fallback(&session);
                match self.spawn_preview_process(&fallback_session) {
                    Ok(fallback_process) => {
                        let result = self.wait_preview_process(&fallback_session, fallback_process);
                        (fallback_session, result)
                    }
                    Err(fallback_error) => (fallback_session, Err(fallback_error)),
                }
            }
            Err(error) => (session, Err(error)),
        }
    }

    fn schedule_deferred_render<R: Runtime>(
        &self,
        app: AppHandle<R>,
        session: PreviewSession,
        delay_ms: u64,
    ) {
        let manager = self.clone();

        thread::spawn(move || {
            thread::sleep(Duration::from_millis(delay_ms));

            let latest_session = {
                let mut sessions = match manager.sessions.lock() {
                    Ok(value) => value,
                    Err(_) => return,
                };
                let Some(latest) = sessions.get_mut(&session.id) else {
                    return;
                };
                if !is_current_deferred_render(latest, session.seq) {
                    return;
                }

                // 延迟补渲染真正启动时再更新时间戳，避免后续更新继续被同一窗口节流。
                latest.deferred_seq = None;
                latest.last_render_started_at = Some(Instant::now());
                latest.clone()
            };

            manager.cancel_process(&latest_session.id);
            if let Err(error) =
                manager.schedule_render(app.clone(), latest_session.clone(), PreviewState::Updating)
            {
                let _ = emit_preview_error(&app, latest_session, error);
            }
        });
    }

    fn spawn_preview_process(
        &self,
        session: &PreviewSession,
    ) -> Result<RunningPreviewProcess, CommandError> {
        let runtime_dir = self
            .runtime_dir
            .lock()
            .map_err(|_| {
                CommandError::new("preview_runtime_failed", "preview runtime lock poisoned")
            })?
            .clone()
            .ok_or_else(|| {
                CommandError::new("preview_runtime_failed", "preview runtime dir missing")
            })?;

        let session_dir = runtime_dir.join("preview").join(&session.id);
        fs::create_dir_all(&session_dir)
            .map_err(|err| CommandError::new("preview_runtime_failed", err.to_string()))?;

        let output_path = session_dir.join(format!("preview-{}.png", session.seq));
        let source_path = session_dir.join(format!("source-{}.png", session.seq));
        let encoded_path = session_dir.join(format!("preview-{}.mkv", session.seq));
        cleanup_old_preview_media(
            &session_dir,
            &[
                output_path.as_path(),
                source_path.as_path(),
                encoded_path.as_path(),
            ],
        );

        let time_ms = session
            .config
            .time_ms
            .or_else(|| {
                session
                    .config
                    .clip_range
                    .as_ref()
                    .map(|range| range.start_ms)
            })
            .unwrap_or(0);

        let mut source_args = build_source_frame_command_args(
            &session.config.input_file,
            &source_path.to_string_lossy(),
            PreviewCommandOptions {
                time_sec: time_ms as f64 / 1000.0,
                render_scale: session.config.render_scale,
                sdr_tonemap_mode: session.sdr_tonemap_mode,
                source_color: Some(source_color_from_preview_config(&session.config)),
            },
        )
        .map_err(|err| CommandError::new("preview_render_failed", err.to_string()))?;
        source_args.splice(1..1, ["-loglevel".to_string(), "error".to_string()]);

        // 源图用作左侧基准层，避免 WebView 直接解码用户原始文件失败。
        run_blocking_ffmpeg_args(source_args, &source_path)?;

        let mut args = build_preview_encoded_frame_command_args(
            &session.config.task_config_snapshot,
            &session.config.input_file,
            &encoded_path.to_string_lossy(),
            PreviewCommandOptions {
                time_sec: time_ms as f64 / 1000.0,
                render_scale: session.config.render_scale,
                sdr_tonemap_mode: session.sdr_tonemap_mode,
                source_color: Some(source_color_from_preview_config(&session.config)),
            },
        )
        .map_err(|err| CommandError::new("preview_render_failed", err.to_string()))?;

        // 先编码单帧再解码为 PNG，避免 WebView 播放目标编码格式，同时保留编码质量差异。
        args.splice(1..1, ["-loglevel".to_string(), "error".to_string()]);

        let child = ffmpeg_command()
            .args(args)
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|err| CommandError::new("preview_render_failed", err.to_string()))?;

        let child_slot = Arc::new(Mutex::new(Some(child)));
        let process = RunningPreviewProcess {
            seq: session.seq,
            child: child_slot.clone(),
            encoded_path,
        };

        match self.processes.lock() {
            Ok(mut processes) => {
                processes.insert(session.id.clone(), process.clone());
            }
            Err(_) => {
                if let Ok(mut slot) = child_slot.lock() {
                    if let Some(mut child) = slot.take() {
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                }
                return Err(CommandError::new(
                    "preview_lock_failed",
                    "preview process lock poisoned",
                ));
            }
        }

        Ok(process)
    }

    fn wait_preview_process(
        &self,
        session: &PreviewSession,
        process: RunningPreviewProcess,
    ) -> Result<PreviewFrameEvent, CommandError> {
        let session_dir = self
            .runtime_dir
            .lock()
            .map_err(|_| {
                CommandError::new("preview_runtime_failed", "preview runtime lock poisoned")
            })?
            .clone()
            .ok_or_else(|| {
                CommandError::new("preview_runtime_failed", "preview runtime dir missing")
            })?
            .join("preview")
            .join(&session.id);
        let output_path = session_dir.join(format!("preview-{}.png", session.seq));
        let source_path = session_dir.join(format!("source-{}.png", session.seq));

        loop {
            let mut child_guard = process.child.lock().map_err(|_| {
                CommandError::new("preview_lock_failed", "preview process lock poisoned")
            })?;
            let Some(child) = child_guard.as_mut() else {
                return Err(CommandError::new(
                    "preview_render_cancelled",
                    "preview render process was cancelled",
                ));
            };

            match child
                .try_wait()
                .map_err(|err| CommandError::new("preview_render_failed", err.to_string()))?
            {
                Some(status) => {
                    let mut stderr = String::new();
                    if let Some(mut pipe) = child.stderr.take() {
                        let _ = pipe.read_to_string(&mut stderr);
                    }
                    child_guard.take();
                    drop(child_guard);
                    self.remove_process_if_current(&session.id, session.seq);

                    if !status.success() {
                        let _ = fs::remove_file(&output_path);
                        let _ = fs::remove_file(&process.encoded_path);
                        return Err(CommandError::new("preview_render_failed", stderr));
                    }

                    let mut decode_args = build_preview_decode_frame_command_args(
                        &process.encoded_path.to_string_lossy(),
                        &output_path.to_string_lossy(),
                    )
                    .map_err(|err| CommandError::new("preview_render_failed", err.to_string()))?;
                    decode_args.splice(1..1, ["-loglevel".to_string(), "error".to_string()]);
                    run_blocking_ffmpeg_args(decode_args, &output_path)?;
                    let _ = fs::remove_file(&process.encoded_path);

                    break;
                }
                None => {
                    drop(child_guard);
                    thread::sleep(Duration::from_millis(50));
                }
            }
        }

        let time_ms = session
            .config
            .time_ms
            .or_else(|| {
                session
                    .config
                    .clip_range
                    .as_ref()
                    .map(|range| range.start_ms)
            })
            .unwrap_or(0);
        let (width, height) = estimate_dimensions(&session.config);

        Ok(PreviewFrameEvent {
            preview_session_id: session.id.clone(),
            time_ms,
            source_image_path: Some(source_path.to_string_lossy().to_string()),
            preview_image_path: Some(output_path.to_string_lossy().to_string()),
            width,
            height,
            seq: session.seq,
        })
    }

    fn cancel_process(&self, preview_session_id: &str) {
        let process = self
            .processes
            .lock()
            .ok()
            .and_then(|mut processes| processes.remove(preview_session_id));

        if let Some(process) = process {
            if let Ok(mut child_slot) = process.child.lock() {
                if let Some(mut child) = child_slot.take() {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
        }
    }

    fn remove_process_if_current(&self, preview_session_id: &str, seq: u64) {
        if let Ok(mut processes) = self.processes.lock() {
            if processes
                .get(preview_session_id)
                .map(|process| process.seq == seq)
                .unwrap_or(false)
            {
                processes.remove(preview_session_id);
            }
        }
    }

    fn cleanup_session_dir(&self, preview_session_id: &str) {
        let session_dir = self
            .runtime_dir
            .lock()
            .ok()
            .and_then(|runtime_dir| runtime_dir.clone())
            .map(|runtime_dir| runtime_dir.join("preview").join(preview_session_id));

        if let Some(session_dir) = session_dir {
            let _ = fs::remove_dir_all(session_dir);
        }
    }

    /** 将当前 session 标记为 SDR 映射运行时降级，并同步写回内存态供后续事件复用。 */
    fn apply_sdr_tonemap_runtime_fallback(&self, session: &PreviewSession) -> PreviewSession {
        let mut fallback_session = session.clone();
        fallback_session.sdr_tonemap_mode = PreviewSdrTonemapMode::Disabled;
        fallback_session.degraded_from_sdr_tonemap = true;

        if let Ok(mut sessions) = self.sessions.lock() {
            if let Some(current) = sessions.get_mut(&session.id) {
                if current.seq == session.seq {
                    // 同一 seq 的渲染失败才写回；旧渲染失败不能覆盖用户后续更新。
                    current.sdr_tonemap_mode = PreviewSdrTonemapMode::Disabled;
                    current.degraded_from_sdr_tonemap = true;
                }
            }
        }

        fallback_session
    }
}

fn run_blocking_ffmpeg_args(args: Vec<String>, output_path: &Path) -> Result<(), CommandError> {
    let output = ffmpeg_command()
        .args(args)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .map_err(|err| CommandError::new("preview_render_failed", err.to_string()))?;

    if !output.status.success() {
        let _ = fs::remove_file(output_path);
        return Err(CommandError::new(
            "preview_render_failed",
            String::from_utf8_lossy(&output.stderr).to_string(),
        ));
    }

    Ok(())
}

fn validate_preview_input(payload: &PreviewConfig) -> CommandResult<()> {
    if payload.input_file.trim().is_empty() {
        return Err(CommandError::new(
            "invalid_payload",
            "inputFile cannot be empty",
        ));
    }
    if !Path::new(&payload.input_file).exists() {
        return Err(CommandError::new(
            "not_found",
            "preview input file does not exist",
        ));
    }
    sanitize_preview_config(payload.clone())?;
    Ok(())
}

fn sanitize_preview_config(mut payload: PreviewConfig) -> CommandResult<PreviewConfig> {
    payload.task_config_snapshot.video.enable_two_pass = false;
    payload
        .task_config_snapshot
        .video
        .preserve_dolby_vision_metadata = Some(false);
    payload.task_config_snapshot.validate()?;
    Ok(payload)
}

fn should_degrade_dolby_vision_preview(payload: &PreviewConfig) -> bool {
    payload
        .task_config_snapshot
        .video
        .preserve_dolby_vision_metadata
        .unwrap_or(false)
}

#[cfg(test)]
fn should_tone_map_preview_to_sdr(payload: &PreviewConfig) -> bool {
    if let Some(hdr_type) = normalized_preview_hdr_type(payload) {
        return matches!(hdr_type.as_str(), "hdr10" | "hlg" | "dolbyvision");
    }

    false
}

fn normalized_preview_hdr_type(payload: &PreviewConfig) -> Option<String> {
    payload
        .source_hdr_type
        .as_deref()
        .map(normalize_preview_token)
}

fn normalize_preview_token(value: &str) -> String {
    value
        .chars()
        .filter(|ch| !matches!(ch, '_' | '-' | ' '))
        .collect::<String>()
        .to_ascii_lowercase()
}

#[cfg(test)]
fn preview_source_supports_sdr_tonemap(payload: &PreviewConfig) -> bool {
    // zscale + tonemap 只作为 HDR10/HLG 的普通 HDR fallback；DV 必须交给 libplacebo 读取 RPU。
    matches!(
        normalized_preview_hdr_type(payload).as_deref(),
        Some("hdr10" | "hlg")
    )
}

fn source_color_from_preview_config(payload: &PreviewConfig) -> PreviewSourceColor {
    PreviewSourceColor {
        hdr_type: payload.source_hdr_type.clone(),
        primaries: payload.source_color_primaries.clone(),
        transfer: payload.source_color_transfer.clone(),
        matrix: payload.source_color_space.clone(),
        range: payload.source_color_range.clone(),
    }
}

fn emit_preview_error<R: Runtime>(
    app: &AppHandle<R>,
    session: PreviewSession,
    error: CommandError,
) -> tauri::Result<()> {
    app.emit(
        "preview:state",
        PreviewStateEvent {
            preview_session_id: session.id,
            state: PreviewState::Error,
            preview_speed: None,
            estimated_transcode_speed: None,
            degraded_from_two_pass: session.degraded_from_two_pass,
            degraded_from_dolby_vision: session.degraded_from_dolby_vision,
            degraded_from_sdr_tonemap: session.degraded_from_sdr_tonemap,
            error: Some(PreviewErrorEvent {
                code: error.code,
                message: error.message,
            }),
        },
    )
}

fn ffmpeg_filter_name_from_line(line: &str) -> Option<&str> {
    let trimmed = line.trim_start();
    let marker = trimmed.split_whitespace().next()?;
    // ffmpeg -filters 的有效行以能力标记开头，例如 `.. zscale V->V ...`。
    if marker.len() == 2 || marker.len() == 3 {
        return trimmed.split_whitespace().nth(1);
    }

    None
}

fn resolve_preview_sdr_tonemap(payload: &PreviewConfig) -> PreviewSdrToneMapDecision {
    resolve_preview_sdr_tonemap_with_support(payload, ffmpeg_preview_sdr_tonemap_support())
}

fn resolve_preview_sdr_tonemap_with_support(
    payload: &PreviewConfig,
    support: PreviewSdrTonemapSupport,
) -> PreviewSdrToneMapDecision {
    let Some(hdr_type) = normalized_preview_hdr_type(payload) else {
        return PreviewSdrToneMapDecision {
            sdr_tonemap_mode: PreviewSdrTonemapMode::Disabled,
            degraded_from_sdr_tonemap: false,
        };
    };

    match hdr_type.as_str() {
        "dolbyvision" => resolve_dolby_vision_preview_sdr_tonemap(support),
        "hdr10" | "hlg" => resolve_hdr_preview_sdr_tonemap(support),
        _ => PreviewSdrToneMapDecision {
            sdr_tonemap_mode: PreviewSdrTonemapMode::Disabled,
            degraded_from_sdr_tonemap: false,
        },
    }
}

fn resolve_dolby_vision_preview_sdr_tonemap(
    support: PreviewSdrTonemapSupport,
) -> PreviewSdrToneMapDecision {
    let sdr_tonemap_mode = if support.libplacebo {
        PreviewSdrTonemapMode::Libplacebo
    } else {
        PreviewSdrTonemapMode::Disabled
    };

    PreviewSdrToneMapDecision {
        sdr_tonemap_mode,
        degraded_from_sdr_tonemap: !sdr_tonemap_mode.is_enabled(),
    }
}

fn resolve_hdr_preview_sdr_tonemap(support: PreviewSdrTonemapSupport) -> PreviewSdrToneMapDecision {
    let sdr_tonemap_mode = if support.libplacebo {
        PreviewSdrTonemapMode::Libplacebo
    } else if support.zscale {
        PreviewSdrTonemapMode::Zscale
    } else {
        PreviewSdrTonemapMode::Disabled
    };

    PreviewSdrToneMapDecision {
        sdr_tonemap_mode,
        degraded_from_sdr_tonemap: !sdr_tonemap_mode.is_enabled(),
    }
}

fn ffmpeg_preview_sdr_tonemap_support() -> PreviewSdrTonemapSupport {
    *PREVIEW_SDR_TONEMAP_SUPPORT.get_or_init(|| {
        query_ffmpeg_filters()
            .map(|filters| ffmpeg_filters_support_preview_sdr_tonemap(&filters))
            .unwrap_or_default()
    })
}

fn query_ffmpeg_filters() -> Option<String> {
    let output = ffmpeg_command()
        .arg("-hide_banner")
        .arg("-filters")
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    Some(String::from_utf8_lossy(&output.stdout).to_string())
}

fn ffmpeg_filters_support_preview_sdr_tonemap(filters: &str) -> PreviewSdrTonemapSupport {
    PreviewSdrTonemapSupport {
        zscale: ffmpeg_filter_list_has_filter(filters, "zscale")
            && ffmpeg_filter_list_has_filter(filters, "tonemap"),
        libplacebo: ffmpeg_filter_list_has_filter(filters, "libplacebo"),
    }
}

fn ffmpeg_filter_list_has_filter(filters: &str, name: &str) -> bool {
    filters
        .lines()
        .filter_map(ffmpeg_filter_name_from_line)
        .any(|filter_name| filter_name == name)
}

fn should_retry_without_sdr_tonemap(session: &PreviewSession, error: &CommandError) -> bool {
    session.sdr_tonemap_mode.is_enabled()
        && error.code == "preview_render_failed"
        && preview_error_is_sdr_tonemap_runtime_failure(&error.message)
}

fn preview_error_is_sdr_tonemap_runtime_failure(message: &str) -> bool {
    let normalized = message.to_ascii_lowercase();
    normalized.contains("parsed_zscale")
        || normalized.contains("parsed_tonemap")
        || normalized.contains("parsed_libplacebo")
        || normalized.contains("no path between colorspaces")
        || normalized.contains("error while filtering")
}

fn merge_patch(session: &mut PreviewSession, patch: PreviewUpdatePatch) -> CommandResult<()> {
    if let Some(clip_range) = patch.clip_range {
        session.config.clip_range = Some(clip_range);
    }
    if let Some(render_scale) = patch.render_scale {
        session.config.render_scale = render_scale;
    }
    if let Some(compare_orientation) = patch.compare_orientation {
        session.config.compare_orientation = compare_orientation;
    }
    if let Some(splitter_position) = patch.splitter_position {
        session.config.splitter_position = splitter_position;
    }
    if let Some(time_ms) = patch.time_ms {
        session.config.time_ms = Some(time_ms);
    }
    if let Some(snapshot) = patch.task_config_snapshot {
        let next_config = PreviewConfig {
            task_config_snapshot: snapshot,
            ..session.config.clone()
        };
        let sdr_tonemap = resolve_preview_sdr_tonemap(&next_config);

        session.degraded_from_two_pass = next_config.task_config_snapshot.video.enable_two_pass;
        session.degraded_from_dolby_vision = next_config
            .task_config_snapshot
            .video
            .preserve_dolby_vision_metadata
            .unwrap_or(false);
        session.degraded_from_sdr_tonemap = sdr_tonemap.degraded_from_sdr_tonemap;
        session.sdr_tonemap_mode = sdr_tonemap.sdr_tonemap_mode;
        session.config = sanitize_preview_config(next_config)?;
    }
    Ok(())
}

fn build_render_request(session: &mut PreviewSession, min_interval_ms: u64) -> RenderRequest {
    let now = Instant::now();
    let elapsed_ms = session
        .last_render_started_at
        .map(|started_at| started_at.elapsed().as_millis() as u64)
        .unwrap_or(min_interval_ms);
    let should_render = elapsed_ms >= min_interval_ms;

    let decision = if should_render {
        session.last_render_started_at = Some(now);
        session.deferred_seq = None;
        RenderDecision::Immediate
    } else {
        session.deferred_seq = Some(session.seq);
        RenderDecision::Deferred {
            delay_ms: min_interval_ms.saturating_sub(elapsed_ms),
        }
    };

    RenderRequest {
        session: session.clone(),
        decision,
    }
}

fn is_current_deferred_render(session: &PreviewSession, seq: u64) -> bool {
    session.seq == seq && session.deferred_seq == Some(seq)
}

#[cfg(test)]
fn build_preview_filter(config: &PreviewConfig) -> Option<String> {
    let mut filters = Vec::new();

    if let Some(Resolution { width, height }) = config.task_config_snapshot.video.resolution {
        filters.push(format!("scale={width}:{height}"));
    }

    if (config.render_scale - 1.0).abs() > f64::EPSILON {
        filters.push(format!(
            "scale=trunc(iw*{scale}/2)*2:trunc(ih*{scale}/2)*2",
            scale = config.render_scale
        ));
    }

    if let Some(pixel_format) = &config.task_config_snapshot.video.pixel_format {
        filters.push(format!("format={pixel_format}"));
    }

    if filters.is_empty() {
        None
    } else {
        Some(filters.join(","))
    }
}

fn estimate_dimensions(config: &PreviewConfig) -> (u32, u32) {
    if let Some(Resolution { width, height }) = config.task_config_snapshot.video.resolution {
        return (
            ((width as f64) * config.render_scale).round() as u32,
            ((height as f64) * config.render_scale).round() as u32,
        );
    }
    (0, 0)
}

fn cleanup_old_preview_media(session_dir: &Path, active_files: &[&Path]) {
    let entries = match fs::read_dir(session_dir) {
        Ok(value) => value,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let is_preview_media = matches!(
            path.extension().and_then(|value| value.to_str()),
            // PNG/JPG 可能已被独立预览窗口复用；保留到 session 结束，避免路径失效。
            Some("mp4") | Some("mkv")
        );
        if is_preview_media && !active_files.iter().any(|active_file| path == *active_file) {
            let _ = fs::remove_file(path);
        }
    }
}

fn cleanup_stale_preview_runtime(runtime_dir: &Path) {
    let preview_dir = runtime_dir.join("preview");

    // 应用启动时没有活跃 session，整个预览运行目录都可以安全清空。
    let _ = fs::remove_dir_all(&preview_dir);
    let _ = fs::create_dir_all(preview_dir);
}

#[cfg(test)]
mod tests {
    use crate::models::task::{
        AudioConfig, AudioMode, ContainerConfig, ContainerFormat, OutputConfig, VideoBitrateMode,
        VideoCodecFormat, VideoConfig, VideoEncoder,
    };
    use crate::transcode::command_builder::PreviewSdrTonemapMode;

    use std::time::{Duration, Instant};

    use super::{
        build_preview_filter, build_render_request, ffmpeg_filters_support_preview_sdr_tonemap,
        is_current_deferred_render, preview_error_is_sdr_tonemap_runtime_failure,
        preview_source_supports_sdr_tonemap, resolve_preview_sdr_tonemap_with_support,
        sanitize_preview_config, should_degrade_dolby_vision_preview,
        should_retry_without_sdr_tonemap, should_tone_map_preview_to_sdr, CompareOrientation,
        PreviewConfig, PreviewSdrTonemapSupport, RenderDecision,
    };
    use crate::commands::error::CommandError;

    fn payload() -> PreviewConfig {
        PreviewConfig {
            input_file: "/tmp/demo.mp4".to_string(),
            input_location: None,
            source_hdr_type: None,
            source_color_primaries: None,
            source_color_transfer: None,
            source_color_space: None,
            source_color_range: None,
            clip_range: None,
            render_scale: 0.5,
            compare_orientation: CompareOrientation::Vertical,
            splitter_position: 0.5,
            time_ms: Some(1200),
            task_config_snapshot: crate::models::TaskConfigPayload {
                name: "preview".to_string(),
                clip_range: None,
                video: VideoConfig {
                    codec_format: VideoCodecFormat::H264,
                    encoder: VideoEncoder::Libx264,
                    bitrate_mode: VideoBitrateMode::Crf,
                    crf: Some(23),
                    preset: Some("medium".to_string()),
                    preserve_dolby_vision_metadata: None,
                    profile: None,
                    tune: None,
                    resolution: Some(crate::models::task::Resolution {
                        width: 1920,
                        height: 1080,
                    }),
                    fps: Some(30.0),
                    pixel_format: Some("yuv420p".to_string()),
                    gop: None,
                    enable_two_pass: true,
                },
                audio: AudioConfig {
                    mode: AudioMode::Copy,
                    custom_args: None,
                },
                container: ContainerConfig {
                    format: ContainerFormat::Mp4,
                    faststart: Some(true),
                },
                advanced_args: None,
                output: OutputConfig {
                    dir: String::new(),
                    file_name_pattern: "{inputName}_{taskName}".to_string(),
                    overwrite: "autoRename".to_string(),
                    location: None,
                },
            },
        }
    }

    #[test]
    fn sanitize_preview_should_disable_two_pass() {
        let result = sanitize_preview_config(payload()).expect("preview config");
        assert!(!result.task_config_snapshot.video.enable_two_pass);
    }

    #[test]
    fn sanitize_preview_should_disable_dolby_vision_metadata() {
        let mut value = payload();
        value
            .task_config_snapshot
            .video
            .preserve_dolby_vision_metadata = Some(true);

        let result = sanitize_preview_config(value).expect("preview config");

        assert_eq!(
            result
                .task_config_snapshot
                .video
                .preserve_dolby_vision_metadata,
            Some(false)
        );
    }

    #[test]
    fn preview_dolby_vision_degradation_should_follow_original_request() {
        let mut value = payload();
        value
            .task_config_snapshot
            .video
            .preserve_dolby_vision_metadata = Some(true);

        assert!(should_degrade_dolby_vision_preview(&value));
    }

    #[test]
    fn preview_sdr_tonemap_should_enable_for_hdr_sources() {
        let mut value = payload();

        value.source_hdr_type = Some("DolbyVision".to_string());
        assert!(should_tone_map_preview_to_sdr(&value));

        value.source_hdr_type = Some("Hdr10".to_string());
        assert!(should_tone_map_preview_to_sdr(&value));

        value.source_hdr_type = Some("Sdr".to_string());
        assert!(!should_tone_map_preview_to_sdr(&value));
    }

    #[test]
    fn preview_sdr_tonemap_should_not_follow_dolby_vision_flag_for_sdr_source() {
        let mut value = payload();
        value.source_hdr_type = Some("Sdr".to_string());
        value
            .task_config_snapshot
            .video
            .preserve_dolby_vision_metadata = Some(true);

        assert!(!should_tone_map_preview_to_sdr(&value));
    }

    #[test]
    fn preview_sdr_tonemap_should_not_fallback_to_dolby_vision_flag_without_hdr_type() {
        let mut value = payload();
        value
            .task_config_snapshot
            .video
            .preserve_dolby_vision_metadata = Some(true);

        assert!(!should_tone_map_preview_to_sdr(&value));
    }

    #[test]
    fn preview_sdr_tonemap_should_degrade_dolby_vision_without_libplacebo() {
        let mut value = payload();
        value.source_hdr_type = Some("DolbyVision".to_string());
        value.source_color_primaries = Some("bt2020".to_string());
        value.source_color_transfer = Some("smpte2084".to_string());
        value.source_color_space = Some("bt2020nc".to_string());

        let decision = resolve_preview_sdr_tonemap_with_support(
            &value,
            PreviewSdrTonemapSupport {
                zscale: true,
                libplacebo: false,
            },
        );

        assert!(!preview_source_supports_sdr_tonemap(&value));
        assert_eq!(decision.sdr_tonemap_mode, PreviewSdrTonemapMode::Disabled);
        assert!(decision.degraded_from_sdr_tonemap);
    }

    #[test]
    fn preview_sdr_tonemap_should_use_libplacebo_for_dolby_vision() {
        let mut value = payload();
        value.source_hdr_type = Some("DolbyVision".to_string());

        let decision = resolve_preview_sdr_tonemap_with_support(
            &value,
            PreviewSdrTonemapSupport {
                zscale: true,
                libplacebo: true,
            },
        );

        assert_eq!(decision.sdr_tonemap_mode, PreviewSdrTonemapMode::Libplacebo);
        assert!(!decision.degraded_from_sdr_tonemap);
    }

    #[test]
    fn preview_sdr_tonemap_should_use_zscale_for_hdr_when_libplacebo_missing() {
        let mut value = payload();
        value.source_hdr_type = Some("Hdr10".to_string());

        let decision = resolve_preview_sdr_tonemap_with_support(
            &value,
            PreviewSdrTonemapSupport {
                zscale: true,
                libplacebo: false,
            },
        );

        assert!(preview_source_supports_sdr_tonemap(&value));
        assert_eq!(decision.sdr_tonemap_mode, PreviewSdrTonemapMode::Zscale);
        assert!(!decision.degraded_from_sdr_tonemap);
    }

    #[test]
    fn preview_sdr_tonemap_filter_detection_should_require_zscale_and_tonemap() {
        let supported = "\
 .. zscale           V->V       Apply resizing, colorspace and bit depth conversion.
 .S tonemap          V->V       Conversion to/from different dynamic ranges.
";
        let support = ffmpeg_filters_support_preview_sdr_tonemap(supported);
        assert!(support.zscale);
        assert!(!support.libplacebo);

        let missing_zscale = "\
 .S tonemap          V->V       Conversion to/from different dynamic ranges.
 .. scale            V->V       Scale the input video size.
        ";
        assert!(!ffmpeg_filters_support_preview_sdr_tonemap(missing_zscale).zscale);
    }

    #[test]
    fn preview_sdr_tonemap_filter_detection_should_detect_libplacebo() {
        let supported = "\
 .. libplacebo       V->V       Apply GPU-accelerated image processing.
";

        let support = ffmpeg_filters_support_preview_sdr_tonemap(supported);

        assert!(support.libplacebo);
        assert!(!support.zscale);
    }

    #[test]
    fn preview_sdr_tonemap_runtime_error_should_trigger_fallback() {
        let error = "[Parsed_zscale_0 @ 0x123] code 3074: no path between colorspaces";

        assert!(preview_error_is_sdr_tonemap_runtime_failure(error));
    }

    #[test]
    fn preview_sdr_tonemap_fallback_should_only_apply_to_active_tonemap_session() {
        let mut session = super::PreviewSession {
            id: "preview-a".to_string(),
            config: payload(),
            degraded_from_two_pass: false,
            degraded_from_dolby_vision: false,
            degraded_from_sdr_tonemap: false,
            sdr_tonemap_mode: PreviewSdrTonemapMode::Zscale,
            seq: 1,
            last_render_started_at: None,
            deferred_seq: None,
        };
        let error = CommandError::new(
            "preview_render_failed",
            "[Parsed_zscale_0] no path between colorspaces",
        );

        assert!(should_retry_without_sdr_tonemap(&session, &error));

        session.sdr_tonemap_mode = PreviewSdrTonemapMode::Disabled;
        assert!(!should_retry_without_sdr_tonemap(&session, &error));
    }

    #[test]
    fn build_preview_filter_should_include_scale_and_format() {
        let filter = build_preview_filter(&payload()).expect("filter");
        assert!(filter.contains("scale=1920:1080"));
        assert!(filter.contains("trunc(iw*0.5/2)*2"));
        assert!(filter.contains("format=yuv420p"));
    }

    #[test]
    fn throttled_render_should_keep_latest_seq_for_deferred_render() {
        let mut session = super::PreviewSession {
            id: "preview-a".to_string(),
            config: payload(),
            degraded_from_two_pass: false,
            degraded_from_dolby_vision: false,
            degraded_from_sdr_tonemap: false,
            sdr_tonemap_mode: PreviewSdrTonemapMode::Disabled,
            seq: 1,
            last_render_started_at: Some(Instant::now()),
            deferred_seq: None,
        };

        session.seq += 1;
        let request = build_render_request(&mut session, 500);

        assert!(matches!(request.decision, RenderDecision::Deferred { .. }));
        assert_eq!(request.session.seq, 2);
        assert_eq!(request.session.deferred_seq, Some(2));
    }

    #[test]
    fn elapsed_render_should_start_immediately() {
        let mut session = super::PreviewSession {
            id: "preview-b".to_string(),
            config: payload(),
            degraded_from_two_pass: false,
            degraded_from_dolby_vision: false,
            degraded_from_sdr_tonemap: false,
            sdr_tonemap_mode: PreviewSdrTonemapMode::Disabled,
            seq: 1,
            last_render_started_at: Some(Instant::now() - Duration::from_millis(600)),
            deferred_seq: Some(1),
        };

        let request = build_render_request(&mut session, 500);

        assert!(matches!(request.decision, RenderDecision::Immediate));
        assert_eq!(request.session.deferred_seq, None);
    }

    #[test]
    fn newer_deferred_render_should_invalidate_older_seq() {
        let mut session = super::PreviewSession {
            id: "preview-c".to_string(),
            config: payload(),
            degraded_from_two_pass: false,
            degraded_from_dolby_vision: false,
            degraded_from_sdr_tonemap: false,
            sdr_tonemap_mode: PreviewSdrTonemapMode::Disabled,
            seq: 1,
            last_render_started_at: Some(Instant::now()),
            deferred_seq: None,
        };

        session.seq += 1;
        let first = build_render_request(&mut session, 500);
        assert!(matches!(first.decision, RenderDecision::Deferred { .. }));
        assert!(is_current_deferred_render(&session, 2));

        session.seq += 1;
        let second = build_render_request(&mut session, 500);
        assert!(matches!(second.decision, RenderDecision::Deferred { .. }));

        assert!(!is_current_deferred_render(&session, 2));
        assert!(is_current_deferred_render(&session, 3));
    }
}
