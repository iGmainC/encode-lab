use std::{
    collections::hash_map::DefaultHasher,
    fs,
    hash::{Hash, Hasher},
};

use crate::{
    models::{
        task::{
            AudioMode, ContainerFormat, Resolution, VideoBitrateMode, VideoCodecFormat,
            VideoEncoder,
        },
        TaskConfigPayload,
    },
    probe::video_metadata::{read_video_metadata, HdrType, VideoStreamMetadata},
    storage::errors::{StorageError, StorageResult},
};

#[derive(Debug, Clone)]
pub struct CommandBuildOutput {
    pub commands: Vec<String>,
    pub warnings: Vec<String>,
    pub sanitized_advanced_args: Option<String>,
}

/// 编码预览使用的小片段帧数，避免部分编码器单帧输出灰帧或延迟帧。
const PREVIEW_ENCODE_FRAME_COUNT: u8 = 8;

/// 预览 SDR 映射策略。
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum PreviewSdrTonemapMode {
    /// 不执行 SDR 映射，直接按普通预览链路抽帧。
    #[default]
    Disabled,
    /// 使用 zscale + tonemap 处理 HDR10/HLG。
    Zscale,
    /// 使用 libplacebo 处理 Dolby Vision RPU 与 HDR 到 SDR 映射。
    Libplacebo,
}

impl PreviewSdrTonemapMode {
    /// 判断当前策略是否会在 FFmpeg 预览命令中加入 SDR 映射 filter。
    pub fn is_enabled(self) -> bool {
        !matches!(self, Self::Disabled)
    }
}

/// 预览单帧命令的时间点。
pub struct PreviewCommandOptions {
    /// 抽帧时间点，单位秒。
    pub time_sec: f64,
    /// 渲染缩放比例，取值通常为 0.25-1.0。
    pub render_scale: f64,
    /// 预览链路使用的 SDR 映射策略。
    pub sdr_tonemap_mode: PreviewSdrTonemapMode,
    /// 源视频 HDR 与色彩元数据；普通 HDR fallback 映射时用于固定 zscale 输入端。
    pub source_color: Option<PreviewSourceColor>,
}

/// 预览 SDR 映射使用的源色彩上下文。
#[derive(Debug, Clone, Default)]
pub struct PreviewSourceColor {
    /// 源视频 HDR 类型，例如 Hdr10、Hlg、DolbyVision。
    pub hdr_type: Option<String>,
    /// 源视频色彩原色，例如 bt2020。
    pub primaries: Option<String>,
    /// 源视频传递函数，例如 smpte2084、arib-std-b67。
    pub transfer: Option<String>,
    /// 源视频色彩矩阵，例如 bt2020nc。
    pub matrix: Option<String>,
    /// 源视频色彩范围，例如 tv、pc。
    pub range: Option<String>,
}

pub fn build_ffmpeg_commands(
    payload: &TaskConfigPayload,
    input_file: &str,
    output_file: &str,
) -> StorageResult<CommandBuildOutput> {
    let command_args = build_ffmpeg_command_args(payload, input_file, output_file)?;
    let mut warnings = codec_strategy_warnings(payload);
    let sanitized_advanced =
        sanitize_advanced_args(payload.advanced_args.as_deref(), &mut warnings);

    Ok(CommandBuildOutput {
        commands: command_args
            .iter()
            .map(|args| format!("ffmpeg {}", shell_join(args)))
            .collect(),
        warnings,
        sanitized_advanced_args: sanitized_advanced,
    })
}

pub fn build_ffmpeg_command_args(
    payload: &TaskConfigPayload,
    input_file: &str,
    output_file: &str,
) -> StorageResult<Vec<Vec<String>>> {
    if input_file.trim().is_empty() || output_file.trim().is_empty() {
        return Err(StorageError::InvalidPayload(
            "input/output file cannot be empty".to_string(),
        ));
    }

    guard_advanced_args(payload.advanced_args.as_deref())?;
    ensure_dolby_vision_preserve_source_supported(payload, input_file)?;

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

    if payload.video.enable_two_pass {
        let passlog_path = passlog_path.as_deref().ok_or_else(|| {
            StorageError::InvalidPayload("passlog path is required for 2-pass".to_string())
        })?;
        Ok(vec![
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
        ])
    } else {
        Ok(vec![build_single_pass_args(
            payload,
            input_file,
            output_file,
            sanitized_advanced.as_deref(),
        )?])
    }
}

