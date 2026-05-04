use std::{
    collections::hash_map::DefaultHasher,
    fs,
    hash::{Hash, Hasher},
};

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

/// 预览短片段命令的时间窗口。
pub struct PreviewCommandOptions {
    /// 片段起点，单位秒。
    pub start_sec: f64,
    /// 片段时长，单位秒。
    pub duration_sec: f64,
    /// 渲染缩放比例，取值通常为 0.25-1.0。
    pub render_scale: f64,
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
    let sanitized_advanced =
        sanitize_advanced_args(payload.advanced_args.as_deref(), &mut warnings);

    let passlog_path = if payload.video.enable_two_pass {
        let path = build_passlog_path(input_file, output_file);
        if let Some(parent) = std::path::Path::new(&path).parent() {
            // 2-pass 需要先保证 passlog 父目录存在，否则 FFmpeg 会在第一阶段直接失败。
            fs::create_dir_all(parent)
                .map_err(|err| StorageError::InvalidPayload(err.to_string()))?;
        }
        Some(path)
    } else {
        None
    };

    let command_args = if payload.video.enable_two_pass {
        let passlog_path = passlog_path.as_deref().ok_or_else(|| {
            StorageError::InvalidPayload("passlog path is required for 2-pass".to_string())
        })?;
        vec![
            build_pass1_args(
                payload,
                input_file,
                passlog_path,
                sanitized_advanced.as_deref(),
            )?,
            build_pass2_args(
                payload,
                input_file,
                output_file,
                passlog_path,
                sanitized_advanced.as_deref(),
            )?,
        ]
    } else {
        vec![build_single_pass_args(
            payload,
            input_file,
            output_file,
            sanitized_advanced.as_deref(),
        )?]
    };

    Ok(CommandBuildOutput {
        commands: command_args
            .iter()
            .map(|args| format!("ffmpeg {}", shell_join(args)))
            .collect(),
        warnings,
        sanitized_advanced_args: sanitized_advanced,
    })
}

pub fn build_preview_command_args(
    payload: &TaskConfigPayload,
    input_file: &str,
    output_file: &str,
    options: PreviewCommandOptions,
) -> StorageResult<Vec<String>> {
    if input_file.trim().is_empty() || output_file.trim().is_empty() {
        return Err(StorageError::InvalidPayload(
            "input/output file cannot be empty".to_string(),
        ));
    }

    guard_advanced_args(payload.advanced_args.as_deref())?;

    let mut warnings = codec_strategy_warnings(payload);
    let sanitized_advanced =
        sanitize_advanced_args(payload.advanced_args.as_deref(), &mut warnings);
    let mut preview_payload = payload.clone();

    // 预览固定走单 pass；正式转码仍保留原 2-pass 配置。
    preview_payload.video.enable_two_pass = false;

    // 若配置了输出分辨率，预览阶段直接生成缩放后的短片段，减少前端解码压力。
    if let Some(resolution) = &mut preview_payload.video.resolution {
        resolution.width = scale_even_dimension(resolution.width, options.render_scale);
        resolution.height = scale_even_dimension(resolution.height, options.render_scale);
    }

    let mut args = vec![
        "-y".to_string(),
        "-ss".to_string(),
        format!("{:.3}", options.start_sec.max(0.0)),
        "-t".to_string(),
        format!("{:.3}", options.duration_sec.max(0.1)),
        "-i".to_string(),
        input_file.to_string(),
    ];

    append_video_args(&preview_payload, &mut args)?;

    if preview_payload.video.resolution.is_none()
        && (options.render_scale - 1.0).abs() > f64::EPSILON
    {
        // 未指定目标分辨率时，使用输入尺寸按比例缩放到偶数，避免 H.264 等编码器拒绝奇数尺寸。
        args.push("-vf".to_string());
        args.push(format!(
            "scale=trunc(iw*{scale}/2)*2:trunc(ih*{scale}/2)*2",
            scale = options.render_scale
        ));
    }

    append_advanced_args(sanitized_advanced.as_deref(), &mut args);
    args.push("-an".to_string());
    args.push("-movflags".to_string());
    args.push("+faststart".to_string());
    args.push(output_file.to_string());

    Ok(args)
}

