use crate::{
    models::{
        task::{AudioMode, ContainerFormat, VideoBitrateMode, VideoCodecFormat, VideoEncoder},
        TaskConfigPayload,
    },
    storage::errors::{StorageError, StorageResult},
};

#[derive(Debug, Clone)]
pub struct CommandBuildOutput {
    pub commands: Vec<String>,
    pub warnings: Vec<String>,
    pub sanitized_advanced_args: Option<String>,
}

pub fn build_ffmpeg_commands(
    payload: &TaskConfigPayload,
    input_file: &str,
    output_file: &str,
) -> StorageResult<CommandBuildOutput> {
    if input_file.trim().is_empty() || output_file.trim().is_empty() {
        return Err(StorageError::InvalidPayload(
            "input/output file cannot be empty".to_string(),
        ));
    }

    guard_advanced_args(payload.advanced_args.as_deref())?;

    let mut warnings = codec_strategy_warnings(payload);
    let sanitized_advanced = sanitize_advanced_args(payload.advanced_args.as_deref(), &mut warnings);

    let commands = if payload.video.enable_two_pass {
        vec![
            build_pass1_command(payload, input_file, sanitized_advanced.as_deref())?,
            build_pass2_command(payload, input_file, output_file, sanitized_advanced.as_deref())?,
        ]
    } else {
        vec![build_single_pass_command(
            payload,
            input_file,
            output_file,
            sanitized_advanced.as_deref(),
        )?]
    };

    Ok(CommandBuildOutput {
        commands,
        warnings,
        sanitized_advanced_args: sanitized_advanced,
    })
}

fn build_single_pass_command(
    payload: &TaskConfigPayload,
    input_file: &str,
    output_file: &str,
    sanitized_advanced: Option<&str>,
) -> StorageResult<String> {
    let mut args = base_input_args(input_file);
    append_video_args(payload, &mut args)?;
    append_audio_args(payload, &mut args)?;
    append_container_args(payload, &mut args);
    append_advanced_args(sanitized_advanced, &mut args);
    args.push(shell_quote(output_file));

    Ok(format!("ffmpeg {}", args.join(" ")))
}

fn build_pass1_command(
    payload: &TaskConfigPayload,
    input_file: &str,
    sanitized_advanced: Option<&str>,
) -> StorageResult<String> {
    let mut args = vec!["-y".to_string()];
    args.extend(base_input_args(input_file));

    append_video_args(payload, &mut args)?;
    append_advanced_args(sanitized_advanced, &mut args);
    args.push("-pass".to_string());
    args.push("1".to_string());
    args.push("-passlogfile".to_string());
    args.push(shell_quote("/tmp/encode-lab/passlog"));
    args.push("-an".to_string());
    args.push("-f".to_string());
    args.push(container_name(&payload.container.format).to_string());
    args.push(shell_quote("/dev/null"));

    Ok(format!("ffmpeg {}", args.join(" ")))
}

fn build_pass2_command(
    payload: &TaskConfigPayload,
    input_file: &str,
    output_file: &str,
    sanitized_advanced: Option<&str>,
) -> StorageResult<String> {
    let mut args = base_input_args(input_file);

    append_video_args(payload, &mut args)?;
    args.push("-pass".to_string());
    args.push("2".to_string());
    args.push("-passlogfile".to_string());
    args.push(shell_quote("/tmp/encode-lab/passlog"));

    append_audio_args(payload, &mut args)?;
    append_container_args(payload, &mut args);
    append_advanced_args(sanitized_advanced, &mut args);
    args.push(shell_quote(output_file));

    Ok(format!("ffmpeg {}", args.join(" ")))
}

fn base_input_args(input_file: &str) -> Vec<String> {
    vec!["-i".to_string(), shell_quote(input_file)]
}

fn append_video_args(payload: &TaskConfigPayload, args: &mut Vec<String>) -> StorageResult<()> {
    let encoder = encoder_name(&payload.video.encoder);
    args.push("-c:v".to_string());
    args.push(encoder.to_string());

    match payload.video.bitrate_mode {
        VideoBitrateMode::Crf => {
            let crf = payload.video.crf.ok_or_else(|| {
                StorageError::InvalidPayload("crf is required for CRF mode".to_string())
            })?;
            args.push("-crf".to_string());
            args.push(crf.to_string());
        }
        VideoBitrateMode::Cbr | VideoBitrateMode::Abr => {
            // V1 未定义结构化目标码率字段，先留给 advancedArgs。
        }
    }

    if let Some(preset) = &payload.video.preset {
        args.push("-preset".to_string());
        args.push(shell_quote(preset));
    }

    if let Some(profile) = &payload.video.profile {
        args.push("-profile:v".to_string());
        args.push(shell_quote(profile));
    }

    if let Some(tune) = &payload.video.tune {
        args.push("-tune".to_string());
        args.push(shell_quote(tune));
    }

    if let Some(resolution) = &payload.video.resolution {
        args.push("-vf".to_string());
        args.push(shell_quote(&format!(
            "scale={}:{}",
            resolution.width, resolution.height
        )));
    }

    if let Some(fps) = payload.video.fps {
        args.push("-r".to_string());
        args.push(fps.to_string());
    }

    if let Some(pixel_format) = &payload.video.pixel_format {
        args.push("-pix_fmt".to_string());
        args.push(shell_quote(pixel_format));
    }

    if let Some(gop) = payload.video.gop {
        args.push("-g".to_string());
        args.push(gop.to_string());
    }

    Ok(())
}

