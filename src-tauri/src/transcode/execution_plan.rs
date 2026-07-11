use std::path::{Path, PathBuf};

use crate::{
    ffmpeg_runtime::{resolve_dovi_tool_path, resolve_x265_path},
    models::{
        task::{AudioMode, ContainerFormat, VideoBitrateMode, VideoCodecFormat, VideoEncoder},
        TaskConfigPayload,
    },
    probe::video_metadata::{
        read_constant_frame_count, read_video_metadata, HdrType, VideoStreamMetadata,
    },
    storage::errors::{StorageError, StorageResult},
    transcode::command_builder::{
        append_reencoded_video_metadata_cleanup, build_ffmpeg_commands, build_passlog_path,
    },
};

/// 外部命令类型；执行器根据类型选择 bundled runtime 中的二进制。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimeProgram {
    Ffmpeg,
    DoviTool,
}

impl RuntimeProgram {
    /// 返回命令预览中的稳定程序名。
    fn display_name(self) -> &'static str {
        match self {
            Self::Ffmpeg => "ffmpeg",
            Self::DoviTool => "dovi_tool",
        }
    }
}

/// 单个外部工具阶段。
#[derive(Debug, Clone)]
pub struct ProcessStep {
    /// 前端本地化使用的稳定阶段代码。
    pub code: &'static str,
    /// 面向用户的阶段名称。
    pub label: String,
    /// 需要启动的 bundled runtime 程序。
    pub program: RuntimeProgram,
    /// 不经过 shell 的参数数组。
    pub args: Vec<String>,
    /// 是否使用 FFmpeg `-progress` 读取媒体进度。
    pub reports_media_progress: bool,
}

/// Dolby Vision 输出校验所需事实。
#[derive(Debug, Clone)]
pub struct DolbyVisionVerification {
    pub output_file: PathBuf,
    pub source_rpu_file: PathBuf,
    pub output_rpu_file: PathBuf,
    pub source_rpu_json_file: PathBuf,
    pub output_rpu_json_file: PathBuf,
    pub expected_profile: u8,
    pub expected_compatibility_id: u8,
    pub expected_width: u32,
    pub expected_height: u32,
    pub expected_fps: f64,
    pub expected_fps_fraction: String,
    pub expected_frame_count: Option<u64>,
}

/// 转码计划阶段；外部命令、内部校验和原子落盘使用同一顺序模型。
#[derive(Debug, Clone)]
pub enum TranscodeStep {
    Process(ProcessStep),
    VerifyDolbyVision(DolbyVisionVerification),
    FinalizeOutput { source: PathBuf, target: PathBuf },
}

impl TranscodeStep {
    /// 生成任务详情使用的可读命令，不用于实际执行。
    pub fn display_command(&self) -> String {
        match self {
            Self::Process(step) => {
                format!("{} {}", step.program.display_name(), shell_join(&step.args))
            }
            Self::VerifyDolbyVision(verification) => format!(
                "verify-dolby-vision {} profile={} compatibility={}",
                shell_quote(&verification.output_file.to_string_lossy()),
                verification.expected_profile,
                verification.expected_compatibility_id
            ),
            Self::FinalizeOutput { source, target } => format!(
                "finalize-output {} {}",
                shell_quote(&source.to_string_lossy()),
                shell_quote(&target.to_string_lossy())
            ),
        }
    }

    /// 返回任务进度事件展示的阶段名称。
    pub fn label(&self) -> &str {
        match self {
            Self::Process(step) => &step.label,
            Self::VerifyDolbyVision(_) => "校验 Dolby Vision 输出",
            Self::FinalizeOutput { .. } => "完成输出文件",
        }
    }

    /// 返回跨语言、跨进程稳定的阶段代码。
    pub fn code(&self) -> &'static str {
        match self {
            Self::Process(step) => step.code,
            Self::VerifyDolbyVision(_) => "dv_verify_output",
            Self::FinalizeOutput { .. } => "finalize_output",
        }
    }
}