fn build_single_pass_args(
    payload: &TaskConfigPayload,
    input_file: &str,
    output_file: &str,
    sanitized_advanced: Option<&str>,
) -> StorageResult<Vec<String>> {
    let mut args = base_input_args(input_file);
    append_video_args(payload, &mut args)?;
    append_audio_args(payload, &mut args)?;
    append_container_args(payload, &mut args);
    append_advanced_args(sanitized_advanced, &mut args);
    args.push(output_file.to_string());

    Ok(args)
}

fn build_pass1_args(
    payload: &TaskConfigPayload,
    input_file: &str,
    passlog_path: &str,
    sanitized_advanced: Option<&str>,
) -> StorageResult<Vec<String>> {
    let mut args = vec!["-y".to_string()];
    args.extend(base_input_args(input_file));

    append_video_args(payload, &mut args)?;
    append_advanced_args(sanitized_advanced, &mut args);
    args.push("-pass".to_string());
    args.push("1".to_string());
    args.push("-passlogfile".to_string());
    args.push(passlog_path.to_string());
    args.push("-an".to_string());
    args.push("-f".to_string());
    args.push(container_name(&payload.container.format).to_string());
    args.push("/dev/null".to_string());

    Ok(args)
}

fn build_pass2_args(
    payload: &TaskConfigPayload,
    input_file: &str,
    output_file: &str,
    passlog_path: &str,
    sanitized_advanced: Option<&str>,
) -> StorageResult<Vec<String>> {
    let mut args = base_input_args(input_file);

    append_video_args(payload, &mut args)?;
    args.push("-pass".to_string());
    args.push("2".to_string());
    args.push("-passlogfile".to_string());
    args.push(passlog_path.to_string());

    append_audio_args(payload, &mut args)?;
    append_container_args(payload, &mut args);
    append_advanced_args(sanitized_advanced, &mut args);
    args.push(output_file.to_string());

    Ok(args)
}

fn base_input_args(input_file: &str) -> Vec<String> {
    vec!["-i".to_string(), input_file.to_string()]
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
        args.push(preset.to_string());
    }

    if let Some(profile) = &payload.video.profile {
        args.push("-profile:v".to_string());
        args.push(profile.to_string());
    }

    if let Some(tune) = &payload.video.tune {
        args.push("-tune".to_string());
        args.push(tune.to_string());
    }

    if let Some(resolution) = &payload.video.resolution {
        args.push("-vf".to_string());
        args.push(format!("scale={}:{}", resolution.width, resolution.height));
    }

    if let Some(fps) = payload.video.fps {
        args.push("-r".to_string());
        args.push(fps.to_string());
    }

    if let Some(pixel_format) = &payload.video.pixel_format {
        args.push("-pix_fmt".to_string());
        args.push(pixel_format.to_string());
    }

    if payload
        .video
        .preserve_dolby_vision_metadata
        .unwrap_or(false)
    {
        // V1 仅在 libx265 路径上显式表达 Dolby Vision 保留意图。
        args.push("-dolbyvision".to_string());
        args.push("1".to_string());
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

    if contains_positional_output_token(&tokens) {
        return Err(StorageError::InvalidPayload(
            "advancedArgs cannot contain positional output paths".to_string(),
        ));
    }

    Ok(())
}

