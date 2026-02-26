use crate::{
    commands::error::CommandResult,
    probe::{
        encoder_capability::{probe_encoder_capabilities, EncoderCapabilityResult},
        ffmpeg_probe::{detect_ffmpeg_runtime, FfmpegProbeResult},
    },
};

#[tauri::command]
pub fn detect_ffmpeg() -> CommandResult<FfmpegProbeResult> {
    Ok(detect_ffmpeg_runtime())
}

#[tauri::command]
pub fn list_encoder_capabilities() -> CommandResult<EncoderCapabilityResult> {
    Ok(probe_encoder_capabilities())
}