/// 可执行转码计划；普通任务与 Dolby Vision 任务共享同一调度入口。
#[derive(Debug, Clone)]
pub struct TranscodePlan {
    pub steps: Vec<TranscodeStep>,
    pub cleanup_paths: Vec<PathBuf>,
    pub workspace: Option<PathBuf>,
    pub warnings: Vec<String>,
    pub sanitized_advanced_args: Option<String>,
}

impl TranscodePlan {
    /// 返回任务历史可展示的全部阶段命令。
    pub fn display_commands(&self) -> Vec<String> {
        self.steps
            .iter()
            .map(TranscodeStep::display_command)
            .collect()
    }
}

/// 根据任务策略和源片元数据生成正式执行计划。
pub fn build_transcode_plan(
    payload: &TaskConfigPayload,
    input_file: &str,
    output_file: &str,
    job_id: &str,
    runtime_dir: &Path,
) -> StorageResult<TranscodePlan> {
    if payload
        .video
        .preserve_dolby_vision_metadata
        .unwrap_or(false)
    {
        return build_dolby_vision_plan(payload, input_file, output_file, job_id, runtime_dir);
    }

    let partial_output = partial_output_path(output_file, job_id)?;
    let partial_output_text = partial_output.to_string_lossy().to_string();
    let ordinary = build_ffmpeg_commands(payload, input_file, &partial_output_text)?;
    let mut steps = ordinary
        .command_args
        .into_iter()
        .enumerate()
        .map(|(index, args)| {
            TranscodeStep::Process(ProcessStep {
                code: "ffmpeg_transcode",
                label: format!("FFmpeg 转码阶段 {}", index + 1),
                program: RuntimeProgram::Ffmpeg,
                args,
                reports_media_progress: true,
            })
        })
        .collect::<Vec<_>>();
    steps.push(TranscodeStep::FinalizeOutput {
        source: partial_output.clone(),
        target: PathBuf::from(output_file),
    });

    let mut cleanup_paths = vec![partial_output];
    if payload.video.enable_two_pass {
        // passlog 会生成若干带后缀的文件，清理器把该路径视为 prefix 处理。
        cleanup_paths.push(PathBuf::from(build_passlog_path(
            input_file,
            &partial_output_text,
        )));
    }

    Ok(TranscodePlan {
        steps,
        cleanup_paths,
        workspace: None,
        warnings: ordinary.warnings,
        sanitized_advanced_args: ordinary.sanitized_advanced_args,
    })
}

