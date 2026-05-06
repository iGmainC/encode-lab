use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::BTreeSet, path::Path, process::Command};

use crate::commands::error::CommandError;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoMetadataResult {
    pub input_file: String,
    pub container_format: Option<String>,
    pub duration_sec: Option<f64>,
    pub size_bytes: Option<u64>,
    pub bit_rate_kbps: Option<u64>,
    pub video: Option<VideoStreamMetadata>,
    pub audio: Option<AudioStreamMetadata>,
    pub tags: Vec<String>,
    pub raw_probe_version: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoStreamMetadata {
    pub codec_name: Option<String>,
    pub codec_long_name: Option<String>,
    pub profile: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub pix_fmt: Option<String>,
    pub fps: Option<f64>,
    pub bit_rate_kbps: Option<u64>,
    pub color_primaries: Option<String>,
    pub color_transfer: Option<String>,
    pub color_space: Option<String>,
    pub bit_depth: Option<u8>,
    pub hdr_type: Option<HdrType>,
    pub max_content_light_level: Option<u32>,
    pub max_frame_average_light_level: Option<u32>,
    pub mastering_display_max_luminance: Option<f64>,
    pub mastering_display_min_luminance: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioStreamMetadata {
    pub codec_name: Option<String>,
    pub channels: Option<u32>,
    pub sample_rate: Option<u32>,
    pub bit_rate_kbps: Option<u64>,
    pub channel_layout: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub enum HdrType {
    Sdr,
    Hdr10,
    Hlg,
    DolbyVision,
    Unknown,
}

#[derive(Debug, Deserialize)]
struct FfprobeOutput {
    format: Option<FfprobeFormat>,
    streams: Option<Vec<FfprobeStream>>,
}

#[derive(Debug, Deserialize)]
struct FfprobeFormat {
    format_name: Option<String>,
    duration: Option<String>,
    size: Option<String>,
    bit_rate: Option<String>,
}

#[derive(Debug, Deserialize)]
struct FfprobeStream {
    codec_type: Option<String>,
    codec_name: Option<String>,
    codec_long_name: Option<String>,
    codec_tag_string: Option<String>,
    profile: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    pix_fmt: Option<String>,
    avg_frame_rate: Option<String>,
    r_frame_rate: Option<String>,
    bit_rate: Option<String>,
    bits_per_raw_sample: Option<String>,
    color_primaries: Option<String>,
    color_transfer: Option<String>,
    color_space: Option<String>,
    channels: Option<u32>,
    sample_rate: Option<String>,
    channel_layout: Option<String>,
    side_data_list: Option<Vec<Value>>,
}

pub fn read_video_metadata(input_file: &str) -> Result<VideoMetadataResult, CommandError> {
    if input_file.trim().is_empty() {
        return Err(CommandError::new(
            "invalid_payload",
            "inputFile cannot be empty",
        ));
    }

    if !Path::new(input_file).exists() {
        return Err(CommandError::new("not_found", "input file does not exist"));
    }

    if !ffprobe_exists() {
        return Err(CommandError::new(
            "ffprobe_unavailable",
            "ffprobe not found in PATH",
        ));
    }

    let raw_json = run_ffprobe(input_file)?;
    let parsed: FfprobeOutput = serde_json::from_str(&raw_json)
        .map_err(|err| CommandError::new("json_parse_error", err.to_string()))?;

    Ok(convert_probe_output(input_file, parsed))
}

fn ffprobe_exists() -> bool {
    Command::new("which")
        .arg("ffprobe")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn run_ffprobe(input_file: &str) -> Result<String, CommandError> {
    let output = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            "-show_frames",
            "-read_intervals",
            "%+#1",
            input_file,
        ])
        .output()
        .map_err(|err| CommandError::new("probe_failed", err.to_string()))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(CommandError::new("probe_failed", stderr));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn convert_probe_output(input_file: &str, parsed: FfprobeOutput) -> VideoMetadataResult {
    let format = parsed.format;
    let streams = parsed.streams.unwrap_or_default();

    let video_stream = streams
        .iter()
        .find(|stream| stream.codec_type.as_deref() == Some("video"));
    let audio_stream = streams
        .iter()
        .find(|stream| stream.codec_type.as_deref() == Some("audio"));

    let video = video_stream.map(map_video_stream);
    let audio = audio_stream.map(map_audio_stream);

    let container_format = format
        .as_ref()
        .and_then(|f| f.format_name.as_deref())
        .map(normalize_container_tag);
    let duration_sec = format
        .as_ref()
        .and_then(|f| f.duration.as_deref())
        .and_then(parse_f64);
    let size_bytes = format
        .as_ref()
        .and_then(|f| f.size.as_deref())
        .and_then(parse_u64);
    let bit_rate_kbps = format
        .as_ref()
        .and_then(|f| f.bit_rate.as_deref())
        .and_then(parse_u64)
        .map(|value| value / 1000);

    let tags = build_tags(&container_format, video.as_ref());

    VideoMetadataResult {
        input_file: input_file.to_string(),
        container_format,
        duration_sec,
        size_bytes,
        bit_rate_kbps,
        video,
        audio,
        tags,
        raw_probe_version: None,
    }
}

fn map_video_stream(stream: &FfprobeStream) -> VideoStreamMetadata {
    let fps = stream
        .avg_frame_rate
        .as_deref()
        .and_then(parse_fraction)
        .or_else(|| stream.r_frame_rate.as_deref().and_then(parse_fraction));

    let bit_depth = stream
        .bits_per_raw_sample
        .as_deref()
        .and_then(parse_u64)
        .and_then(|v| u8::try_from(v).ok())
        .or_else(|| {
            stream
                .pix_fmt
                .as_deref()
                .and_then(infer_bit_depth_from_pix_fmt)
        });

    let hdr_type = detect_hdr_type(stream);
    let (max_content_light_level, max_frame_average_light_level) =
        extract_content_light_level(stream);
    let (mastering_display_max_luminance, mastering_display_min_luminance) =
        extract_mastering_luminance(stream);

    VideoStreamMetadata {
        codec_name: stream.codec_name.clone(),
        codec_long_name: stream.codec_long_name.clone(),
        profile: stream.profile.clone(),
        width: stream.width,
        height: stream.height,
        pix_fmt: stream.pix_fmt.clone(),
        fps,
        bit_rate_kbps: stream
            .bit_rate
            .as_deref()
            .and_then(parse_u64)
            .map(|value| value / 1000),
        color_primaries: stream.color_primaries.clone(),
        color_transfer: stream.color_transfer.clone(),
        color_space: stream.color_space.clone(),
        bit_depth,
        hdr_type: Some(hdr_type),
        max_content_light_level,
        max_frame_average_light_level,
        mastering_display_max_luminance,
        mastering_display_min_luminance,
    }
}

fn map_audio_stream(stream: &FfprobeStream) -> AudioStreamMetadata {
    AudioStreamMetadata {
        codec_name: stream.codec_name.clone(),
        channels: stream.channels,
        sample_rate: stream
            .sample_rate
            .as_deref()
            .and_then(parse_u64)
            .and_then(|v| u32::try_from(v).ok()),
        bit_rate_kbps: stream
            .bit_rate
            .as_deref()
            .and_then(parse_u64)
            .map(|value| value / 1000),
        channel_layout: stream.channel_layout.clone(),
    }
}

fn build_tags(
    container_format: &Option<String>,
    video: Option<&VideoStreamMetadata>,
) -> Vec<String> {
    let mut set = BTreeSet::new();

    if let Some(video) = video {
        if let Some(codec_name) = &video.codec_name {
            set.insert(normalize_codec_tag(codec_name));
        }

        if let Some(hdr) = &video.hdr_type {
            set.insert(match hdr {
                HdrType::Sdr => "SDR".to_string(),
                HdrType::Hdr10 => "HDR10".to_string(),
                HdrType::Hlg => "HLG".to_string(),
                HdrType::DolbyVision => "Dolby Vision".to_string(),
                HdrType::Unknown => "HDR:Unknown".to_string(),
            });
        }

        if let Some(bit_depth) = video.bit_depth {
            set.insert(format!("{}-bit", bit_depth));
        }

        if let Some(primaries) = &video.color_primaries {
            set.insert(normalize_color_tag(primaries));
        }

        if let Some(transfer) = &video.color_transfer {
            set.insert(normalize_transfer_tag(transfer));
        }

        if let (Some(width), Some(height)) = (video.width, video.height) {
            set.insert(resolution_tag(width, height));
        }
    }

    if let Some(container) = container_format {
        set.insert(normalize_container_tag(container));
    }

    set.into_iter().collect()
}

fn detect_hdr_type(stream: &FfprobeStream) -> HdrType {
    let primaries = stream.color_primaries.as_deref().unwrap_or_default();
    let transfer = stream.color_transfer.as_deref().unwrap_or_default();
    let bit_depth = stream
        .bits_per_raw_sample
        .as_deref()
        .and_then(parse_u64)
        .and_then(|value| u8::try_from(value).ok())
        .or_else(|| {
            stream
                .pix_fmt
                .as_deref()
                .and_then(infer_bit_depth_from_pix_fmt)
        });
    let pix_fmt = stream.pix_fmt.as_deref().unwrap_or_default().to_lowercase();

    if contains_dolby_vision_hint(stream) {
        return HdrType::DolbyVision;
    }

    if transfer.eq_ignore_ascii_case("arib-std-b67") {
        return HdrType::Hlg;
    }

    if transfer.eq_ignore_ascii_case("smpte2084") && primaries.eq_ignore_ascii_case("bt2020") {
        return HdrType::Hdr10;
    }

    // Treat common 8-bit SDR delivery traits as positive SDR evidence instead of "unknown".
    if transfer.is_empty()
        && primaries.is_empty()
        && bit_depth.unwrap_or(8) <= 8
        && matches!(
            pix_fmt.as_str(),
            "yuv420p" | "nv12" | "yuvj420p" | "yuv422p" | "yuv444p"
        )
    {
        return HdrType::Sdr;
    }

    if transfer.is_empty() && primaries.is_empty() {
        return HdrType::Unknown;
    }

    HdrType::Sdr
}

fn contains_dolby_vision_hint(stream: &FfprobeStream) -> bool {
    let mut text = String::new();
    if let Some(tag) = &stream.codec_tag_string {
        text.push_str(tag);
        text.push(' ');
    }
    if let Some(profile) = &stream.profile {
        text.push_str(profile);
        text.push(' ');
    }
    if let Some(side_data) = &stream.side_data_list {
        for value in side_data {
            text.push_str(&value.to_string());
            text.push(' ');
        }
    }

    let lower = text.to_lowercase();
    ["dovi", "dvhe", "dvh1", "dolby vision"]
        .iter()
        .any(|needle| lower.contains(needle))
}

fn extract_content_light_level(stream: &FfprobeStream) -> (Option<u32>, Option<u32>) {
    let Some(side_data_list) = &stream.side_data_list else {
        return (None, None);
    };

    let mut max_content_light_level = None;
    let mut max_frame_average_light_level = None;

    for side_data in side_data_list {
        let side_data_type = side_data
            .get("side_data_type")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_lowercase();

        if !side_data_type.contains("content light") {
            continue;
        }

        // HDR10 的 MaxCLL/MaxFALL 常以 max_content/max_average 输出。
        max_content_light_level =
            read_u32_side_data(side_data, "max_content").or(max_content_light_level);
        max_frame_average_light_level =
            read_u32_side_data(side_data, "max_average").or(max_frame_average_light_level);
    }

    (max_content_light_level, max_frame_average_light_level)
}

fn extract_mastering_luminance(stream: &FfprobeStream) -> (Option<f64>, Option<f64>) {
    let Some(side_data_list) = &stream.side_data_list else {
        return (None, None);
    };

    let mut max_luminance = None;
    let mut min_luminance = None;

    for side_data in side_data_list {
        let side_data_type = side_data
            .get("side_data_type")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_lowercase();

        if !side_data_type.contains("mastering display") {
            continue;
        }

        // mastering display metadata 可作为 HDR 预览提示的亮度参考。
        max_luminance = read_f64_side_data(side_data, "max_luminance").or(max_luminance);
        min_luminance = read_f64_side_data(side_data, "min_luminance").or(min_luminance);
    }

    (max_luminance, min_luminance)
}

fn read_u32_side_data(side_data: &Value, key: &str) -> Option<u32> {
    let value = side_data.get(key)?;
    value
        .as_u64()
        .and_then(|number| u32::try_from(number).ok())
        .or_else(|| value.as_str().and_then(parse_u32_string))
}

fn read_f64_side_data(side_data: &Value, key: &str) -> Option<f64> {
    let value = side_data.get(key)?;
    value
        .as_f64()
        .or_else(|| value.as_str().and_then(parse_luminance_string))
}

fn parse_u32_string(value: &str) -> Option<u32> {
    value.trim().parse::<u32>().ok()
}

fn parse_luminance_string(value: &str) -> Option<f64> {
    let trimmed = value.trim();
    if trimmed.contains('/') {
        return parse_fraction(trimmed);
    }

    trimmed.parse::<f64>().ok()
}

fn normalize_codec_tag(codec_name: &str) -> String {
    match codec_name.to_lowercase().as_str() {
        "h264" => "H264".to_string(),
        "hevc" | "h265" => "H265".to_string(),
        "av1" => "AV1".to_string(),
        "vp9" => "VP9".to_string(),
        other => other.to_uppercase(),
    }
}

fn normalize_color_tag(value: &str) -> String {
    match value.to_lowercase().as_str() {
        "bt709" => "BT.709".to_string(),
        "bt2020" => "BT.2020".to_string(),
        other => other.to_uppercase(),
    }
}

fn normalize_transfer_tag(value: &str) -> String {
    match value.to_lowercase().as_str() {
        "smpte2084" => "PQ".to_string(),
        "arib-std-b67" => "HLG".to_string(),
        "bt709" => "BT.709-TRC".to_string(),
        other => other.to_uppercase(),
    }
}

fn resolution_tag(width: u32, height: u32) -> String {
    if width >= 3840 || height >= 2160 {
        "4K".to_string()
    } else if width >= 2560 || height >= 1440 {
        "1440p".to_string()
    } else if width >= 1920 || height >= 1080 {
        "1080p".to_string()
    } else if width >= 1280 || height >= 720 {
        "720p".to_string()
    } else {
        format!("{}x{}", width, height)
    }
}

fn normalize_container_tag(format_name: &str) -> String {
    let lower = format_name.to_lowercase();
    if lower.contains("mov") || lower.contains("mp4") {
        return "MP4/MOV".to_string();
    }
    if lower.contains("matroska") || lower.contains("mkv") {
        return "MKV".to_string();
    }
    if lower.contains("webm") {
        return "WEBM".to_string();
    }
    if lower.contains("mpegts") || lower.contains("ts") {
        return "TS".to_string();
    }
    if lower.contains("avi") {
        return "AVI".to_string();
    }

    format_name
        .split(',')
        .next()
        .unwrap_or(format_name)
        .trim()
        .to_uppercase()
}

fn parse_fraction(value: &str) -> Option<f64> {
    let mut parts = value.split('/');
    let num = parts.next()?.trim().parse::<f64>().ok()?;
    let den = parts.next()?.trim().parse::<f64>().ok()?;
    if den == 0.0 {
        return None;
    }
    Some(num / den)
}

fn parse_f64(value: &str) -> Option<f64> {
    value.trim().parse::<f64>().ok()
}

fn parse_u64(value: &str) -> Option<u64> {
    value.trim().parse::<u64>().ok()
}

fn infer_bit_depth_from_pix_fmt(pix_fmt: &str) -> Option<u8> {
    let lower = pix_fmt.to_lowercase();
    if lower.contains("12") {
        Some(12)
    } else if lower.contains("10") {
        Some(10)
    } else if lower.contains("8") || lower.contains("yuv420p") || lower.contains("nv12") {
        Some(8)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_fraction_should_work() {
        assert_eq!(
            parse_fraction("30000/1001").map(|v| v.round() as i32),
            Some(30)
        );
        assert_eq!(parse_fraction("25/1"), Some(25.0));
        assert_eq!(parse_fraction("0/0"), None);
    }

    #[test]
    fn infer_bit_depth_from_pix_fmt_should_work() {
        assert_eq!(infer_bit_depth_from_pix_fmt("yuv420p"), Some(8));
        assert_eq!(infer_bit_depth_from_pix_fmt("yuv420p10le"), Some(10));
        assert_eq!(infer_bit_depth_from_pix_fmt("unknown"), None);
    }

    #[test]
    fn detect_hdr_type_should_match_rules() {
        let mut stream = FfprobeStream {
            codec_type: Some("video".to_string()),
            codec_name: None,
            codec_long_name: None,
            codec_tag_string: None,
            profile: None,
            width: None,
            height: None,
            pix_fmt: None,
            avg_frame_rate: None,
            r_frame_rate: None,
            bit_rate: None,
            bits_per_raw_sample: None,
            color_primaries: Some("bt2020".to_string()),
            color_transfer: Some("smpte2084".to_string()),
            color_space: None,
            channels: None,
            sample_rate: None,
            channel_layout: None,
            side_data_list: None,
        };
        assert_eq!(detect_hdr_type(&stream), HdrType::Hdr10);

        stream.color_transfer = Some("arib-std-b67".to_string());
        assert_eq!(detect_hdr_type(&stream), HdrType::Hlg);

        stream.color_transfer = Some("bt709".to_string());
        stream.profile = Some("dvhe.05".to_string());
        assert_eq!(detect_hdr_type(&stream), HdrType::DolbyVision);
    }

    #[test]
    fn detect_hdr_type_should_treat_common_8bit_video_as_sdr() {
        let stream = FfprobeStream {
            codec_type: Some("video".to_string()),
            codec_name: Some("h264".to_string()),
            codec_long_name: None,
            codec_tag_string: Some("avc1".to_string()),
            profile: Some("High".to_string()),
            width: Some(3840),
            height: Some(2160),
            pix_fmt: Some("yuv420p".to_string()),
            avg_frame_rate: None,
            r_frame_rate: None,
            bit_rate: None,
            bits_per_raw_sample: Some("8".to_string()),
            color_primaries: None,
            color_transfer: None,
            color_space: None,
            channels: None,
            sample_rate: None,
            channel_layout: None,
            side_data_list: None,
        };

        assert_eq!(detect_hdr_type(&stream), HdrType::Sdr);
    }

    #[test]
    fn detect_hdr_type_should_keep_unknown_when_evidence_is_insufficient() {
        let stream = FfprobeStream {
            codec_type: Some("video".to_string()),
            codec_name: Some("prores".to_string()),
            codec_long_name: None,
            codec_tag_string: None,
            profile: None,
            width: Some(1920),
            height: Some(1080),
            pix_fmt: None,
            avg_frame_rate: None,
            r_frame_rate: None,
            bit_rate: None,
            bits_per_raw_sample: None,
            color_primaries: None,
            color_transfer: None,
            color_space: None,
            channels: None,
            sample_rate: None,
            channel_layout: None,
            side_data_list: None,
        };

        assert_eq!(detect_hdr_type(&stream), HdrType::Unknown);
    }

    #[test]
    fn tags_should_be_stable_and_deduplicated() {
        let video = VideoStreamMetadata {
            codec_name: Some("hevc".to_string()),
            codec_long_name: None,
            profile: None,
            width: Some(3840),
            height: Some(2160),
            pix_fmt: Some("yuv420p10le".to_string()),
            fps: Some(23.976),
            bit_rate_kbps: Some(9000),
            color_primaries: Some("bt2020".to_string()),
            color_transfer: Some("smpte2084".to_string()),
            color_space: None,
            bit_depth: Some(10),
            hdr_type: Some(HdrType::Hdr10),
            max_content_light_level: Some(1000),
            max_frame_average_light_level: Some(400),
            mastering_display_max_luminance: Some(1000.0),
            mastering_display_min_luminance: Some(0.005),
        };

        let tags = build_tags(&Some("mov,mp4,m4a,3gp,3g2,mj2".to_string()), Some(&video));
        assert!(tags.contains(&"H265".to_string()));
        assert!(tags.contains(&"HDR10".to_string()));
        assert!(tags.contains(&"10-bit".to_string()));
        assert!(tags.contains(&"4K".to_string()));
        assert!(tags.contains(&"MP4/MOV".to_string()));
    }

    #[test]
    fn hdr_side_data_should_extract_light_levels() {
        let stream = FfprobeStream {
            codec_type: Some("video".to_string()),
            codec_name: Some("hevc".to_string()),
            codec_long_name: None,
            codec_tag_string: None,
            profile: None,
            width: Some(3840),
            height: Some(2160),
            pix_fmt: Some("yuv420p10le".to_string()),
            avg_frame_rate: None,
            r_frame_rate: None,
            bit_rate: None,
            bits_per_raw_sample: Some("10".to_string()),
            color_primaries: Some("bt2020".to_string()),
            color_transfer: Some("smpte2084".to_string()),
            color_space: Some("bt2020nc".to_string()),
            channels: None,
            sample_rate: None,
            channel_layout: None,
            side_data_list: Some(vec![
                serde_json::json!({
                    "side_data_type": "Content light level metadata",
                    "max_content": 1000,
                    "max_average": 400
                }),
                serde_json::json!({
                    "side_data_type": "Mastering display metadata",
                    "max_luminance": "10000000/10000",
                    "min_luminance": "50/10000"
                }),
            ]),
        };

        let video = map_video_stream(&stream);

        assert_eq!(video.max_content_light_level, Some(1000));
        assert_eq!(video.max_frame_average_light_level, Some(400));
        assert_eq!(video.mastering_display_max_luminance, Some(1000.0));
        assert_eq!(video.mastering_display_min_luminance, Some(0.005));
    }
}