fn contains_positional_output_token(tokens: &[String]) -> bool {
    let mut expects_value = false;

    for token in tokens {
        if token.starts_with('-') {
            expects_value = !is_flag_without_value(token);
            continue;
        }

        if expects_value {
            expects_value = false;
            continue;
        }

        // 不跟随参数名的裸 token 会被 FFmpeg 解释为输出路径，必须拒绝。
        return true;
    }

    false
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
            "当前使用硬件编码器：速度优先，部分质量参数（如 2-pass/CRF）受编码器能力限制"
                .to_string(),
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

    if matches!(
        payload.video.codec_format,
        VideoCodecFormat::Av1 | VideoCodecFormat::Vp9
    ) && matches!(
        payload.video.bitrate_mode,
        VideoBitrateMode::Cbr | VideoBitrateMode::Abr
    ) {
        warnings.push(
            "AV1/VP9 当前优先推荐 CRF 路径；CBR/ABR 需通过 advancedArgs 提供完整参数".to_string(),
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

fn is_flag_without_value(flag: &str) -> bool {
    matches!(flag, "-y" | "-n" | "-an" | "-vn" | "-sn" | "-dn")
}

fn build_passlog_path(input_file: &str, output_file: &str) -> String {
    let mut hasher = DefaultHasher::new();
    input_file.hash(&mut hasher);
    output_file.hash(&mut hasher);

    // passlog 文件名按输入/输出稳定派生，避免并发 2-pass 任务互相覆盖。
    std::env::temp_dir()
        .join("encode-lab")
        .join("passlog")
        .join(format!("passlog-{:016x}", hasher.finish()))
        .to_string_lossy()
        .to_string()
}

fn scale_even_dimension(value: u32, scale: f64) -> u32 {
    let scaled = ((value as f64) * scale).round().max(2.0) as u32;

    // 主流视频编码器通常要求偶数尺寸，奇数时向下收敛到最近偶数。
    if scaled % 2 == 0 {
        scaled
    } else {
        scaled.saturating_sub(1).max(2)
    }
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

fn shell_join(args: &[String]) -> String {
    args.iter()
        .map(|item| shell_quote(item))
        .collect::<Vec<_>>()
        .join(" ")
}

fn shell_quote(value: &str) -> String {
    if value.is_empty() {
        return "''".to_string();
    }

    if value
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || "-_./:=+".contains(ch))
    {
        return value.to_string();
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

    use super::{build_ffmpeg_commands, build_preview_command_args, PreviewCommandOptions};

    fn payload() -> TaskConfigPayload {
        TaskConfigPayload {
            name: "demo".to_string(),
            video: VideoConfig {
                codec_format: VideoCodecFormat::H264,
                encoder: VideoEncoder::Libx264,
                bitrate_mode: VideoBitrateMode::Crf,
                crf: Some(23),
                preset: Some("medium".to_string()),
                preserve_dolby_vision_metadata: None,
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
        assert!(result.commands[0].contains("passlog-"));
        assert!(result.commands[1].contains("passlog-"));
        assert!(result.commands[0].contains("/dev/null"));
    }

    #[test]
    fn advanced_args_rejects_input_override() {
        let mut value = payload();
        value.advanced_args = Some("-i hacked.mp4".to_string());

        let err =
            build_ffmpeg_commands(&value, "input.mp4", "output.mp4").expect_err("should reject");
        assert_eq!(err.code(), "INVALID_PAYLOAD");
    }

    #[test]
    fn advanced_args_rejects_positional_output_path() {
        let mut value = payload();
        value.advanced_args = Some("-map 0:v:0 extra.mp4".to_string());

        let err =
            build_ffmpeg_commands(&value, "input.mp4", "output.mp4").expect_err("should reject");
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
        assert!(result
            .warnings
            .iter()
            .any(|item| item.contains("硬件编码器")));
        assert!(result.warnings.iter().any(|item| item.contains("CBR/ABR")));
    }

    #[test]
    fn build_preview_command_should_use_video_parameters() {
        let mut value = payload();
        value.video.resolution = Some(crate::models::task::Resolution {
            width: 1920,
            height: 1080,
        });

        let args = build_preview_command_args(
            &value,
            "input.mp4",
            "preview.mp4",
            PreviewCommandOptions {
                start_sec: 1.0,
                duration_sec: 6.0,
                render_scale: 0.5,
            },
        )
        .expect("preview args");

        assert!(args
            .windows(2)
            .any(|item| item[0] == "-c:v" && item[1] == "libx264"));
        assert!(args
            .windows(2)
            .any(|item| item[0] == "-crf" && item[1] == "23"));
        assert!(args
            .windows(2)
            .any(|item| item[0] == "-vf" && item[1] == "scale=960:540"));
        assert!(args.iter().any(|item| item == "-an"));
    }
}
