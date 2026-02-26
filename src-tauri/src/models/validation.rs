use crate::{
    models::{
        task::{AudioMode, VideoBitrateMode, VideoCodecFormat, VideoEncoder},
        AppSettings, TaskConfigPayload, TemplatePayload,
    },
    storage::errors::{StorageError, StorageResult},
};

/// 统一校验入口：
/// 所有写入型命令在落盘前必须调用 validate，避免脏数据进入存储层。
pub trait Validate {
    fn validate(&self) -> StorageResult<()>;
}

impl Validate for AppSettings {
    fn validate(&self) -> StorageResult<()> {
        // V1 约束：并发范围固定在 1-8，避免用户误配导致资源争抢或无效配置。
        if !(1..=8).contains(&self.concurrency_n) {
            return Err(StorageError::InvalidPayload(
                "concurrencyN must be between 1 and 8".to_string(),
            ));
        }

        // V1 仅支持系统 ffmpeg 路径策略。
        if self.ffmpeg_strategy != "system" {
            return Err(StorageError::InvalidPayload(
                "ffmpegStrategy must be 'system' in v1".to_string(),
            ));
        }

        Ok(())
    }
}

impl Validate for TaskConfigPayload {
    fn validate(&self) -> StorageResult<()> {
        // 基础必填校验
        if self.name.trim().is_empty() {
            return Err(StorageError::InvalidPayload(
                "task name cannot be empty".to_string(),
            ));
        }

        if self.output.file_name_pattern.trim().is_empty() {
            return Err(StorageError::InvalidPayload(
                "output.fileNamePattern cannot be empty".to_string(),
            ));
        }

        if self.output.overwrite != "autoRename" {
            return Err(StorageError::InvalidPayload(
                "output.overwrite must be autoRename".to_string(),
            ));
        }

        // 数值边界校验
        if let Some(resolution) = &self.video.resolution {
            if resolution.width == 0 || resolution.height == 0 {
                return Err(StorageError::InvalidPayload(
                    "video.resolution width/height must be greater than 0".to_string(),
                ));
            }
        }

        if let Some(fps) = self.video.fps {
            if fps <= 0.0 {
                return Err(StorageError::InvalidPayload(
                    "video.fps must be greater than 0".to_string(),
                ));
            }
        }

        match self.video.bitrate_mode {
            VideoBitrateMode::Crf => {
                if self.video.crf.is_none() {
                    return Err(StorageError::InvalidPayload(
                        "video.crf is required when bitrateMode is CRF".to_string(),
                    ));
                }
                if !supports_crf(&self.video.encoder) {
                    return Err(StorageError::InvalidPayload(
                        "selected encoder does not support CRF mode".to_string(),
                    ));
                }
            }
            VideoBitrateMode::Cbr | VideoBitrateMode::Abr => {
                // V1 当前没有结构化 bitrate 字段，CBR/ABR 需要用户通过 advancedArgs 提供 -b:v。
                if !contains_video_bitrate_flag(self.advanced_args.as_deref()) {
                    return Err(StorageError::InvalidPayload(
                        "bitrateMode CBR/ABR requires -b:v in advancedArgs".to_string(),
                    ));
                }
            }
        }

        // 编码联动校验：
        // 1) copy 模式不允许 2-pass
        // 2) 不支持 2-pass 的硬件编码器不允许开启
        if self.video.enable_two_pass {
            if matches!(self.video.codec_format, VideoCodecFormat::Copy) {
                return Err(StorageError::InvalidPayload(
                    "2-pass cannot be enabled for codecFormat=copy".to_string(),
                ));
            }

            if !supports_two_pass(&self.video.encoder) {
                return Err(StorageError::InvalidPayload(
                    "selected encoder does not support 2-pass".to_string(),
                ));
            }
        }

        // 编码器必须和编码格式匹配。
        if !encoder_matches_codec(self.video.encoder.clone(), self.video.codec_format.clone()) {
            return Err(StorageError::InvalidPayload(
                "video.encoder is incompatible with video.codecFormat".to_string(),
            ));
        }

        if let Some(preset) = &self.video.preset {
            if !is_preset_allowed(&self.video.encoder, preset) {
                return Err(StorageError::InvalidPayload(format!(
                    "preset '{preset}' is not supported by selected encoder"
                )));
            }
        }

        // 音频模式联动校验：
        // - copy 模式不能携带 customArgs
        // - custom 模式必须提供 customArgs
        match self.audio.mode {
            AudioMode::Copy if self.audio.custom_args.is_some() => {
                return Err(StorageError::InvalidPayload(
                    "audio.customArgs must be empty when audio.mode is copy".to_string(),
                ));
            }
            AudioMode::Custom => {
                if self
                    .audio
                    .custom_args
                    .as_ref()
                    .is_none_or(|value| value.trim().is_empty())
                {
                    return Err(StorageError::InvalidPayload(
                        "audio.customArgs is required when audio.mode is custom".to_string(),
                    ));
                }
            }
            _ => {}
        }

        Ok(())
    }
}

