use std::{
    collections::HashMap,
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::{Child, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
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
pub struct PinPreviewFrameResponse {
    /** 独立窗口持有的临时帧副本 id。 */
    pub frame_pin_id: String,
    /** 已固定的源图路径。 */
    pub source_image_path: String,
    /** 已固定的预览图路径。 */
    pub preview_image_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleasePreviewFrameResponse {
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
    state: Arc<Mutex<PreviewProcessState>>,
    source_path: PathBuf,
    encoded_path: PathBuf,
    output_path: PathBuf,
}

/** 单次预览渲染的可取消进程状态；三个 FFmpeg 阶段复用同一状态槽。 */
#[derive(Default)]
struct PreviewProcessState {
    /** 当前正在运行的 FFmpeg 子进程。 */
    child: Option<Child>,
    /** 一旦取消即保持为 true，阻止后续阶段继续启动。 */
    canceled: bool,
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
    shutting_down: Arc<AtomicBool>,
}

impl PreviewManager {
    pub fn new(runtime_dir: PathBuf) -> Self {
        cleanup_stale_preview_runtime(&runtime_dir);

        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            processes: Arc::new(Mutex::new(HashMap::new())),
            runtime_dir: Arc::new(Mutex::new(Some(runtime_dir))),
            shutting_down: Arc::new(AtomicBool::new(false)),
        }
    }

    /** 停止全部预览进程并删除本次运行期预览目录。 */
    pub fn shutdown(&self) {
        self.shutting_down.store(true, Ordering::SeqCst);
        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.clear();
        }

        let process_ids = self
            .processes
            .lock()
            .map(|processes| processes.keys().cloned().collect::<Vec<_>>())
            .unwrap_or_default();
        for process_id in process_ids {
            self.cancel_process(&process_id);
        }

        if let Some(preview_dir) = self
            .runtime_dir
            .lock()
            .ok()
            .and_then(|runtime_dir| runtime_dir.clone())
            .map(|runtime_dir| runtime_dir.join("preview"))
        {
            let _ = fs::remove_dir_all(preview_dir);
        }
    }

    pub fn start_session<R: Runtime>(
        &self,
        _app: AppHandle<R>,
        payload: PreviewConfig,
    ) -> CommandResult<StartPreviewResponse> {
        self.ensure_running()?;
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
        self.ensure_running()?;
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

    /** 为独立窗口复制一对受控临时帧，避免主 session 清理后路径失效。 */
    pub fn pin_frame(
        &self,
        source_image_path: &str,
        preview_image_path: &str,
    ) -> CommandResult<PinPreviewFrameResponse> {
        self.ensure_running()?;
        let preview_root = self.preview_runtime_dir()?;
        let source_path = validate_preview_frame_path(&preview_root, source_image_path)?;
        let preview_path = validate_preview_frame_path(&preview_root, preview_image_path)?;
        let frame_pin_id = Uuid::new_v4().to_string();
        let pin_dir = preview_root.join("pins").join(&frame_pin_id);
        fs::create_dir_all(&pin_dir)
            .map_err(|err| CommandError::new("preview_pin_failed", err.to_string()))?;
        let pinned_source_path = pin_dir.join("source.png");
        let pinned_preview_path = pin_dir.join("preview.png");

        let copy_result = (|| {
            fs::copy(&source_path, &pinned_source_path)
                .map_err(|err| CommandError::new("preview_pin_failed", err.to_string()))?;
            fs::copy(&preview_path, &pinned_preview_path)
                .map_err(|err| CommandError::new("preview_pin_failed", err.to_string()))?;
            Ok::<(), CommandError>(())
        })();
        if let Err(error) = copy_result {
            let _ = fs::remove_dir_all(pin_dir);
            return Err(error);
        }

        Ok(PinPreviewFrameResponse {
            frame_pin_id,
            source_image_path: pinned_source_path.to_string_lossy().to_string(),
            preview_image_path: pinned_preview_path.to_string_lossy().to_string(),
        })
    }

    /** 释放独立窗口不再使用的临时帧副本；重复释放保持幂等。 */
    pub fn release_frame_pin(
        &self,
        frame_pin_id: &str,
    ) -> CommandResult<ReleasePreviewFrameResponse> {
        Uuid::parse_str(frame_pin_id)
            .map_err(|_| CommandError::new("invalid_payload", "framePinId is invalid"))?;
        let pin_dir = self.preview_runtime_dir()?.join("pins").join(frame_pin_id);
        let _ = fs::remove_dir_all(pin_dir);
        Ok(ReleasePreviewFrameResponse { ok: true })
    }

    /** 拒绝在应用退出清理开始后创建或更新预览任务。 */
    fn ensure_running(&self) -> CommandResult<()> {
        if self.shutting_down.load(Ordering::SeqCst) {
            return Err(CommandError::new(
                "preview_shutting_down",
                "preview manager is shutting down",
            ));
        }
        Ok(())
    }

    /** 返回预览运行目录。 */
    fn preview_runtime_dir(&self) -> CommandResult<PathBuf> {
        self.runtime_dir
            .lock()
            .map_err(|_| {
                CommandError::new("preview_runtime_failed", "preview runtime lock poisoned")
            })?
            .clone()
            .map(|runtime_dir| runtime_dir.join("preview"))
            .ok_or_else(|| {
                CommandError::new("preview_runtime_failed", "preview runtime dir missing")
            })
    }

    fn schedule_render<R: Runtime>(
        &self,
        app: AppHandle<R>,
        session: PreviewSession,
        transition: PreviewState,
    ) -> CommandResult<()> {
        self.ensure_running()?;
        let manager = self.clone();
        std::thread::spawn(move || {
            // 源图、编码和解码全部在工作线程启动，Tauri IPC 可立即返回并处理取消/退出。
            let requested_session = session.clone();
            let (session, process) = match manager.spawn_preview_process_with_sdr_fallback(session)
            {
                Ok(result) => result,
                Err(error) => {
                    let latest_seq = manager.sessions.lock().ok().and_then(|sessions| {
                        sessions.get(&requested_session.id).map(|item| item.seq)
                    });
                    if latest_seq == Some(requested_session.seq) {
                        let _ = emit_preview_error(&app, requested_session, error);
                    }
                    return;
                }
            };

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
        self.ensure_running()?;
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

        let is_current_session = self
            .sessions
            .lock()
            .map_err(|_| CommandError::new("preview_lock_failed", "preview session lock poisoned"))?
            .get(&session.id)
            .map(|current| current.seq == session.seq)
            .unwrap_or(false);
        if !is_current_session {
            return Err(preview_cancelled_error());
        }

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
            session.seq,
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

        let process = RunningPreviewProcess {
            seq: session.seq,
            state: Arc::new(Mutex::new(PreviewProcessState::default())),
            source_path: source_path.clone(),
            encoded_path: encoded_path.clone(),
            output_path: output_path.clone(),
        };

        let replaced_process = {
            let sessions = self.sessions.lock().map_err(|_| {
                CommandError::new("preview_lock_failed", "preview session lock poisoned")
            })?;
            let current_seq = sessions.get(&session.id).map(|current| current.seq);
            if current_seq != Some(session.seq) {
                drop(sessions);
                if current_seq.is_none() {
                    // stop 可能发生在首次校验与目录创建之间；此时归还刚重建的空 session 目录。
                    let _ = fs::remove_dir_all(&session_dir);
                }
                return Err(preview_cancelled_error());
            }
            let mut processes = self.processes.lock().map_err(|_| {
                CommandError::new("preview_lock_failed", "preview process lock poisoned")
            })?;
            processes.insert(session.id.clone(), process.clone())
        };
        if let Some(replaced_process) = replaced_process {
            // 并发更新可能交错到达；新渲染接管时必须终止旧管线。
            cancel_running_preview_process(&replaced_process);
        }

        let prepare_result = (|| {
            // 源图用作左侧基准层，也必须纳入 session 取消管理。
            run_tracked_ffmpeg_args(&process, source_args, &source_path)?;

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
            start_tracked_ffmpeg_args(&process, args)
        })();

        if let Err(error) = prepare_result {
            self.remove_process_if_current(&session.id, session.seq);
            cancel_running_preview_process(&process);
            return Err(error);
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

        let render_result = (|| {
            wait_tracked_ffmpeg(&process, &process.encoded_path)?;

            let mut decode_args = build_preview_decode_frame_command_args(
                &process.encoded_path.to_string_lossy(),
                &output_path.to_string_lossy(),
            )
            .map_err(|err| CommandError::new("preview_render_failed", err.to_string()))?;
            decode_args.splice(1..1, ["-loglevel".to_string(), "error".to_string()]);

            // 解码阶段继续复用同一进程状态，stop/update 可以终止完整管线。
            run_tracked_ffmpeg_args(&process, decode_args, &output_path)
        })();

        self.remove_process_if_current(&session.id, session.seq);
        let _ = fs::remove_file(&process.encoded_path);
        if let Err(error) = render_result {
            cleanup_preview_process_files(&process);
            return Err(error);
        }
        // 当前帧交付前保留上一个成功帧，避免 WebView 切换图片时短暂读到失效路径。
        cleanup_old_preview_images(&session_dir, 2);

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
            cancel_running_preview_process(&process);
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

/** 构造统一的预览取消错误。 */
fn preview_cancelled_error() -> CommandError {
    CommandError::new(
        "preview_render_cancelled",
        "preview render process was cancelled",
    )
}

/** 启动一个受 session 生命周期管理的 FFmpeg 阶段。 */
fn start_tracked_ffmpeg_args(
    process: &RunningPreviewProcess,
    args: Vec<String>,
) -> Result<(), CommandError> {
    let mut state = process
        .state
        .lock()
        .map_err(|_| CommandError::new("preview_lock_failed", "preview process lock poisoned"))?;
    if state.canceled {
        return Err(preview_cancelled_error());
    }
    if state.child.is_some() {
        return Err(CommandError::new(
            "preview_process_busy",
            "preview process stage is already running",
        ));
    }

    // 持锁完成 spawn 和登记，确保并发 stop 不会漏过刚启动的子进程。
    let child = ffmpeg_command()
        .args(args)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| CommandError::new("preview_render_failed", err.to_string()))?;
    state.child = Some(child);
    Ok(())
}

/** 等待当前 FFmpeg 阶段完成，并在失败时删除该阶段的不完整输出。 */
fn wait_tracked_ffmpeg(
    process: &RunningPreviewProcess,
    output_path: &Path,
) -> Result<(), CommandError> {
    loop {
        let mut state = process.state.lock().map_err(|_| {
            CommandError::new("preview_lock_failed", "preview process lock poisoned")
        })?;
        if state.canceled {
            return Err(preview_cancelled_error());
        }
        let Some(child) = state.child.as_mut() else {
            return Err(CommandError::new(
                "preview_process_missing",
                "preview process stage is missing",
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
                state.child.take();
                drop(state);

                if !status.success() {
                    let _ = fs::remove_file(output_path);
                    return Err(CommandError::new("preview_render_failed", stderr));
                }
                return Ok(());
            }
            None => {
                drop(state);
                thread::sleep(Duration::from_millis(50));
            }
        }
    }
}

/** 启动并等待一个受控 FFmpeg 阶段。 */
fn run_tracked_ffmpeg_args(
    process: &RunningPreviewProcess,
    args: Vec<String>,
    output_path: &Path,
) -> Result<(), CommandError> {
    start_tracked_ffmpeg_args(process, args)?;
    wait_tracked_ffmpeg(process, output_path)
}

/** 删除单次预览渲染尚未交付给前端的全部文件。 */
fn cleanup_preview_process_files(process: &RunningPreviewProcess) {
    let _ = fs::remove_file(&process.source_path);
    let _ = fs::remove_file(&process.encoded_path);
    let _ = fs::remove_file(&process.output_path);
}

/** 取消单次预览的当前及后续阶段，并回收尚未交付的文件。 */
fn cancel_running_preview_process(process: &RunningPreviewProcess) {
    if let Ok(mut state) = process.state.lock() {
        state.canceled = true;
        if let Some(mut child) = state.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
    cleanup_preview_process_files(process);
}

/** 校验需要固定的帧确实来自受控预览目录，防止复制任意本地文件。 */
fn validate_preview_frame_path(preview_root: &Path, value: &str) -> CommandResult<PathBuf> {
    let canonical_root = fs::canonicalize(preview_root)
        .map_err(|err| CommandError::new("preview_pin_failed", err.to_string()))?;
    let canonical_path = fs::canonicalize(value)
        .map_err(|err| CommandError::new("preview_pin_failed", err.to_string()))?;
    let is_png = canonical_path.extension().and_then(|value| value.to_str()) == Some("png");
    if !canonical_path.starts_with(&canonical_root) || !canonical_path.is_file() || !is_png {
        return Err(CommandError::new(
            "invalid_payload",
            "preview frame must be a PNG inside the preview runtime directory",
        ));
    }
    Ok(canonical_path)
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

fn cleanup_old_preview_media(session_dir: &Path, active_files: &[&Path], active_seq: u64) {
    let entries = match fs::read_dir(session_dir) {
        Ok(value) => value,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let is_preview_media = matches!(
            path.extension().and_then(|value| value.to_str()),
            // 编码中间媒体不对前端暴露；仅当前阶段文件可继续保留。
            Some("mp4") | Some("mkv")
        );
        let belongs_to_newer_render = preview_media_sequence(&path)
            .map(|sequence| sequence > active_seq)
            .unwrap_or(false);
        if is_preview_media
            && !belongs_to_newer_render
            && !active_files.iter().any(|active_file| path == *active_file)
        {
            // 迟到的旧工作线程只能清理自身及更旧文件，不能破坏已启动的新序号渲染。
            let _ = fs::remove_file(path);
        }
    }
}

/** 从 `preview-<seq>.mkv/mp4` 取出中间媒体序号。 */
fn preview_media_sequence(path: &Path) -> Option<u64> {
    if !matches!(
        path.extension().and_then(|value| value.to_str()),
        Some("mp4") | Some("mkv")
    ) {
        return None;
    }
    path.file_stem()?
        .to_str()?
        .strip_prefix("preview-")?
        .parse()
        .ok()
}

/** 仅保留 session 内最近若干个成功帧的源图与预览图。 */
fn cleanup_old_preview_images(session_dir: &Path, retained_frame_count: usize) {
    let entries = match fs::read_dir(session_dir) {
        Ok(value) => value
            .flatten()
            .map(|entry| entry.path())
            .collect::<Vec<_>>(),
        Err(_) => return,
    };
    let mut frame_sequences = entries
        .iter()
        .filter_map(|path| preview_image_sequence(path))
        .collect::<Vec<_>>();
    frame_sequences.sort_unstable_by(|left, right| right.cmp(left));
    frame_sequences.dedup();
    frame_sequences.truncate(retained_frame_count);

    for path in entries {
        let Some(sequence) = preview_image_sequence(&path) else {
            continue;
        };
        if !frame_sequences.contains(&sequence) {
            let _ = fs::remove_file(path);
        }
    }
}

/** 从 `source-<seq>.png` 或 `preview-<seq>.png` 取出帧序号。 */
fn preview_image_sequence(path: &Path) -> Option<u64> {
    if path.extension().and_then(|value| value.to_str()) != Some("png") {
        return None;
    }
    let stem = path.file_stem()?.to_str()?;
    stem.strip_prefix("source-")
        .or_else(|| stem.strip_prefix("preview-"))?
        .parse()
        .ok()
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

    use std::{
        fs,
        sync::{Arc, Mutex},
        time::{Duration, Instant},
    };
    use uuid::Uuid;

    use super::{
        build_preview_filter, build_render_request, cancel_running_preview_process,
        cleanup_old_preview_images, cleanup_old_preview_media,
        ffmpeg_filters_support_preview_sdr_tonemap, is_current_deferred_render,
        preview_error_is_sdr_tonemap_runtime_failure, preview_source_supports_sdr_tonemap,
        resolve_preview_sdr_tonemap_with_support, sanitize_preview_config,
        should_degrade_dolby_vision_preview, should_retry_without_sdr_tonemap,
        should_tone_map_preview_to_sdr, start_tracked_ffmpeg_args, CompareOrientation,
        PreviewConfig, PreviewManager, PreviewProcessState, PreviewSdrTonemapSupport,
        RenderDecision, RunningPreviewProcess,
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

    #[test]
    fn canceled_process_should_reject_followup_stage_and_remove_files() {
        let dir =
            std::env::temp_dir().join(format!("encode-lab-preview-cancel-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).expect("create preview process test directory");
        let source_path = dir.join("source.png");
        let encoded_path = dir.join("preview.mkv");
        let output_path = dir.join("preview.png");
        for path in [&source_path, &encoded_path, &output_path] {
            fs::write(path, b"artifact").expect("write preview process artifact");
        }
        let process = RunningPreviewProcess {
            seq: 1,
            state: Arc::new(Mutex::new(PreviewProcessState::default())),
            source_path: source_path.clone(),
            encoded_path: encoded_path.clone(),
            output_path: output_path.clone(),
        };

        cancel_running_preview_process(&process);
        let error = start_tracked_ffmpeg_args(&process, vec!["-version".to_string()])
            .expect_err("canceled process must reject followup stage");

        assert_eq!(error.code, "preview_render_cancelled");
        assert!(!source_path.exists());
        assert!(!encoded_path.exists());
        assert!(!output_path.exists());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn manager_shutdown_should_remove_preview_runtime() {
        let runtime_dir = std::env::temp_dir().join(format!(
            "encode-lab-preview-shutdown-test-{}",
            Uuid::new_v4()
        ));
        let manager = PreviewManager::new(runtime_dir.clone());
        let session_dir = runtime_dir.join("preview").join("session-a");
        fs::create_dir_all(&session_dir).expect("create preview session directory");
        fs::write(session_dir.join("source.png"), b"preview").expect("write preview artifact");

        manager.shutdown();

        assert!(!runtime_dir.join("preview").exists());
        let _ = fs::remove_dir_all(runtime_dir);
    }

    #[test]
    fn preview_image_cleanup_should_keep_latest_two_successful_frames() {
        let session_dir = std::env::temp_dir().join(format!(
            "encode-lab-preview-retention-test-{}",
            Uuid::new_v4()
        ));
        fs::create_dir_all(&session_dir).expect("create preview retention test directory");
        for sequence in [2, 4, 5] {
            fs::write(
                session_dir.join(format!("source-{sequence}.png")),
                b"source",
            )
            .expect("write source preview frame");
            fs::write(
                session_dir.join(format!("preview-{sequence}.png")),
                b"preview",
            )
            .expect("write encoded preview frame");
        }

        cleanup_old_preview_images(&session_dir, 2);

        assert!(!session_dir.join("source-2.png").exists());
        assert!(!session_dir.join("preview-2.png").exists());
        for sequence in [4, 5] {
            assert!(session_dir.join(format!("source-{sequence}.png")).is_file());
            assert!(session_dir
                .join(format!("preview-{sequence}.png"))
                .is_file());
        }
        let _ = fs::remove_dir_all(session_dir);
    }

    #[test]
    fn stale_preview_cleanup_should_preserve_newer_render_media() {
        let session_dir = std::env::temp_dir().join(format!(
            "encode-lab-preview-media-retention-test-{}",
            Uuid::new_v4()
        ));
        fs::create_dir_all(&session_dir).expect("create preview media retention test directory");
        let active_path = session_dir.join("preview-2.mkv");
        for sequence in [1, 2, 3] {
            fs::write(
                session_dir.join(format!("preview-{sequence}.mkv")),
                b"media",
            )
            .expect("write preview media");
        }

        cleanup_old_preview_media(&session_dir, &[active_path.as_path()], 2);

        assert!(!session_dir.join("preview-1.mkv").exists());
        assert!(active_path.is_file());
        assert!(session_dir.join("preview-3.mkv").is_file());
        let _ = fs::remove_dir_all(session_dir);
    }

    #[test]
    fn pinned_frame_should_survive_session_cleanup_until_release() {
        let runtime_dir =
            std::env::temp_dir().join(format!("encode-lab-preview-pin-test-{}", Uuid::new_v4()));
        let manager = PreviewManager::new(runtime_dir.clone());
        let session_dir = runtime_dir.join("preview").join("session-a");
        fs::create_dir_all(&session_dir).expect("create preview pin test directory");
        let source_path = session_dir.join("source-2.png");
        let preview_path = session_dir.join("preview-2.png");
        fs::write(&source_path, b"source").expect("write source preview frame");
        fs::write(&preview_path, b"preview").expect("write encoded preview frame");

        let pinned = manager
            .pin_frame(
                &source_path.to_string_lossy(),
                &preview_path.to_string_lossy(),
            )
            .expect("pin preview frame");
        fs::remove_dir_all(session_dir).expect("remove original preview session");

        assert!(std::path::Path::new(&pinned.source_image_path).is_file());
        assert!(std::path::Path::new(&pinned.preview_image_path).is_file());
        manager
            .release_frame_pin(&pinned.frame_pin_id)
            .expect("release preview frame pin");
        assert!(!runtime_dir
            .join("preview")
            .join("pins")
            .join(pinned.frame_pin_id)
            .exists());
        let _ = fs::remove_dir_all(runtime_dir);
    }
}