/// 构建保持 P5/P8.1 动态元数据的正式转码计划。
fn build_dolby_vision_plan(
    payload: &TaskConfigPayload,
    input_file: &str,
    output_file: &str,
    job_id: &str,
    runtime_dir: &Path,
) -> StorageResult<TranscodePlan> {
    ensure_dolby_vision_runtime()?;
    validate_dolby_vision_payload(payload)?;

    let metadata = read_video_metadata(input_file).map_err(|error| {
        StorageError::InvalidPayload(format!(
            "cannot read Dolby Vision source metadata: {}",
            error.message
        ))
    })?;
    let video = metadata.video.as_ref().ok_or_else(|| {
        StorageError::InvalidPayload(
            "Dolby Vision preservation requires a readable video stream".to_string(),
        )
    })?;
    let route = resolve_dolby_vision_route(video)?;
    validate_dolby_vision_source(video)?;
    let fps_fraction = video.fps_fraction.as_deref().ok_or_else(|| {
        StorageError::InvalidPayload(
            "Dolby Vision RPU preservation requires an exact source frame rate".to_string(),
        )
    })?;
    let source_frame_count =
        read_constant_frame_count(input_file, fps_fraction).map_err(|error| {
            StorageError::InvalidPayload(format!(
                "Dolby Vision source timing is not constant: {}",
                error.message
            ))
        })?;

    let workspace = runtime_dir.join("transcode").join(job_id);
    let source_hevc = workspace.join("source.hevc");
    let source_rpu = workspace.join("source-rpu.bin");
    let output_hevc = workspace.join("output.hevc");
    let output_rpu = workspace.join("output-rpu.bin");
    let source_rpu_json = workspace.join("source-rpu.json");
    let output_rpu_json = workspace.join("output-rpu.json");
    let partial_output = partial_output_path(output_file, job_id)?;

    let extract_source = ProcessStep {
        code: "dv_extract_source_video",
        label: "提取源 Dolby Vision 视频流".to_string(),
        program: RuntimeProgram::Ffmpeg,
        args: extract_hevc_args(input_file, &source_hevc),
        reports_media_progress: false,
    };
    let extract_source_rpu = ProcessStep {
        code: "dv_extract_source_rpu",
        label: "提取源 RPU 动态元数据".to_string(),
        program: RuntimeProgram::DoviTool,
        args: vec![
            "extract-rpu".to_string(),
            "-i".to_string(),
            source_hevc.to_string_lossy().to_string(),
            "-o".to_string(),
            source_rpu.to_string_lossy().to_string(),
        ],
        reports_media_progress: false,
    };
    let encode = ProcessStep {
        code: "dv_encode_base_layer",
        label: format!("重编码 Dolby Vision {} 基础画面", route.output_label),
        program: RuntimeProgram::Ffmpeg,
        args: dolby_vision_encode_args(payload, input_file, &partial_output, video, route)?,
        reports_media_progress: true,
    };
    let extract_output = ProcessStep {
        code: "dv_extract_output_video",
        label: "提取输出 Dolby Vision 视频流".to_string(),
        program: RuntimeProgram::Ffmpeg,
        args: extract_hevc_args(&partial_output.to_string_lossy(), &output_hevc),
        reports_media_progress: false,
    };
    let extract_output_rpu = ProcessStep {
        code: "dv_extract_output_rpu",
        label: "提取输出 RPU 用于校验".to_string(),
        program: RuntimeProgram::DoviTool,
        args: vec![
            "extract-rpu".to_string(),
            "-i".to_string(),
            output_hevc.to_string_lossy().to_string(),
            "-o".to_string(),
            output_rpu.to_string_lossy().to_string(),
        ],
        reports_media_progress: false,
    };
    let export_source_rpu = export_rpu_json_step(
        "dv_export_source_rpu",
        "导出源 RPU 语义数据",
        &source_rpu,
        &source_rpu_json,
    );
    let export_output_rpu = export_rpu_json_step(
        "dv_export_output_rpu",
        "导出输出 RPU 语义数据",
        &output_rpu,
        &output_rpu_json,
    );

    Ok(TranscodePlan {
        steps: vec![
            TranscodeStep::Process(extract_source),
            TranscodeStep::Process(extract_source_rpu),
            TranscodeStep::Process(encode),
            TranscodeStep::Process(extract_output),
            TranscodeStep::Process(extract_output_rpu),
            TranscodeStep::Process(export_source_rpu),
            TranscodeStep::Process(export_output_rpu),
            TranscodeStep::VerifyDolbyVision(DolbyVisionVerification {
                output_file: partial_output.clone(),
                source_rpu_file: source_rpu,
                output_rpu_file: output_rpu,
                source_rpu_json_file: source_rpu_json,
                output_rpu_json_file: output_rpu_json,
                expected_profile: route.profile,
                expected_compatibility_id: route.compatibility_id,
                expected_width: video.width.unwrap_or_default(),
                expected_height: video.height.unwrap_or_default(),
                expected_fps: video.fps.unwrap_or_default(),
                expected_fps_fraction: fps_fraction.to_string(),
                expected_frame_count: Some(source_frame_count),
            }),
            TranscodeStep::FinalizeOutput {
                source: partial_output.clone(),
                target: PathBuf::from(output_file),
            },
        ],
        cleanup_paths: vec![workspace.clone(), partial_output],
        workspace: Some(workspace),
        warnings: vec![format!(
            "Dolby Vision {} 将保持原分辨率、原帧率和逐帧 RPU；任务完成前会执行输出校验。",
            route.output_label
        )],
        sanitized_advanced_args: None,
    })
}

