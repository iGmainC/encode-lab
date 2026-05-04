use std::{
    collections::HashMap,
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Runtime};
use uuid::Uuid;

use crate::{
    commands::error::{CommandError, CommandResult},
    models::{task::Resolution, TaskConfigPayload, Validate},
    transcode::command_builder::{build_preview_command_args, PreviewCommandOptions},
};

const PREVIEW_CLIP_DURATION_MS: u64 = 6_000;
const PREVIEW_CLIP_LEAD_MS: u64 = 1_000;
const MIN_RENDER_INTERVAL_MS: u64 = 500;

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
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePreviewResponse {
    pub ok: bool,
    pub degraded_from_two_pass: bool,
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
    pub media_path: Option<String>,
    pub media_kind: PreviewMediaKind,
    pub image_path: Option<String>,
    pub base64: Option<String>,
    pub clip_start_ms: u64,
    pub clip_end_ms: u64,
    pub width: u32,
    pub height: u32,
    pub seq: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub enum PreviewMediaKind {
    Video,
    Image,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewStateEvent {
    pub preview_session_id: String,
    pub state: PreviewState,
    pub preview_speed: Option<f64>,
    pub estimated_transcode_speed: Option<f64>,
    pub degraded_from_two_pass: bool,
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
    seq: u64,
    last_render_started_at: Option<Instant>,
}

#[derive(Clone)]
struct RunningPreviewProcess {
    seq: u64,
    child: Arc<Mutex<Option<Child>>>,
}

struct RenderRequest {
    session: PreviewSession,
    should_render: bool,
    delay_ms: u64,
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
        app: AppHandle<R>,
        payload: PreviewConfig,
    ) -> CommandResult<StartPreviewResponse> {
        validate_preview_input(&payload)?;

        let degraded_from_two_pass = payload.task_config_snapshot.video.enable_two_pass;
        let mut session = PreviewSession {
            id: Uuid::new_v4().to_string(),
            config: sanitize_preview_config(payload)?,
            degraded_from_two_pass,
            seq: 1,
            last_render_started_at: None,
        };
        session.last_render_started_at = Some(Instant::now());

        let response = StartPreviewResponse {
            preview_session_id: session.id.clone(),
            degraded_from_two_pass,
        };

        self.sessions
            .lock()
            .map_err(|_| CommandError::new("preview_lock_failed", "preview session lock poisoned"))?
            .insert(session.id.clone(), session.clone());

        if let Err(err) = self.schedule_render(app, session.clone(), PreviewState::Warming) {
            if let Ok(mut sessions) = self.sessions.lock() {
                sessions.remove(&session.id);
            }
            self.cleanup_session_dir(&session.id);
            return Err(err);
        }
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
        };

        if render_request.should_render {
            self.cancel_process(preview_session_id);
            self.schedule_render(app, render_request.session, PreviewState::Updating)?;
        } else {
            self.schedule_deferred_render(app, render_request.session, render_request.delay_ms);
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
        let process = self.spawn_preview_process(&session)?;
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
                    error: None,
                },
            );

            let started = Instant::now();
            let render_result = manager.wait_preview_process(&session, process);

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
                if latest.seq != session.seq {
                    return;
                }

                // 延迟补渲染真正启动时再更新时间戳，避免后续更新继续被同一窗口节流。
                latest.last_render_started_at = Some(Instant::now());
                latest.clone()
            };

            manager.cancel_process(&latest_session.id);
            let _ = manager.schedule_render(app, latest_session, PreviewState::Updating);
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

        let output_path = session_dir.join(format!("clip-{}.mp4", session.seq));
        cleanup_old_preview_media(&session_dir, &output_path);

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

        let clip_start_ms = time_ms.saturating_sub(PREVIEW_CLIP_LEAD_MS);
        let mut args = build_preview_command_args(
            &session.config.task_config_snapshot,
            &session.config.input_file,
            &output_path.to_string_lossy(),
            PreviewCommandOptions {
                start_sec: clip_start_ms as f64 / 1000.0,
                duration_sec: PREVIEW_CLIP_DURATION_MS as f64 / 1000.0,
                render_scale: session.config.render_scale,
            },
        )
        .map_err(|err| CommandError::new("preview_render_failed", err.to_string()))?;

        // 预览命令只在本地执行，loglevel 放在最前，便于失败时直接返回关键错误。
        args.splice(1..1, ["-loglevel".to_string(), "error".to_string()]);

        let child = Command::new("ffmpeg")
            .args(args)
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|err| CommandError::new("preview_render_failed", err.to_string()))?;

        let child_slot = Arc::new(Mutex::new(Some(child)));
        let process = RunningPreviewProcess {
            seq: session.seq,
            child: child_slot.clone(),
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
        let output_path = session_dir.join(format!("clip-{}.mp4", session.seq));

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
                        return Err(CommandError::new("preview_render_failed", stderr));
                    }

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
        let clip_start_ms = time_ms.saturating_sub(PREVIEW_CLIP_LEAD_MS);
        let clip_end_ms = clip_start_ms + PREVIEW_CLIP_DURATION_MS;
        let (width, height) = estimate_dimensions(&session.config);

        Ok(PreviewFrameEvent {
            preview_session_id: session.id.clone(),
            time_ms,
            media_path: Some(output_path.to_string_lossy().to_string()),
            media_kind: PreviewMediaKind::Video,
            image_path: None,
            base64: None,
            clip_start_ms,
            clip_end_ms,
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
    payload.task_config_snapshot.validate()?;
    Ok(payload)
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
        session.degraded_from_two_pass = snapshot.video.enable_two_pass;
        session.config.task_config_snapshot = sanitize_preview_config(PreviewConfig {
            task_config_snapshot: snapshot,
            ..session.config.clone()
        })?
        .task_config_snapshot;
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

    if should_render {
        session.last_render_started_at = Some(now);
    }

    RenderRequest {
        session: session.clone(),
        should_render,
        delay_ms: min_interval_ms.saturating_sub(elapsed_ms),
    }
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

fn cleanup_old_preview_media(session_dir: &Path, active_file: &Path) {
    let entries = match fs::read_dir(session_dir) {
        Ok(value) => value,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let is_preview_media = matches!(
            path.extension().and_then(|value| value.to_str()),
            Some("jpg") | Some("mp4")
        );
        if is_preview_media && path != active_file {
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

    use std::time::{Duration, Instant};

    use super::{
        build_preview_filter, build_render_request, sanitize_preview_config, CompareOrientation,
        PreviewConfig,
    };

    fn payload() -> PreviewConfig {
        PreviewConfig {
            input_file: "/tmp/demo.mp4".to_string(),
            clip_range: None,
            render_scale: 0.5,
            compare_orientation: CompareOrientation::Vertical,
            splitter_position: 0.5,
            time_ms: Some(1200),
            task_config_snapshot: crate::models::TaskConfigPayload {
                name: "preview".to_string(),
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
            seq: 1,
            last_render_started_at: Some(Instant::now()),
        };

        session.seq += 1;
        let request = build_render_request(&mut session, 500);

        assert!(!request.should_render);
        assert_eq!(request.session.seq, 2);
        assert!(request.delay_ms <= 500);
    }

    #[test]
    fn elapsed_render_should_start_immediately() {
        let mut session = super::PreviewSession {
            id: "preview-b".to_string(),
            config: payload(),
            degraded_from_two_pass: false,
            seq: 1,
            last_render_started_at: Some(Instant::now() - Duration::from_millis(600)),
        };

        let request = build_render_request(&mut session, 500);

        assert!(request.should_render);
        assert_eq!(request.delay_ms, 0);
    }
}