fn ensure_dolby_vision_preserve_source_supported(
    payload: &TaskConfigPayload,
    input_file: &str,
) -> StorageResult<()> {
    if !payload
        .video
        .preserve_dolby_vision_metadata
        .unwrap_or(false)
    {
        return Ok(());
    }

    let metadata = read_video_metadata(input_file).map_err(|err| {
        StorageError::InvalidPayload(format!(
            "cannot verify Dolby Vision source metadata: {}",
            err.message
        ))
    })?;

    validate_dolby_vision_preserve_source(metadata.video.as_ref())
}

/// 校验源片是否适配当前 libx265 Dolby Vision 元数据保留链路。
fn validate_dolby_vision_preserve_source(video: Option<&VideoStreamMetadata>) -> StorageResult<()> {
    let Some(video) = video else {
        return Err(StorageError::InvalidPayload(
            "Dolby Vision metadata preservation requires a readable video stream".to_string(),
        ));
    };

    if video.hdr_type.as_ref() != Some(&HdrType::DolbyVision) {
        return Err(StorageError::InvalidPayload(
            "Dolby Vision metadata preservation requires a Dolby Vision source".to_string(),
        ));
    }

    let profile = video.dolby_vision_profile;
    let compatibility_id = video.dolby_vision_compatibility_id;
    if profile.is_none() || compatibility_id.is_none() {
        return Err(StorageError::InvalidPayload(
            "Dolby Vision metadata preservation requires source profile and compatibility id"
                .to_string(),
        ));
    }

    if profile == Some(5) || compatibility_id == Some(0) {
        return Err(StorageError::InvalidPayload(format!(
            "Dolby Vision metadata preservation does not support source profile {} compatibility {}; disable preservation and transcode as ordinary H.265",
            profile.unwrap_or_default(),
            compatibility_id.unwrap_or_default()
        )));
    }

    Ok(())
}

pub fn build_preview_encoded_frame_command_args(
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

    let mut warnings = Vec::new();
    let sanitized_advanced =
        sanitize_preview_advanced_args(payload.advanced_args.as_deref(), &mut warnings);
    let mut preview_payload = payload.clone();

    // 单帧编码预览不执行 2-pass，也不携带 DV 元数据保留；DV 需要完整 profile 上下文。
    preview_payload.video.enable_two_pass = false;
    preview_payload.video.preserve_dolby_vision_metadata = Some(false);
    let keeps_source_resolution = preview_payload.video.resolution.is_none();

    if let Some(resolution) = &mut preview_payload.video.resolution {
        resolution.width = scale_even_dimension(resolution.width, options.render_scale);
        resolution.height = scale_even_dimension(resolution.height, options.render_scale);
    }
    let preview_resolution = preview_payload.video.resolution.clone();
    preview_payload.video.resolution = None;

    let mut args = vec![
        "-y".to_string(),
        "-ss".to_string(),
        format!("{:.3}", options.time_sec.max(0.0)),
        "-i".to_string(),
        input_file.to_string(),
    ];

    append_video_args(&preview_payload, &mut args)?;
    append_preview_video_filter(
        &mut args,
        preview_resolution.as_ref(),
        keeps_source_resolution.then_some(options.render_scale),
        options.sdr_tonemap_mode,
        options.source_color.as_ref(),
        PreviewFilterOutput::Encoder,
    );
    if options.sdr_tonemap_mode.is_enabled() {
        append_preview_sdr_color_tags(&mut args);
    }
    append_advanced_args(sanitized_advanced.as_deref(), &mut args);
    args.push("-frames:v".to_string());
    args.push(PREVIEW_ENCODE_FRAME_COUNT.to_string());
    args.push("-an".to_string());
    args.push("-f".to_string());
    args.push("matroska".to_string());
    args.push(output_file.to_string());

    Ok(args)
}