/** 使用 dovi_tool 将逐帧 RPU 导出为可做语义比较的 JSON。 */
fn export_rpu_json_step(
    code: &'static str,
    label: &str,
    rpu_file: &Path,
    output_file: &Path,
) -> ProcessStep {
    ProcessStep {
        code,
        label: label.to_string(),
        program: RuntimeProgram::DoviTool,
        args: vec![
            "export".to_string(),
            "-i".to_string(),
            rpu_file.to_string_lossy().to_string(),
            "--data".to_string(),
            format!("all={}", output_file.to_string_lossy()),
        ],
        reports_media_progress: false,
    }
}

#[derive(Debug, Clone, Copy)]
struct DolbyVisionRoute {
    profile: u8,
    compatibility_id: u8,
    x265_profile: &'static str,
    output_label: &'static str,
}

/// 将 ffprobe DOVI configuration record 解析为首版支持的输出路线。
fn resolve_dolby_vision_route(video: &VideoStreamMetadata) -> StorageResult<DolbyVisionRoute> {
    match (
        video.dolby_vision_profile,
        video.dolby_vision_compatibility_id,
    ) {
        (Some(5), Some(0)) => Ok(DolbyVisionRoute {
            profile: 5,
            compatibility_id: 0,
            x265_profile: "5",
            output_label: "Profile 5",
        }),
        (Some(8), Some(1)) => Ok(DolbyVisionRoute {
            profile: 8,
            compatibility_id: 1,
            x265_profile: "8.1",
            output_label: "Profile 8.1",
        }),
        (profile, compatibility) => Err(StorageError::InvalidPayload(format!(
            "Dolby Vision source profile {} compatibility {} is not supported by the current RPU pipeline",
            profile.map_or_else(|| "-".to_string(), |value| value.to_string()),
            compatibility.map_or_else(|| "-".to_string(), |value| value.to_string())
        ))),
    }
}

/// 校验首版 RPU 保留路径不能安全支持的配置项。
fn validate_dolby_vision_payload(payload: &TaskConfigPayload) -> StorageResult<()> {
    if !matches!(payload.video.codec_format, VideoCodecFormat::H265)
        || !matches!(payload.video.encoder, VideoEncoder::Libx265)
        || !matches!(payload.video.bitrate_mode, VideoBitrateMode::Crf)
    {
        return Err(StorageError::InvalidPayload(
            "Dolby Vision RPU preservation requires H.265 + libx265 + CRF".to_string(),
        ));
    }
    if !matches!(payload.container.format, ContainerFormat::Mkv) {
        return Err(StorageError::InvalidPayload(
            "Dolby Vision RPU preservation currently requires MKV output".to_string(),
        ));
    }
    if !matches!(payload.audio.mode, AudioMode::Copy) {
        return Err(StorageError::InvalidPayload(
            "Dolby Vision RPU preservation currently requires audio copy mode".to_string(),
        ));
    }
    if payload.clip_range.is_some()
        || payload.video.resolution.is_some()
        || payload.video.fps.is_some()
        || payload.video.enable_two_pass
    {
        return Err(StorageError::InvalidPayload(
            "Dolby Vision RPU preservation does not allow trimming, resizing, frame-rate changes or 2-pass encoding"
                .to_string(),
        ));
    }
    if payload
        .advanced_args
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
    {
        return Err(StorageError::InvalidPayload(
            "Dolby Vision RPU preservation does not allow advanced FFmpeg arguments".to_string(),
        ));
    }
    if payload.video.crf.is_none() {
        return Err(StorageError::InvalidPayload(
            "CRF is required for Dolby Vision RPU preservation".to_string(),
        ));
    }

    Ok(())
}

/// 校验源视频的帧结构和 DOVI 层信息满足首版约束。
fn validate_dolby_vision_source(video: &VideoStreamMetadata) -> StorageResult<()> {
    if video.hdr_type.as_ref() != Some(&HdrType::DolbyVision)
        || video.codec_name.as_deref() != Some("hevc")
    {
        return Err(StorageError::InvalidPayload(
            "Dolby Vision RPU preservation requires an HEVC Dolby Vision source".to_string(),
        ));
    }
    if video.dolby_vision_rpu_present != Some(true)
        || video.dolby_vision_bl_present != Some(true)
        || video.dolby_vision_el_present == Some(true)
    {
        return Err(StorageError::InvalidPayload(
            "the current RPU pipeline requires a single-layer Dolby Vision source with BL and RPU"
                .to_string(),
        ));
    }
    if video.bit_depth.unwrap_or_default() < 10
        || video.width.unwrap_or_default() == 0
        || video.height.unwrap_or_default() == 0
        || video.fps.unwrap_or_default() <= 0.0
        || video.fps_fraction.is_none()
    {
        return Err(StorageError::InvalidPayload(
            "Dolby Vision RPU preservation requires 10-bit video with known size and frame rate"
                .to_string(),
        ));
    }
    Ok(())
}