fn append_audio_args(payload: &TaskConfigPayload, args: &mut Vec<String>) -> StorageResult<()> {
    match payload.audio.mode {
        AudioMode::Copy => {
            args.push("-c:a".to_string());
            args.push("copy".to_string());
        }
        AudioMode::Custom => {
            let custom_args = payload.audio.custom_args.as_ref().ok_or_else(|| {
                StorageError::InvalidPayload("audio.customArgs is required".to_string())
            })?;
            args.extend(split_args(custom_args));
        }
    }

    Ok(())
}

fn append_container_args(payload: &TaskConfigPayload, args: &mut Vec<String>) {
    if payload.container.faststart.unwrap_or(false)
        && matches!(payload.container.format, ContainerFormat::Mp4)
    {
        args.push("-movflags".to_string());
        args.push("+faststart".to_string());
    }
}

fn append_advanced_args(sanitized_advanced: Option<&str>, args: &mut Vec<String>) {
    if let Some(extra) = sanitized_advanced {
        args.extend(split_args(extra));
    }
}

fn guard_advanced_args(value: Option<&str>) -> StorageResult<()> {
    let Some(raw) = value else {
        return Ok(());
    };

    let tokens = split_args(raw);
    if tokens.iter().any(|t| t == "-i") {
        return Err(StorageError::InvalidPayload(
            "advancedArgs cannot contain -i".to_string(),
        ));
    }

    Ok(())
}

fn sanitize_advanced_args(raw: Option<&str>, warnings: &mut Vec<String>) -> Option<String> {
    let Some(raw) = raw else {
        return None;
    };

    let tokens = split_args(raw);
    if tokens.is_empty() {
        return None;
    }

    let mut sanitized: Vec<String> = Vec::new();
    let mut i = 0usize;

    while i < tokens.len() {
        let token = &tokens[i];

        if is_structured_conflict_flag(token) {
            warnings.push(format!(
                "advancedArgs 中的 {token} 被忽略（结构化参数优先）"
            ));

            i += 1;
            if i < tokens.len() && !tokens[i].starts_with('-') {
                i += 1;
            }
            continue;
        }

        sanitized.push(token.clone());
        i += 1;
    }

    if sanitized.is_empty() {
        None
    } else {
        Some(sanitized.join(" "))
    }
}

fn codec_strategy_warnings(payload: &TaskConfigPayload) -> Vec<String> {
    let mut warnings = Vec::new();

    if is_hardware_encoder(&payload.video.encoder) {
        warnings.push(
            "当前使用硬件编码器：速度优先，部分质量参数（如 2-pass/CRF）受编码器能力限制".to_string(),
        );
    }

    if matches!(payload.video.codec_format, VideoCodecFormat::Copy) {
        warnings.push("当前视频为 copy 模式：将跳过大部分视频质量参数".to_string());
    }

    if matches!(
        payload.video.bitrate_mode,
        VideoBitrateMode::Cbr | VideoBitrateMode::Abr
    ) {
        warnings.push("当前为 CBR/ABR：视频码率参数来自 advancedArgs（例如 -b:v）".to_string());
    }

    if matches!(payload.video.codec_format, VideoCodecFormat::Av1 | VideoCodecFormat::Vp9)
        && matches!(payload.video.bitrate_mode, VideoBitrateMode::Cbr | VideoBitrateMode::Abr)
    {
        warnings.push(
            "AV1/VP9 当前优先推荐 CRF 路径；CBR/ABR 需通过 advancedArgs 提供完整参数"
                .to_string(),
        );
    }

    warnings
}

fn is_structured_conflict_flag(flag: &str) -> bool {
    matches!(
        flag,
        "-c:v"
            | "-crf"
            | "-preset"
            | "-profile:v"
            | "-tune"
            | "-vf"
            | "-r"
            | "-pix_fmt"
            | "-g"
            | "-c:a"
            | "-movflags"
            | "-pass"
            | "-passlogfile"
    )
}

fn is_hardware_encoder(encoder: &VideoEncoder) -> bool {
    matches!(
        encoder,
        VideoEncoder::H264Videotoolbox
            | VideoEncoder::HevcVideotoolbox
            | VideoEncoder::Av1Videotoolbox
            | VideoEncoder::HevcNvenc
            | VideoEncoder::Av1Nvenc
    )
}

fn split_args(raw: &str) -> Vec<String> {
    raw.split_whitespace().map(ToString::to_string).collect()
}