pub fn build_preview_decode_frame_command_args(
    input_file: &str,
    output_file: &str,
) -> StorageResult<Vec<String>> {
    if input_file.trim().is_empty() || output_file.trim().is_empty() {
        return Err(StorageError::InvalidPayload(
            "input/output file cannot be empty".to_string(),
        ));
    }

    Ok(vec![
        "-y".to_string(),
        "-i".to_string(),
        input_file.to_string(),
        "-frames:v".to_string(),
        "1".to_string(),
        output_file.to_string(),
    ])
}

pub fn build_source_frame_command_args(
    input_file: &str,
    output_file: &str,
    options: PreviewCommandOptions,
) -> StorageResult<Vec<String>> {
    if input_file.trim().is_empty() || output_file.trim().is_empty() {
        return Err(StorageError::InvalidPayload(
            "input/output file cannot be empty".to_string(),
        ));
    }

    let mut args = vec![
        "-y".to_string(),
        "-ss".to_string(),
        format!("{:.3}", options.time_sec.max(0.0)),
        "-i".to_string(),
        input_file.to_string(),
    ];

    append_preview_video_filter(
        &mut args,
        None,
        Some(options.render_scale),
        options.sdr_tonemap_mode,
        options.source_color.as_ref(),
        PreviewFilterOutput::Image,
    );

    append_frame_output_args(&mut args);
    args.push(output_file.to_string());

    Ok(args)
}

fn preview_render_scale_filter(render_scale: f64) -> String {
    format!(
        "scale=trunc(iw*{scale}/2)*2:trunc(ih*{scale}/2)*2",
        scale = render_scale
    )
}

#[derive(Clone, Copy)]
enum PreviewFilterOutput {
    Encoder,
    Image,
}

fn append_preview_video_filter(
    args: &mut Vec<String>,
    resolution: Option<&Resolution>,
    render_scale: Option<f64>,
    sdr_tonemap_mode: PreviewSdrTonemapMode,
    source_color: Option<&PreviewSourceColor>,
    output: PreviewFilterOutput,
) {
    let mut filters = Vec::new();

    if sdr_tonemap_mode.is_enabled() {
        filters.extend(preview_sdr_tonemap_filters(
            output,
            source_color,
            sdr_tonemap_mode,
        ));
    }

    if let Some(resolution) = resolution {
        filters.push(format!("scale={}:{}", resolution.width, resolution.height));
    } else if let Some(render_scale) = render_scale {
        if (render_scale - 1.0).abs() > f64::EPSILON {
            // 保持源分辨率时，转码预览也必须和源 proxy 使用同一缩放，避免预览层因像素更多显得更锐。
            filters.push(preview_render_scale_filter(render_scale));
        }
    }

    if filters.is_empty() {
        return;
    }

    args.push("-vf".to_string());
    args.push(filters.join(","));
}

fn preview_sdr_tonemap_filters(
    output: PreviewFilterOutput,
    source_color: Option<&PreviewSourceColor>,
    mode: PreviewSdrTonemapMode,
) -> Vec<String> {
    match mode {
        PreviewSdrTonemapMode::Disabled => Vec::new(),
        PreviewSdrTonemapMode::Zscale => preview_zscale_sdr_tonemap_filters(output, source_color),
        PreviewSdrTonemapMode::Libplacebo => preview_libplacebo_sdr_tonemap_filters(output),
    }
}

fn preview_zscale_sdr_tonemap_filters(
    output: PreviewFilterOutput,
    source_color: Option<&PreviewSourceColor>,
) -> Vec<String> {
    let final_format = match output {
        PreviewFilterOutput::Encoder => "format=yuv420p",
        PreviewFilterOutput::Image => "format=rgb24",
    };
    let input_color = resolve_preview_sdr_input_color(source_color);

    vec![
        format!(
            "zscale=primariesin={}:transferin={}:matrixin={}:rangein={}:primaries={}:transfer=linear:npl=100",
            input_color.primaries,
            input_color.transfer,
            input_color.matrix,
            input_color.range,
            input_color.primaries
        ),
        "format=gbrpf32le".to_string(),
        // mobius 比 hable 更保守，先压动态范围，再把源 primaries 转到 BT.709，减少动画素材高光发白。
        "tonemap=tonemap=mobius:param=0.3:desat=1".to_string(),
        "zscale=primaries=bt709:transfer=bt709:matrix=bt709:range=tv".to_string(),
        final_format.to_string(),
    ]
}

