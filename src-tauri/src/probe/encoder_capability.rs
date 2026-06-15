use serde::{Deserialize, Serialize};
use std::collections::HashSet;

use crate::ffmpeg_runtime::ffmpeg_command;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EncoderCapability {
    pub codec_format: String,
    pub encoder: String,
    pub available: bool,
    pub supports_two_pass: bool,
    pub supports_crf: bool,
    pub presets: Vec<String>,
    pub display_name: String,
    pub description: String,
    pub speed_level: String,
    pub quality_level: String,
    pub requires_hardware: bool,
    pub platform_hints: Vec<String>,
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EncoderCapabilityResult {
    pub source: String,
    pub items: Vec<EncoderCapability>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EncoderMeta {
    codec_format: String,
    encoder: String,
    display_name: String,
    description: String,
    speed_level: String,
    quality_level: String,
    requires_hardware: bool,
    platform_hints: Vec<String>,
    notes: Vec<String>,
}

pub fn probe_encoder_capabilities() -> EncoderCapabilityResult {
    let encoders_output = query_encoders().ok().unwrap_or_default();
    let detected = parse_encoders_output(&encoders_output);
    let metas = load_encoder_meta();

    let items = if encoders_output.is_empty() {
        vec![]
    } else {
        metas
            .into_iter()
            .map(|meta| EncoderCapability {
                available: detected.contains(&meta.encoder),
                supports_two_pass: supports_two_pass(&meta.encoder),
                supports_crf: supports_crf(&meta.encoder),
                presets: presets_for(&meta.encoder),
                codec_format: meta.codec_format,
                encoder: meta.encoder,
                display_name: meta.display_name,
                description: meta.description,
                speed_level: meta.speed_level,
                quality_level: meta.quality_level,
                requires_hardware: meta.requires_hardware,
                platform_hints: meta.platform_hints,
                notes: meta.notes,
            })
            .collect()
    };

    EncoderCapabilityResult {
        source: "runtime_probe".to_string(),
        items,
    }
}

fn load_encoder_meta() -> Vec<EncoderMeta> {
    let raw = include_str!("encoder_meta.json");
    serde_json::from_str(raw).unwrap_or_default()
}

fn supports_two_pass(encoder: &str) -> bool {
    !matches!(
        encoder,
        "hevc_nvenc"
            | "av1_nvenc"
            | "h264_videotoolbox"
            | "hevc_videotoolbox"
            | "av1_videotoolbox"
            | "copy"
    )
}

fn supports_crf(encoder: &str) -> bool {
    matches!(
        encoder,
        "libx264" | "libx265" | "libaom-av1" | "svtav1" | "libvpx-vp9"
    )
}

fn presets_for(encoder: &str) -> Vec<String> {
    if matches!(
        encoder,
        "libx264" | "libx265" | "libaom-av1" | "svtav1" | "libvpx-vp9"
    ) {
        return [
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
        .iter()
        .map(|v| v.to_string())
        .collect();
    }

    if matches!(encoder, "hevc_nvenc" | "av1_nvenc") {
        return [
            "p1", "p2", "p3", "p4", "p5", "p6", "p7", "fast", "medium", "slow", "hq",
        ]
        .iter()
        .map(|v| v.to_string())
        .collect();
    }

    vec![]
}

fn query_encoders() -> Result<String, std::io::Error> {
    let output = ffmpeg_command()
        .args(["-hide_banner", "-encoders"])
        .output()?;
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

pub(crate) fn parse_encoders_output(output: &str) -> HashSet<String> {
    let mut set = HashSet::new();

    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with("Encoders:") {
            continue;
        }

        let mut parts = trimmed.split_whitespace();
        let Some(flag_token) = parts.next() else {
            continue;
        };

        if flag_token.len() < 2 {
            continue;
        }

        if let Some(encoder_name) = parts.next() {
            set.insert(encoder_name.to_string());
        }
    }

    set
}

#[cfg(test)]
mod tests {
    use super::{load_encoder_meta, parse_encoders_output, probe_encoder_capabilities};

    #[test]
    fn parse_encoders_output_contains_known_names() {
        let text =
            "Encoders:\n V..... libx264 H.264\n V..... hevc_nvenc NVIDIA NVENC\n V..... libaom-av1 AV1\n";
        let set = parse_encoders_output(text);
        assert!(set.contains("libx264"));
        assert!(set.contains("hevc_nvenc"));
        assert!(set.contains("libaom-av1"));
    }

    #[test]
    fn capability_rule_is_fixed_for_nvenc_and_libx264() {
        let result = probe_encoder_capabilities();

        let nvenc = result.items.iter().find(|v| v.encoder == "hevc_nvenc");
        if let Some(item) = nvenc {
            assert!(!item.supports_two_pass);
            assert!(!item.supports_crf);
        }

        let x264 = result.items.iter().find(|v| v.encoder == "libx264");
        if let Some(item) = x264 {
            assert!(item.supports_two_pass);
            assert!(item.supports_crf);
            assert_eq!(item.display_name, "x264 (Software)");
        }
    }

    #[test]
    fn encoder_meta_json_should_have_av1_and_vp9() {
        let metas = load_encoder_meta();
        assert!(metas.iter().any(|v| v.encoder == "libaom-av1"));
        assert!(metas.iter().any(|v| v.encoder == "libvpx-vp9"));
    }
}
