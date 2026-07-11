use crate::{
    ffmpeg_args::{guard_advanced_output_args, guard_audio_output_args},
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

        // 默认执行链路优先使用随包 runtime；这里保留 system 字段值以兼容旧配置。
        if !matches!(self.ffmpeg_strategy.as_str(), "bundled" | "system") {
            return Err(StorageError::InvalidPayload(
                "ffmpegStrategy must be 'bundled' or 'system'".to_string(),
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

        // 模型写入边界与命令构建层复用相同的 I/O 防线，非法高级参数不能先落盘再延迟失败。
        guard_advanced_output_args(self.advanced_args.as_deref())?;

        if let Some(clip_range) = &self.clip_range {
            if clip_range.end_ms <= clip_range.start_ms {
                return Err(StorageError::InvalidPayload(
                    "clipRange.endMs must be greater than clipRange.startMs".to_string(),
                ));
            }
        }

        let copies_video_stream = matches!(self.video.codec_format, VideoCodecFormat::Copy);
        if copies_video_stream {
            // Copy 是独立的流复制语义：编码器必须同步为 copy，且不能混入结构化重编码字段。
            if !matches!(self.video.encoder, VideoEncoder::Copy) {
                return Err(StorageError::InvalidPayload(
                    "codecFormat=copy requires encoder=copy".to_string(),
                ));
            }

            if self.video.crf.is_some()
                || self.video.preset.is_some()
                || self.video.preserve_dolby_vision_metadata.unwrap_or(false)
                || self.video.profile.is_some()
                || self.video.tune.is_some()
                || self.video.resolution.is_some()
                || self.video.fps.is_some()
                || self.video.pixel_format.is_some()
                || self.video.gop.is_some()
                || self.video.enable_two_pass
            {
                return Err(StorageError::InvalidPayload(
                    "codecFormat=copy cannot include structured video re-encode fields".to_string(),
                ));
            }
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

        // bitrateMode 是兼容旧数据的必填枚举；Copy 不消费它，也不要求 CRF 或 -b:v。
        if !copies_video_stream {
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

        if self.video.preserve_dolby_vision_metadata.unwrap_or(false)
            && !matches!(
                (&self.video.codec_format, &self.video.encoder),
                (VideoCodecFormat::H265, VideoEncoder::Libx265)
            )
        {
            return Err(StorageError::InvalidPayload(
                "preserveDolbyVisionMetadata currently only supports H.265 + libx265".to_string(),
            ));
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
                let custom_args = self
                    .audio
                    .custom_args
                    .as_ref()
                    .filter(|value| !value.trim().is_empty())
                    .ok_or_else(|| {
                        StorageError::InvalidPayload(
                            "audio.customArgs is required when audio.mode is custom".to_string(),
                        )
                    })?;

                // 模板、任务和预览共享同一条白名单，避免不安全参数先进入持久化层。
                guard_audio_output_args(custom_args)?;
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
        VideoEncoder::H264Videotoolbox
        | VideoEncoder::HevcVideotoolbox
        | VideoEncoder::Av1Videotoolbox => false,
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
    &[
        "p1", "p2", "p3", "p4", "p5", "p6", "p7", "fast", "medium", "slow", "hq",
    ]
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

#[cfg(test)]
mod tests {
    use crate::models::task::{
        AudioConfig, AudioMode, ContainerConfig, ContainerFormat, OutputConfig, Resolution,
        TaskConfigPayload, VideoBitrateMode, VideoCodecFormat, VideoConfig, VideoEncoder,
    };

    use super::Validate;

    /** 构造不携带重编码字段的最小 Copy payload。 */
    fn copy_payload() -> TaskConfigPayload {
        TaskConfigPayload {
            name: "copy-task".to_string(),
            clip_range: None,
            video: VideoConfig {
                codec_format: VideoCodecFormat::Copy,
                encoder: VideoEncoder::Copy,
                // bitrateMode 为兼容字段，Copy 路径不会消费该值。
                bitrate_mode: VideoBitrateMode::Crf,
                crf: None,
                preset: None,
                preserve_dolby_vision_metadata: Some(false),
                profile: None,
                tune: None,
                resolution: None,
                fps: None,
                pixel_format: None,
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

    /** 断言单个结构化重编码字段足以让 Copy payload 失效。 */
    fn assert_copy_reencode_field_rejected(configure: impl FnOnce(&mut TaskConfigPayload)) {
        let mut payload = copy_payload();
        configure(&mut payload);

        let error = payload
            .validate()
            .expect_err("copy field should be rejected");
        assert!(error
            .to_string()
            .contains("structured video re-encode fields"));
    }

    #[test]
    fn copy_codec_requires_copy_encoder() {
        let mut payload = copy_payload();
        payload.video.encoder = VideoEncoder::Libx264;

        let error = payload
            .validate()
            .expect_err("encoder mismatch should fail");
        assert!(error.to_string().contains("requires encoder=copy"));
    }

    #[test]
    fn copy_codec_accepts_payload_without_reencode_fields() {
        for bitrate_mode in [
            VideoBitrateMode::Crf,
            VideoBitrateMode::Cbr,
            VideoBitrateMode::Abr,
        ] {
            let mut payload = copy_payload();
            payload.video.bitrate_mode = bitrate_mode;
            payload
                .validate()
                .expect("copy payload should ignore bitrateMode compatibility field");
        }
    }

    #[test]
    fn copy_codec_rejects_every_structured_reencode_field() {
        assert_copy_reencode_field_rejected(|payload| payload.video.crf = Some(23));
        assert_copy_reencode_field_rejected(|payload| {
            payload.video.preset = Some("medium".to_string())
        });
        assert_copy_reencode_field_rejected(|payload| {
            payload.video.preserve_dolby_vision_metadata = Some(true)
        });
        assert_copy_reencode_field_rejected(|payload| {
            payload.video.profile = Some("main".to_string())
        });
        assert_copy_reencode_field_rejected(|payload| {
            payload.video.tune = Some("film".to_string())
        });
        assert_copy_reencode_field_rejected(|payload| {
            payload.video.resolution = Some(Resolution {
                width: 1920,
                height: 1080,
            })
        });
        assert_copy_reencode_field_rejected(|payload| payload.video.fps = Some(24.0));
        assert_copy_reencode_field_rejected(|payload| {
            payload.video.pixel_format = Some("yuv420p".to_string())
        });
        assert_copy_reencode_field_rejected(|payload| payload.video.gop = Some(48));
        assert_copy_reencode_field_rejected(|payload| payload.video.enable_two_pass = true);
    }

    #[test]
    fn custom_audio_accepts_whitelisted_output_options() {
        let mut payload = copy_payload();
        payload.audio.mode = AudioMode::Custom;
        payload.audio.custom_args = Some("-c:a aac -b:a 320k -ar 48000 -ac 2".to_string());

        payload
            .validate()
            .expect("whitelisted audio output options should pass");
    }

    #[test]
    fn custom_audio_rejects_non_audio_and_managed_io_options() {
        for custom_args in [
            "-c:a aac -c:v libx264",
            "-c:a aac -i injected.wav",
            "-c:a aac extra.mka",
            "-c:a aac -f tee",
            "-c:a aac -af astats=metadata=1,ametadata=mode=print:file=/tmp/audio.txt",
        ] {
            let mut payload = copy_payload();
            payload.audio.mode = AudioMode::Custom;
            payload.audio.custom_args = Some(custom_args.to_string());

            payload
                .validate()
                .expect_err("unsafe custom audio option should fail validation");
        }
    }

    #[test]
    fn advanced_args_rejects_managed_io_overrides_before_persistence() {
        for advanced_args in [
            "-i injected.mov",
            "-map 0:v:0 extra.mp4",
            "-shortest injected.mkv",
        ] {
            let mut payload = copy_payload();
            payload.advanced_args = Some(advanced_args.to_string());

            payload
                .validate()
                .expect_err("managed I/O override should fail model validation");
        }
    }
}