fn ensure_dolby_vision_runtime() -> StorageResult<()> {
    if resolve_dovi_tool_path().is_none() || resolve_x265_path().is_none() {
        return Err(StorageError::InvalidPayload(
            "bundled Dolby Vision runtime requires dovi_tool and x265 CLI".to_string(),
        ));
    }
    Ok(())
}

fn extract_hevc_args(input_file: &str, output_file: &Path) -> Vec<String> {
    vec![
        "-y".to_string(),
        "-i".to_string(),
        input_file.to_string(),
        "-map".to_string(),
        "0:v:0".to_string(),
        "-c:v".to_string(),
        "copy".to_string(),
        "-bsf:v".to_string(),
        "hevc_mp4toannexb".to_string(),
        "-f".to_string(),
        "hevc".to_string(),
        output_file.to_string_lossy().to_string(),
    ]
}

fn dolby_vision_encode_args(
    payload: &TaskConfigPayload,
    input_file: &str,
    output_file: &Path,
    video: &VideoStreamMetadata,
    route: DolbyVisionRoute,
) -> StorageResult<Vec<String>> {
    let crf = payload.video.crf.ok_or_else(|| {
        StorageError::InvalidPayload("CRF is required for Dolby Vision encoding".to_string())
    })?;
    let preset = payload.video.preset.as_deref().unwrap_or("medium");
    let vbv = resolve_vbv_kbps(video);
    let mut x265_params = vec![
        format!("dolby-vision-profile={}", route.x265_profile),
        format!("vbv-maxrate={vbv}"),
        format!("vbv-bufsize={vbv}"),
        "hrd=1".to_string(),
        "colorprim=bt2020".to_string(),
        "transfer=smpte2084".to_string(),
    ];

    match route.profile {
        5 => {
            // Profile 5 使用 IPT-PQ-C2 与 full range，不能按 HDR10 BT.2020NC 链路重标记。
            x265_params.push("colormatrix=ipt-pq-c2".to_string());
            x265_params.push("range=full".to_string());
        }
        8 => {
            x265_params.push("colormatrix=bt2020nc".to_string());
            x265_params.push("range=limited".to_string());
            x265_params.push("hdr10=1".to_string());
            if let Some(mastering_display) = &video.mastering_display {
                x265_params.push(format!("master-display={mastering_display}"));
            }
            if let (Some(max_cll), Some(max_fall)) = (
                video.max_content_light_level,
                video.max_frame_average_light_level,
            ) {
                x265_params.push(format!("max-cll={max_cll},{max_fall}"));
            }
        }
        _ => unreachable!("route validation only returns Profile 5 or 8.1"),
    }

    let mut args = vec![
        "-y".to_string(),
        "-i".to_string(),
        input_file.to_string(),
        "-map".to_string(),
        "0:v:0".to_string(),
        "-map".to_string(),
        "0:a?".to_string(),
        "-map".to_string(),
        "0:s?".to_string(),
        "-map".to_string(),
        "0:t?".to_string(),
        "-map_metadata".to_string(),
        "0".to_string(),
        "-map_chapters".to_string(),
        "0".to_string(),
        "-c".to_string(),
        "copy".to_string(),
        "-c:v".to_string(),
        "libx265".to_string(),
        "-profile:v".to_string(),
        "main10".to_string(),
        "-preset".to_string(),
        preset.to_string(),
        "-crf".to_string(),
        crf.to_string(),
        "-pix_fmt".to_string(),
        "yuv420p10le".to_string(),
        "-dolbyvision".to_string(),
        "1".to_string(),
        "-x265-params".to_string(),
        x265_params.join(":"),
    ];
    if let Some(gop) = payload.video.gop {
        args.push("-g".to_string());
        args.push(gop.to_string());
    }
    append_reencoded_video_metadata_cleanup(&mut args);
    args.push("-f".to_string());
    args.push("matroska".to_string());
    args.push(output_file.to_string_lossy().to_string());
    Ok(args)
}