fn preview_libplacebo_sdr_tonemap_filters(output: PreviewFilterOutput) -> Vec<String> {
    let final_format = match output {
        PreviewFilterOutput::Encoder => "format=yuv420p",
        PreviewFilterOutput::Image => "format=rgb24",
    };

    vec![
        // libplacebo 会读取 DV RPU，再统一输出 BT.709 SDR；这是 Dolby Vision 预览的优先路径。
        "libplacebo=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv:apply_dolbyvision=true".to_string(),
        final_format.to_string(),
    ]
}

fn append_preview_sdr_color_tags(args: &mut Vec<String>) {
    // 预览编码中间文件需要显式 BT.709 标签，避免解 PNG 时再被 FFmpeg 按未知色彩属性推导。
    args.extend([
        "-color_primaries".to_string(),
        "bt709".to_string(),
        "-color_trc".to_string(),
        "bt709".to_string(),
        "-colorspace".to_string(),
        "bt709".to_string(),
        "-color_range".to_string(),
        "tv".to_string(),
    ]);
}

struct PreviewSdrInputColor {
    primaries: &'static str,
    transfer: &'static str,
    matrix: &'static str,
    range: &'static str,
}

fn resolve_preview_sdr_input_color(
    source_color: Option<&PreviewSourceColor>,
) -> PreviewSdrInputColor {
    let hdr_type = source_color
        .and_then(|value| value.hdr_type.as_deref())
        .map(normalize_color_token);

    PreviewSdrInputColor {
        primaries: source_color
            .and_then(|value| value.primaries.as_deref())
            .and_then(map_zscale_primaries)
            .unwrap_or_else(|| fallback_primaries_for_hdr(hdr_type.as_deref())),
        transfer: source_color
            .and_then(|value| value.transfer.as_deref())
            .and_then(map_zscale_transfer)
            .unwrap_or_else(|| fallback_transfer_for_hdr(hdr_type.as_deref())),
        matrix: source_color
            .and_then(|value| value.matrix.as_deref())
            .and_then(map_zscale_matrix)
            .unwrap_or_else(|| fallback_matrix_for_hdr(hdr_type.as_deref())),
        range: source_color
            .and_then(|value| value.range.as_deref())
            .and_then(map_zscale_range)
            .unwrap_or("tv"),
    }
}

fn normalize_color_token(value: &str) -> String {
    value
        .chars()
        .filter(|ch| !matches!(ch, '_' | '-' | ' '))
        .collect::<String>()
        .to_ascii_lowercase()
}

fn map_zscale_primaries(value: &str) -> Option<&'static str> {
    match normalize_color_token(value).as_str() {
        "bt2020" | "bt2020nc" => Some("bt2020"),
        "bt709" => Some("bt709"),
        "smpte170m" => Some("smpte170m"),
        "smpte240m" => Some("smpte240m"),
        _ => None,
    }
}

fn map_zscale_transfer(value: &str) -> Option<&'static str> {
    match normalize_color_token(value).as_str() {
        "smpte2084" | "pq" => Some("smpte2084"),
        "aribstdb67" | "hlg" => Some("arib-std-b67"),
        "bt709" => Some("bt709"),
        "bt202010" => Some("bt2020-10"),
        "bt202012" => Some("bt2020-12"),
        _ => None,
    }
}

fn map_zscale_matrix(value: &str) -> Option<&'static str> {
    match normalize_color_token(value).as_str() {
        "bt2020nc" | "bt2020ncl" | "2020ncl" => Some("bt2020nc"),
        "bt2020c" | "2020cl" => Some("bt2020c"),
        "bt709" => Some("bt709"),
        "smpte170m" => Some("smpte170m"),
        _ => None,
    }
}

