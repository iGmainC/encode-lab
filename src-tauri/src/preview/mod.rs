use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::{Arc, Mutex},
    time::Instant,
};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Runtime};
use uuid::Uuid;

use crate::{
    commands::error::{CommandError, CommandResult},
    models::{task::Resolution, TaskConfigPayload, Validate},
};

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
    pub image_path: Option<String>,
    pub base64: Option<String>,
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
}

#[derive(Clone, Default)]
pub struct PreviewManager {
    sessions: Arc<Mutex<HashMap<String, PreviewSession>>>,
    runtime_dir: Arc<Mutex<Option<PathBuf>>>,
}

impl PreviewManager {
    pub fn new(runtime_dir: PathBuf) -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
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
        let session = PreviewSession {
            id: Uuid::new_v4().to_string(),
            config: sanitize_preview_config(payload)?,
            degraded_from_two_pass,
            seq: 1,
        };

        let response = StartPreviewResponse {
            preview_session_id: session.id.clone(),
            degraded_from_two_pass,
        };

        self.sessions
            .lock()
            .map_err(|_| CommandError::new("preview_lock_failed", "preview session lock poisoned"))?
            .insert(session.id.clone(), session.clone());

        self.schedule_render(app, session, PreviewState::Warming);
        Ok(response)
    }

    pub fn update_session<R: Runtime>(
        &self,
        app: AppHandle<R>,
        preview_session_id: &str,
        patch: PreviewUpdatePatch,
    ) -> CommandResult<UpdatePreviewResponse> {
        let session = {
            let mut sessions = self
                .sessions
                .lock()
                .map_err(|_| CommandError::new("preview_lock_failed", "preview session lock poisoned"))?;
            let session = sessions
                .get_mut(preview_session_id)
                .ok_or_else(|| CommandError::new("not_found", "preview session not found"))?;

            merge_patch(session, patch)?;
            session.seq += 1;
            session.clone()
        };

        let response = UpdatePreviewResponse {
            ok: true,
            degraded_from_two_pass: session.degraded_from_two_pass,
        };

        self.schedule_render(app, session, PreviewState::Updating);
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
    ) {
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
            let render_result = manager.render_frame(&session);

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
    }

    fn render_frame(&self, session: &PreviewSession) -> Result<PreviewFrameEvent, CommandError> {
        let runtime_dir = self
            .runtime_dir
            .lock()
            .map_err(|_| CommandError::new("preview_runtime_failed", "preview runtime lock poisoned"))?
            .clone()
            .ok_or_else(|| CommandError::new("preview_runtime_failed", "preview runtime dir missing"))?;

        let session_dir = runtime_dir.join("preview").join(&session.id);
        fs::create_dir_all(&session_dir)
            .map_err(|err| CommandError::new("preview_runtime_failed", err.to_string()))?;

        let output_path = session_dir.join(format!("frame-{}.jpg", session.seq));
        cleanup_old_frames(&session_dir, &output_path);

        let time_ms = session
            .config
            .time_ms
            .or_else(|| session.config.clip_range.as_ref().map(|range| range.start_ms))
            .unwrap_or(0);

        let time_sec = format!("{:.3}", time_ms as f64 / 1000.0);
        let mut args = vec![
            "-y".to_string(),
            "-loglevel".to_string(),
            "error".to_string(),
            "-ss".to_string(),
            time_sec,
            "-i".to_string(),
            session.config.input_file.clone(),
            "-frames:v".to_string(),
            "1".to_string(),
        ];

        if let Some(filter) = build_preview_filter(&session.config) {
            args.push("-vf".to_string());
            args.push(filter);
        }

        args.push("-q:v".to_string());
        args.push("2".to_string());
        args.push(output_path.to_string_lossy().to_string());

        let output = Command::new("ffmpeg")
            .args(args)
            .output()
            .map_err(|err| CommandError::new("preview_render_failed", err.to_string()))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            return Err(CommandError::new("preview_render_failed", stderr));
        }

        let (width, height) = estimate_dimensions(&session.config);
        let image_bytes = fs::read(&output_path)
            .map_err(|err| CommandError::new("preview_frame_read_failed", err.to_string()))?;

        Ok(PreviewFrameEvent {
            preview_session_id: session.id.clone(),
            time_ms,
            image_path: Some(output_path.to_string_lossy().to_string()),
            base64: Some(format!("data:image/jpeg;base64,{}", STANDARD.encode(image_bytes))),
            width,
            height,
            seq: session.seq,
        })
    }
}

fn validate_preview_input(payload: &PreviewConfig) -> CommandResult<()> {
    if payload.input_file.trim().is_empty() {
        return Err(CommandError::new("invalid_payload", "inputFile cannot be empty"));
    }
    if !Path::new(&payload.input_file).exists() {
        return Err(CommandError::new("not_found", "preview input file does not exist"));
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

fn cleanup_old_frames(session_dir: &Path, active_file: &Path) {
    let entries = match fs::read_dir(session_dir) {
        Ok(value) => value,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) == Some("jpg") && path != active_file {
            let _ = fs::remove_file(path);
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::models::task::{
        AudioConfig, AudioMode, ContainerConfig, ContainerFormat, OutputConfig, VideoBitrateMode,
        VideoCodecFormat, VideoConfig, VideoEncoder,
    };

    use super::{build_preview_filter, sanitize_preview_config, CompareOrientation, PreviewConfig};

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
}