/// DV 需要 VBV/HRD；这里设置宽松峰值上限，不把它当作目标平均码率。
fn resolve_vbv_kbps(video: &VideoStreamMetadata) -> u32 {
    let pixels =
        u64::from(video.width.unwrap_or_default()) * u64::from(video.height.unwrap_or_default());
    if pixels <= 1920 * 1080 {
        30_000
    } else if pixels <= 3840 * 2160 {
        80_000
    } else {
        120_000
    }
}

fn partial_output_path(output_file: &str, job_id: &str) -> StorageResult<PathBuf> {
    let output = Path::new(output_file);
    let parent = output.parent().ok_or_else(|| {
        StorageError::InvalidPayload("output path must have a parent directory".to_string())
    })?;
    let name = output
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| StorageError::InvalidPayload("output file name is invalid".to_string()))?;
    let extension = output
        .extension()
        .and_then(|value| value.to_str())
        .ok_or_else(|| {
            StorageError::InvalidPayload("output file extension is invalid".to_string())
        })?;
    Ok(parent.join(format!(".{name}.{job_id}.partial.{extension}")))
}

fn shell_join(args: &[String]) -> String {
    args.iter()
        .map(|value| shell_quote(value))
        .collect::<Vec<_>>()
        .join(" ")
}

fn shell_quote(value: &str) -> String {
    if !value.is_empty()
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || "-_./:=+,?".contains(ch))
    {
        return value.to_string();
    }
    format!("\"{}\"", value.replace('"', "\\\""))
}

#[cfg(test)]
mod tests {
    use super::{
        build_transcode_plan, dolby_vision_encode_args, resolve_dolby_vision_route,
        validate_dolby_vision_source, TranscodeStep,
    };
    use crate::{
        models::{
            task::{
                AudioConfig, AudioMode, ContainerConfig, ContainerFormat, OutputConfig,
                VideoBitrateMode, VideoCodecFormat, VideoConfig, VideoEncoder,
            },
            TaskConfigPayload,
        },
        probe::video_metadata::{HdrType, VideoStreamMetadata},
    };
    use std::path::Path;

    fn video(profile: u8, compatibility_id: u8) -> VideoStreamMetadata {
        VideoStreamMetadata {
            codec_name: Some("hevc".to_string()),
            codec_long_name: None,
            profile: Some("Main 10".to_string()),
            width: Some(3840),
            height: Some(2160),
            pix_fmt: Some("yuv420p10le".to_string()),
            fps: Some(23.976),
            fps_fraction: Some("24000/1001".to_string()),
            variable_frame_rate: false,
            frame_count: Some(240),
            bit_rate_kbps: Some(20_000),
            size_bytes: None,
            color_primaries: None,
            color_transfer: None,
            color_space: None,
            color_range: Some("pc".to_string()),
            bit_depth: Some(10),
            hdr_type: Some(HdrType::DolbyVision),
            dolby_vision_profile: Some(profile),
            dolby_vision_level: Some(6),
            dolby_vision_compatibility_id: Some(compatibility_id),
            dolby_vision_rpu_present: Some(true),
            dolby_vision_el_present: Some(false),
            dolby_vision_bl_present: Some(true),
            max_content_light_level: None,
            max_frame_average_light_level: None,
            mastering_display_max_luminance: None,
            mastering_display_min_luminance: None,
            mastering_display: None,
        }
    }