fn map_zscale_range(value: &str) -> Option<&'static str> {
    match normalize_color_token(value).as_str() {
        "tv" | "limited" | "mpeg" => Some("tv"),
        "pc" | "full" | "jpeg" => Some("pc"),
        _ => None,
    }
}

fn fallback_primaries_for_hdr(hdr_type: Option<&str>) -> &'static str {
    match hdr_type {
        Some("hdr10" | "hlg") => "bt2020",
        _ => "bt709",
    }
}

fn fallback_transfer_for_hdr(hdr_type: Option<&str>) -> &'static str {
    match hdr_type {
        Some("hlg") => "arib-std-b67",
        Some("hdr10") => "smpte2084",
        _ => "bt709",
    }
}

fn fallback_matrix_for_hdr(hdr_type: Option<&str>) -> &'static str {
    match hdr_type {
        Some("hdr10" | "hlg") => "bt2020nc",
        _ => "bt709",
    }
}

fn append_frame_output_args(args: &mut Vec<String>) {
    args.push("-frames:v".to_string());
    args.push("1".to_string());
}

fn build_single_pass_args(
    payload: &TaskConfigPayload,
    input_file: &str,
    output_file: &str,
    sanitized_advanced: Option<&str>,
) -> StorageResult<Vec<String>> {
    let mut args = base_input_args(payload, input_file);
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
    args.extend(base_input_args(payload, input_file));

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
    let mut args = base_input_args(payload, input_file);

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

fn base_input_args(payload: &TaskConfigPayload, input_file: &str) -> Vec<String> {
    let mut args = Vec::new();
    if let Some(clip_range) = &payload.clip_range {
        // 正式转码使用输入前 seek 加输出时长限制；比仅在滤镜中裁剪更稳定覆盖音视频。
        args.push("-ss".to_string());
        args.push(format_seconds(clip_range.start_ms));
    }

    args.push("-i".to_string());
    args.push(input_file.to_string());

    if let Some(clip_range) = &payload.clip_range {
        args.push("-t".to_string());
        args.push(format_seconds(clip_range.end_ms - clip_range.start_ms));
    }

    args
}

fn format_seconds(value_ms: u64) -> String {
    format!("{:.3}", value_ms as f64 / 1000.0)
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
    if matches!(payload.container.format, ContainerFormat::Mp4) {
        // TrueHD 等音频 copy 到 MP4 时 FFmpeg 需要 experimental 开关，否则 header 写入失败。
        args.push("-strict".to_string());
        args.push("-2".to_string());
    }

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
    sanitize_advanced_args_with(raw, warnings, is_structured_conflict_flag)
}

fn sanitize_preview_advanced_args(raw: Option<&str>, warnings: &mut Vec<String>) -> Option<String> {
    sanitize_advanced_args_with(raw, warnings, |flag| {
        is_structured_conflict_flag(flag) || is_preview_conflict_flag(flag)
    })
}

fn sanitize_advanced_args_with<F>(
    raw: Option<&str>,
    warnings: &mut Vec<String>,
    is_conflict_flag: F,
) -> Option<String>
where
    F: Fn(&str) -> bool,
{
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

        if is_conflict_flag(token) {
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

fn is_preview_conflict_flag(flag: &str) -> bool {
    matches!(
        flag,
        // DV 元数据保留需要完整 profile 上下文，单帧预览路径必须强制移除。
        "-dolbyvision"
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

pub(crate) fn build_passlog_path(input_file: &str, output_file: &str) -> String {
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
        AudioConfig, AudioMode, ClipRange, ContainerConfig, ContainerFormat, OutputConfig,
        TaskConfigPayload, VideoBitrateMode, VideoCodecFormat, VideoConfig, VideoEncoder,
    };
    use crate::probe::video_metadata::{HdrType, VideoStreamMetadata};

    use super::{
        build_ffmpeg_command_args, build_ffmpeg_commands, build_preview_encoded_frame_command_args,
        build_source_frame_command_args, validate_dolby_vision_preserve_source,
        PreviewCommandOptions, PreviewSdrTonemapMode, PreviewSourceColor,
    };

    fn payload() -> TaskConfigPayload {
        TaskConfigPayload {
            name: "demo".to_string(),
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
                location: None,
            },
        }
    }

    #[test]
    fn dolby_vision_preserve_source_validation_should_reject_profile_5_compat_0() {
        let video = VideoStreamMetadata {
            codec_name: Some("hevc".to_string()),
            codec_long_name: None,
            profile: Some("Main 10".to_string()),
            width: Some(3840),
            height: Some(1616),
            pix_fmt: Some("yuv420p10le".to_string()),
            fps: Some(24.0),
            bit_rate_kbps: None,
            size_bytes: None,
            color_primaries: None,
            color_transfer: None,
            color_space: None,
            color_range: Some("pc".to_string()),
            bit_depth: Some(10),
            hdr_type: Some(HdrType::DolbyVision),
            dolby_vision_profile: Some(5),
            dolby_vision_compatibility_id: Some(0),
            max_content_light_level: None,
            max_frame_average_light_level: None,
            mastering_display_max_luminance: None,
            mastering_display_min_luminance: None,
        };

        let err = validate_dolby_vision_preserve_source(Some(&video))
            .expect_err("profile 5 compatibility 0 should be rejected");

        assert!(err.to_string().contains("source profile 5 compatibility 0"));
    }

    #[test]
    fn build_single_pass_command_success() {
        let result = build_ffmpeg_commands(&payload(), "input.mp4", "output.mp4").expect("build");
        assert_eq!(result.commands.len(), 1);
        assert!(result.commands[0].contains("-c:v libx264"));
        assert!(result.commands[0].contains("-crf 23"));
        assert!(result.commands[0].contains("-c:a copy"));
        assert!(result.commands[0].contains("-strict -2"));
        assert!(result.commands[0].contains("-movflags +faststart"));
    }

    #[test]
    fn build_single_pass_command_should_apply_clip_range() {
        let mut value = payload();
        value.clip_range = Some(ClipRange {
            start_ms: 1_000,
            end_ms: 4_500,
        });

        let result = build_ffmpeg_commands(&value, "input.mp4", "output.mp4").expect("build");
        let cmd = &result.commands[0];

        assert!(cmd.contains("-ss 1.000"));
        assert!(cmd.contains("-i input.mp4 -t 3.500"));
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
    fn formal_command_should_keep_manual_dolby_vision_advanced_arg() {
        let mut value = payload();
        value.video.codec_format = VideoCodecFormat::H265;
        value.video.encoder = VideoEncoder::Libx265;
        value.advanced_args = Some("-dolbyvision 1".to_string());

        let commands = build_ffmpeg_command_args(&value, "input.mov", "output.mkv").expect("build");
        let args = &commands[0];

        assert!(args
            .windows(2)
            .any(|item| item[0] == "-dolbyvision" && item[1] == "1"));
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
    fn build_preview_encoded_frame_command_should_apply_target_encoder_parameters() {
        let mut value = payload();
        value.video.codec_format = VideoCodecFormat::Av1;
        value.video.encoder = VideoEncoder::LibaomAv1;
        value.video.crf = Some(45);
        value.video.preset = Some("slow".to_string());
        value.video.resolution = Some(crate::models::task::Resolution {
            width: 1920,
            height: 1080,
        });
        value.advanced_args = Some("-cpu-used 6 -row-mt 1".to_string());

        let args = build_preview_encoded_frame_command_args(
            &value,
            "input.mkv",
            "preview.mkv",
            PreviewCommandOptions {
                time_sec: 1.0,
                render_scale: 0.5,
                sdr_tonemap_mode: PreviewSdrTonemapMode::Disabled,
                source_color: None,
            },
        )
        .expect("preview args");

        assert!(args.iter().any(|item| item == "libaom-av1"));
        assert!(args
            .windows(2)
            .any(|item| item[0] == "-crf" && item[1] == "45"));
        assert!(args
            .windows(2)
            .any(|item| item[0] == "-preset" && item[1] == "slow"));
        assert!(args
            .windows(2)
            .any(|item| item[0] == "-vf" && item[1] == "scale=960:540"));
        assert!(args
            .windows(2)
            .any(|item| item[0] == "-cpu-used" && item[1] == "6"));
        assert!(!args.iter().any(|item| item == "-pass"));
        assert!(args
            .windows(2)
            .any(|item| item[0] == "-frames:v" && item[1] == "8"));
        assert!(args
            .windows(2)
            .any(|item| item[0] == "-f" && item[1] == "matroska"));
        assert_eq!(args.last().map(String::as_str), Some("preview.mkv"));
    }

    #[test]
    fn build_preview_encoded_frame_command_should_scale_when_keeping_source_resolution() {
        let args = build_preview_encoded_frame_command_args(
            &payload(),
            "input.mkv",
            "preview.mkv",
            PreviewCommandOptions {
                time_sec: 1.0,
                render_scale: 0.5,
                sdr_tonemap_mode: PreviewSdrTonemapMode::Disabled,
                source_color: None,
            },
        )
        .expect("preview args");

        assert!(args.windows(2).any(|item| {
            item[0] == "-vf" && item[1] == "scale=trunc(iw*0.5/2)*2:trunc(ih*0.5/2)*2"
        }));
    }

    #[test]
    fn build_preview_encoded_frame_command_should_tonemap_hdr_to_sdr() {
        let args = build_preview_encoded_frame_command_args(
            &payload(),
            "input.mkv",
            "preview.mkv",
            PreviewCommandOptions {
                time_sec: 1.0,
                render_scale: 0.5,
                sdr_tonemap_mode: PreviewSdrTonemapMode::Zscale,
                source_color: Some(PreviewSourceColor {
                    hdr_type: Some("Hdr10".to_string()),
                    primaries: Some("bt2020".to_string()),
                    transfer: Some("smpte2084".to_string()),
                    matrix: Some("bt2020nc".to_string()),
                    range: Some("tv".to_string()),
                }),
            },
        )
        .expect("preview args");

        let filter = args
            .windows(2)
            .find_map(|item| (item[0] == "-vf").then_some(item[1].as_str()))
            .expect("preview filter");

        assert!(filter.contains("tonemap=tonemap=mobius:param=0.3:desat=1"));
        assert!(filter.contains(
            "zscale=primariesin=bt2020:transferin=smpte2084:matrixin=bt2020nc:rangein=tv:primaries=bt2020:transfer=linear"
        ));
        assert!(filter.contains("format=gbrpf32le,tonemap=tonemap=mobius"));
        assert!(filter.contains("zscale=primaries=bt709:transfer=bt709:matrix=bt709:range=tv"));
        assert!(filter.contains("format=yuv420p"));
        assert!(args
            .windows(2)
            .any(|item| item[0] == "-color_primaries" && item[1] == "bt709"));
    }

    #[test]
    fn build_preview_encoded_frame_command_should_fallback_hlg_input_color() {
        let args = build_preview_encoded_frame_command_args(
            &payload(),
            "input.mkv",
            "preview.mkv",
            PreviewCommandOptions {
                time_sec: 1.0,
                render_scale: 0.5,
                sdr_tonemap_mode: PreviewSdrTonemapMode::Zscale,
                source_color: Some(PreviewSourceColor {
                    hdr_type: Some("Hlg".to_string()),
                    primaries: None,
                    transfer: None,
                    matrix: None,
                    range: None,
                }),
            },
        )
        .expect("preview args");

        let filter = args
            .windows(2)
            .find_map(|item| (item[0] == "-vf").then_some(item[1].as_str()))
            .expect("preview filter");

        assert!(filter.contains(
            "zscale=primariesin=bt2020:transferin=arib-std-b67:matrixin=bt2020nc:rangein=tv:primaries=bt2020:transfer=linear"
        ));
    }

    #[test]
    fn build_preview_encoded_frame_command_should_use_libplacebo_for_dolby_vision_sdr() {
        let args = build_preview_encoded_frame_command_args(
            &payload(),
            "input.mkv",
            "preview.mkv",
            PreviewCommandOptions {
                time_sec: 1.0,
                render_scale: 0.5,
                sdr_tonemap_mode: PreviewSdrTonemapMode::Libplacebo,
                source_color: Some(PreviewSourceColor {
                    hdr_type: Some("DolbyVision".to_string()),
                    primaries: Some("bt2020".to_string()),
                    transfer: Some("smpte2084".to_string()),
                    matrix: Some("bt2020nc".to_string()),
                    range: Some("tv".to_string()),
                }),
            },
        )
        .expect("preview args");

        let filter = args
            .windows(2)
            .find_map(|item| (item[0] == "-vf").then_some(item[1].as_str()))
            .expect("preview filter");

        assert!(filter.contains("libplacebo=colorspace=bt709"));
        assert!(filter.contains("apply_dolbyvision=true"));
        assert!(filter.contains("format=yuv420p"));
        assert!(!filter.contains("zscale="));
        assert!(!filter.contains("tonemap=tonemap"));
    }

    #[test]
    fn build_preview_encoded_frame_command_should_disable_dolby_vision_metadata() {
        let mut value = payload();
        value.video.codec_format = VideoCodecFormat::H265;
        value.video.encoder = VideoEncoder::Libx265;
        value.video.preserve_dolby_vision_metadata = Some(true);
        value.advanced_args = Some("-dolbyvision 1".to_string());

        let args = build_preview_encoded_frame_command_args(
            &value,
            "input.mov",
            "preview.mkv",
            PreviewCommandOptions {
                time_sec: 1.0,
                render_scale: 0.5,
                sdr_tonemap_mode: PreviewSdrTonemapMode::Disabled,
                source_color: None,
            },
        )
        .expect("preview args");

        assert!(!args.iter().any(|item| item == "-dolbyvision"));
    }

    #[test]
    fn build_source_frame_command_should_output_single_png_frame() {
        let args = build_source_frame_command_args(
            "input.mov",
            "source.png",
            PreviewCommandOptions {
                time_sec: 0.0,
                render_scale: 0.5,
                sdr_tonemap_mode: PreviewSdrTonemapMode::Disabled,
                source_color: None,
            },
        )
        .expect("source frame args");

        assert!(args
            .windows(2)
            .any(|item| item[0] == "-frames:v" && item[1] == "1"));
        assert!(args.windows(2).any(|item| {
            item[0] == "-vf" && item[1] == "scale=trunc(iw*0.5/2)*2:trunc(ih*0.5/2)*2"
        }));
        assert!(!args.iter().any(|item| item == "-c:v"));
        assert_eq!(args.last().map(String::as_str), Some("source.png"));
    }

    #[test]
    fn build_source_frame_command_should_tonemap_hdr_to_sdr_image() {
        let args = build_source_frame_command_args(
            "input.mov",
            "source.png",
            PreviewCommandOptions {
                time_sec: 0.0,
                render_scale: 0.5,
                sdr_tonemap_mode: PreviewSdrTonemapMode::Zscale,
                source_color: Some(PreviewSourceColor {
                    hdr_type: Some("Hdr10".to_string()),
                    primaries: Some("bt2020".to_string()),
                    transfer: Some("smpte2084".to_string()),
                    matrix: Some("bt2020nc".to_string()),
                    range: Some("tv".to_string()),
                }),
            },
        )
        .expect("source frame args");

        let filter = args
            .windows(2)
            .find_map(|item| (item[0] == "-vf").then_some(item[1].as_str()))
            .expect("source filter");

        assert!(filter.contains("tonemap=tonemap=mobius:param=0.3:desat=1"));
        assert!(filter.contains(
            "zscale=primariesin=bt2020:transferin=smpte2084:matrixin=bt2020nc:rangein=tv:primaries=bt2020:transfer=linear"
        ));
        assert!(filter.contains("format=gbrpf32le,tonemap=tonemap=mobius"));
        assert!(filter.contains("zscale=primaries=bt709:transfer=bt709:matrix=bt709:range=tv"));
        assert!(filter.contains("format=rgb24"));
    }
}