impl Validate for TemplatePayload {
    fn validate(&self) -> StorageResult<()> {
        if self.name.trim().is_empty() {
            return Err(StorageError::InvalidPayload(
                "template name cannot be empty".to_string(),
            ));
        }

        // 模板快照本质是任务配置，复用同一套校验规则。
        self.task_config_snapshot.validate()
    }
}

/// 编码器能力约束：硬件编码器与 copy 不支持 2-pass。
fn supports_two_pass(encoder: &VideoEncoder) -> bool {
    !matches!(
        encoder,
        VideoEncoder::HevcNvenc
            | VideoEncoder::Av1Nvenc
            | VideoEncoder::H264Videotoolbox
            | VideoEncoder::HevcVideotoolbox
            | VideoEncoder::Av1Videotoolbox
            | VideoEncoder::Copy
    )
}

fn supports_crf(encoder: &VideoEncoder) -> bool {
    matches!(
        encoder,
        VideoEncoder::Libx264
            | VideoEncoder::Libx265
            | VideoEncoder::LibaomAv1
            | VideoEncoder::Svtav1
            | VideoEncoder::LibvpxVp9
    )
}

fn contains_video_bitrate_flag(advanced_args: Option<&str>) -> bool {
    let Some(raw) = advanced_args else {
        return false;
    };

    let tokens: Vec<&str> = raw.split_whitespace().collect();
    tokens
        .windows(2)
        .any(|pair| pair[0] == "-b:v" && !pair[1].starts_with('-'))
}

fn is_preset_allowed(encoder: &VideoEncoder, preset: &str) -> bool {
    match encoder {
        VideoEncoder::Libx264
        | VideoEncoder::Libx265
        | VideoEncoder::LibaomAv1
        | VideoEncoder::Svtav1
        | VideoEncoder::LibvpxVp9 => software_preset_set().contains(&preset),
        VideoEncoder::HevcNvenc | VideoEncoder::Av1Nvenc => nvenc_preset_set().contains(&preset),
        VideoEncoder::H264Videotoolbox | VideoEncoder::HevcVideotoolbox | VideoEncoder::Av1Videotoolbox => false,
        VideoEncoder::Copy => false,
    }
}

fn software_preset_set() -> &'static [&'static str] {
    &[
        "ultrafast",
        "superfast",
        "veryfast",
        "faster",
        "fast",
        "medium",
        "slow",
        "slower",
        "veryslow",
        "placebo",
    ]
}

fn nvenc_preset_set() -> &'static [&'static str] {
    &["p1", "p2", "p3", "p4", "p5", "p6", "p7", "fast", "medium", "slow", "hq"]
}

/// 编码器与编码格式匹配关系表。
fn encoder_matches_codec(encoder: VideoEncoder, codec: VideoCodecFormat) -> bool {
    match codec {
        VideoCodecFormat::H264 => matches!(
            encoder,
            VideoEncoder::Libx264 | VideoEncoder::H264Videotoolbox
        ),
        VideoCodecFormat::H265 => matches!(
            encoder,
            VideoEncoder::Libx265 | VideoEncoder::HevcVideotoolbox | VideoEncoder::HevcNvenc
        ),
        VideoCodecFormat::Av1 => matches!(
            encoder,
            VideoEncoder::LibaomAv1
                | VideoEncoder::Svtav1
                | VideoEncoder::Av1Nvenc
                | VideoEncoder::Av1Videotoolbox
        ),
        VideoCodecFormat::Vp9 => matches!(encoder, VideoEncoder::LibvpxVp9),
        VideoCodecFormat::Copy => matches!(encoder, VideoEncoder::Copy),
    }
}
