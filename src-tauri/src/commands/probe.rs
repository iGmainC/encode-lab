use crate::{
    commands::error::CommandResult,
    probe::{
        encoder_capability::{probe_encoder_capabilities, EncoderCapabilityResult},
        ffmpeg_probe::{detect_ffmpeg_runtime, FfmpegProbeResult},
        video_metadata::{read_video_metadata as read_video_metadata_impl, VideoMetadataResult},
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

#[tauri::command]
pub fn read_video_metadata(input_file: String) -> CommandResult<VideoMetadataResult> {
    read_video_metadata_impl(&input_file)
}