fn encoder_name(encoder: &VideoEncoder) -> &'static str {
    match encoder {
        VideoEncoder::Libx264 => "libx264",
        VideoEncoder::H264Videotoolbox => "h264_videotoolbox",
        VideoEncoder::Libx265 => "libx265",
        VideoEncoder::HevcVideotoolbox => "hevc_videotoolbox",
        VideoEncoder::HevcNvenc => "hevc_nvenc",
        VideoEncoder::LibaomAv1 => "libaom-av1",
        VideoEncoder::Svtav1 => "svtav1",
        VideoEncoder::Av1Nvenc => "av1_nvenc",
        VideoEncoder::Av1Videotoolbox => "av1_videotoolbox",
        VideoEncoder::LibvpxVp9 => "libvpx-vp9",
        VideoEncoder::Copy => "copy",
    }
}

fn container_name(format: &ContainerFormat) -> &'static str {
    match format {
        ContainerFormat::Mp4 => "mp4",
        ContainerFormat::Mkv => "matroska",
        ContainerFormat::Mov => "mov",
    }
}

fn shell_quote(value: &str) -> String {
    if value.is_empty() {
        return "''".to_string();
    }

    let escaped = value.replace('"', "\\\"");
    format!("\"{escaped}\"")
}

#[cfg(test)]
mod tests {
    use crate::models::task::{
        AudioConfig, AudioMode, ContainerConfig, ContainerFormat, OutputConfig, TaskConfigPayload,
        VideoBitrateMode, VideoCodecFormat, VideoConfig, VideoEncoder,
    };

    use super::build_ffmpeg_commands;

    fn payload() -> TaskConfigPayload {
        TaskConfigPayload {
            name: "demo".to_string(),
            video: VideoConfig {
                codec_format: VideoCodecFormat::H264,
                encoder: VideoEncoder::Libx264,
                bitrate_mode: VideoBitrateMode::Crf,
                crf: Some(23),
                preset: Some("medium".to_string()),
                profile: None,
                tune: None,
                resolution: None,
                fps: None,
                pixel_format: Some("yuv420p".to_string()),
                gop: None,
                enable_two_pass: false,
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
        }
    }

    #[test]
    fn build_single_pass_command_success() {
        let result = build_ffmpeg_commands(&payload(), "input.mp4", "output.mp4").expect("build");
        assert_eq!(result.commands.len(), 1);
        assert!(result.commands[0].contains("-c:v libx264"));
        assert!(result.commands[0].contains("-crf 23"));
        assert!(result.commands[0].contains("-c:a copy"));
        assert!(result.commands[0].contains("-movflags +faststart"));
    }

    #[test]
    fn build_two_pass_commands_success() {
        let mut value = payload();
        value.video.enable_two_pass = true;

        let result = build_ffmpeg_commands(&value, "input.mp4", "output.mp4").expect("build");
        assert_eq!(result.commands.len(), 2);
        assert!(result.commands[0].contains("-pass 1"));
        assert!(result.commands[1].contains("-pass 2"));
        assert!(result.commands[0].contains("/dev/null"));
    }

    #[test]
    fn advanced_args_rejects_input_override() {
        let mut value = payload();
        value.advanced_args = Some("-i hacked.mp4".to_string());

        let err = build_ffmpeg_commands(&value, "input.mp4", "output.mp4")
            .expect_err("should reject");
        assert_eq!(err.code(), "INVALID_PAYLOAD");
    }

    #[test]
    fn structured_conflict_flags_are_removed_and_warned() {
        let mut value = payload();
        value.advanced_args = Some("-crf 18 -preset veryslow -x264-params keyint=120".to_string());

        let result = build_ffmpeg_commands(&value, "input.mp4", "output.mp4").expect("build");
        assert!(result
            .warnings
            .iter()
            .any(|item| item.contains("-crf") && item.contains("结构化参数优先")));
        assert!(result
            .warnings
            .iter()
            .any(|item| item.contains("-preset") && item.contains("结构化参数优先")));

        let cmd = &result.commands[0];
        assert!(cmd.contains("-crf 23"));
        assert!(!cmd.contains("-crf 18"));
        assert!(!cmd.contains("-preset veryslow"));
        assert!(cmd.contains("-x264-params keyint=120"));
    }

    #[test]
    fn av1_vp9_strategy_warnings_exist_for_cbr_abr() {
        let mut value = payload();
        value.video.codec_format = VideoCodecFormat::Av1;
        value.video.encoder = VideoEncoder::LibaomAv1;
        value.video.bitrate_mode = VideoBitrateMode::Cbr;
        value.video.crf = None;

        let result = build_ffmpeg_commands(&value, "input.mp4", "output.mp4").expect("build");
        assert!(result
            .warnings
            .iter()
            .any(|item| item.contains("AV1/VP9") && item.contains("CRF")));
    }

    #[test]
    fn hardware_encoder_warning_exists() {
        let mut value = payload();
        value.video.encoder = VideoEncoder::HevcNvenc;
        value.video.codec_format = VideoCodecFormat::H265;
        value.video.bitrate_mode = VideoBitrateMode::Cbr;
        value.advanced_args = Some("-b:v 2M".to_string());
        value.video.crf = None;

        let result = build_ffmpeg_commands(&value, "input.mp4", "output.mp4").expect("build");
        assert!(result.warnings.iter().any(|item| item.contains("硬件编码器")));
        assert!(result.warnings.iter().any(|item| item.contains("CBR/ABR")));
    }
}