    /** 构造满足专用 DV 计划约束的最小任务。 */
    fn payload() -> TaskConfigPayload {
        TaskConfigPayload {
            name: "dv-test".to_string(),
            clip_range: None,
            video: VideoConfig {
                codec_format: VideoCodecFormat::H265,
                encoder: VideoEncoder::Libx265,
                bitrate_mode: VideoBitrateMode::Crf,
                crf: Some(23),
                preset: Some("medium".to_string()),
                preserve_dolby_vision_metadata: Some(true),
                profile: None,
                tune: None,
                resolution: None,
                fps: None,
                pixel_format: Some("yuv420p10le".to_string()),
                gop: None,
                enable_two_pass: false,
            },
            audio: AudioConfig {
                mode: AudioMode::Copy,
                custom_args: None,
            },
            container: ContainerConfig {
                format: ContainerFormat::Mkv,
                faststart: Some(false),
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
    fn profile_5_compatibility_0_should_use_profile_5_route() {
        let route = resolve_dolby_vision_route(&video(5, 0)).expect("route");
        assert_eq!(route.x265_profile, "5");
        assert_eq!(route.compatibility_id, 0);
    }

    #[test]
    fn profile_81_should_use_hdr10_compatible_route() {
        let route = resolve_dolby_vision_route(&video(8, 1)).expect("route");
        assert_eq!(route.x265_profile, "8.1");
        assert_eq!(route.compatibility_id, 1);
    }

    #[test]
    fn enhancement_layer_source_should_be_rejected_by_single_layer_pipeline() {
        let mut source = video(7, 6);
        source.dolby_vision_el_present = Some(true);
        let error = validate_dolby_vision_source(&source).expect_err("should reject P7 EL");
        assert!(error.to_string().contains("single-layer"));
    }

    #[test]
    fn profile_5_encode_should_keep_ipt_full_range_chain() {
        let source = video(5, 0);
        let route = resolve_dolby_vision_route(&source).expect("route");
        let args = dolby_vision_encode_args(
            &payload(),
            "input.mkv",
            Path::new("output.mkv"),
            &source,
            route,
        )
        .expect("encode args");
        let joined = args.join(" ");

        assert!(joined.contains("dolby-vision-profile=5"));
        assert!(joined.contains("colormatrix=ipt-pq-c2"));
        assert!(joined.contains("range=full"));
        assert!(!joined.contains("hdr10=1"));
        assert!(joined.contains("-metadata:s:v:0 BPS="));
        assert!(joined.contains("-metadata:s:v:0 NUMBER_OF_BYTES="));
    }

    #[test]
    fn profile_81_encode_should_keep_hdr10_compatible_chain() {
        let mut source = video(8, 1);
        source.mastering_display = Some(
            "G(13250,34500)B(7500,3000)R(34000,16000)WP(15635,16450)L(10000000,1)".to_string(),
        );
        source.max_content_light_level = Some(1000);
        source.max_frame_average_light_level = Some(400);
        let route = resolve_dolby_vision_route(&source).expect("route");
        let args = dolby_vision_encode_args(
            &payload(),
            "input.mkv",
            Path::new("output.mkv"),
            &source,
            route,
        )
        .expect("encode args");
        let joined = args.join(" ");

        assert!(joined.contains("dolby-vision-profile=8.1"));
        assert!(joined.contains("colormatrix=bt2020nc"));
        assert!(joined.contains("range=limited"));
        assert!(joined.contains("hdr10=1"));
        assert!(joined.contains("max-cll=1000,400"));
        assert!(joined.contains("master-display="));
    }

    #[test]
    fn ordinary_plan_should_publish_from_same_container_partial_file() {
        let mut ordinary = payload();
        ordinary.video.preserve_dolby_vision_metadata = Some(false);
        ordinary.container.format = ContainerFormat::Mp4;
        let plan = build_transcode_plan(
            &ordinary,
            "/tmp/input.mkv",
            "/tmp/output.mp4",
            "job-1",
            Path::new("/tmp/runtime"),
        )
        .expect("ordinary plan");

        let TranscodeStep::FinalizeOutput { source, target } =
            plan.steps.last().expect("finalize step")
        else {
            panic!("ordinary output must use finalize step");
        };
        assert_eq!(source, Path::new("/tmp/.output.mp4.job-1.partial.mp4"));
        assert_eq!(target, Path::new("/tmp/output.mp4"));
        assert!(plan.cleanup_paths.contains(source));
    }
}
