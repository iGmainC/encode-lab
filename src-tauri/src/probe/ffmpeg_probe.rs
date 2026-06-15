use serde::Serialize;

use crate::ffmpeg_runtime::{
    display_path, ffmpeg_command, resolve_ffmpeg_path, resolve_ffprobe_path,
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DolbyVisionProbeResult {
    pub supports_dovi_rpu: bool,
    pub supports_dolby_vision_encode: bool,
    pub supports_preserve_pipeline: bool,
    pub supported_encoders: Vec<String>,
    pub recommended_encoder: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FfmpegProbeResult {
    pub ffmpeg_found: bool,
    pub ffprobe_found: bool,
    pub ffmpeg_path: Option<String>,
    pub ffprobe_path: Option<String>,
    pub version: Option<String>,
    pub dolby_vision: DolbyVisionProbeResult,
}

pub fn detect_ffmpeg_runtime() -> FfmpegProbeResult {
    let ffmpeg_path = resolve_ffmpeg_path().map(|path| display_path(&path));
    let ffprobe_path = resolve_ffprobe_path().map(|path| display_path(&path));

    let version = ffmpeg_path
        .as_ref()
        .and_then(|_| query_ffmpeg_version().ok())
        .and_then(|text| parse_ffmpeg_version_line(&text));
    let dolby_vision = ffmpeg_path
        .as_ref()
        .map(|_| probe_dolby_vision_capability())
        .unwrap_or_else(DolbyVisionProbeResult::default_disabled);

    FfmpegProbeResult {
        ffmpeg_found: ffmpeg_path.is_some(),
        ffprobe_found: ffprobe_path.is_some(),
        ffmpeg_path,
        ffprobe_path,
        version,
        dolby_vision,
    }
}

impl DolbyVisionProbeResult {
    fn default_disabled() -> Self {
        Self {
            supports_dovi_rpu: false,
            supports_dolby_vision_encode: false,
            supports_preserve_pipeline: false,
            supported_encoders: vec![],
            recommended_encoder: None,
        }
    }
}

fn query_ffmpeg_version() -> Result<String, std::io::Error> {
    let output = ffmpeg_command().arg("-version").output()?;
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn query_ffmpeg_bsfs() -> Result<String, std::io::Error> {
    let output = ffmpeg_command().args(["-hide_banner", "-bsfs"]).output()?;
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn query_encoder_help(encoder: &str) -> Result<String, std::io::Error> {
    let output = ffmpeg_command()
        .args(["-hide_banner", "-h", &format!("encoder={encoder}")])
        .output()?;
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn probe_dolby_vision_capability() -> DolbyVisionProbeResult {
    let supports_dovi_rpu = query_ffmpeg_bsfs()
        .ok()
        .is_some_and(|text| parse_bsfs_has_dovi_rpu(&text));

    let libx265_support = query_encoder_help("libx265")
        .ok()
        .is_some_and(|text| encoder_help_supports_dolby_vision(&text));

    let supported_encoders = if libx265_support {
        vec!["libx265".to_string()]
    } else {
        vec![]
    };

    DolbyVisionProbeResult {
        supports_dovi_rpu,
        supports_dolby_vision_encode: libx265_support,
        supports_preserve_pipeline: supports_dovi_rpu && libx265_support,
        supported_encoders,
        recommended_encoder: libx265_support.then(|| "libx265".to_string()),
    }
}

pub(crate) fn parse_ffmpeg_version_line(output: &str) -> Option<String> {
    output
        .lines()
        .find(|line| line.starts_with("ffmpeg version"))
        .map(ToString::to_string)
}

pub(crate) fn parse_bsfs_has_dovi_rpu(output: &str) -> bool {
    output
        .lines()
        .map(str::trim)
        .any(|line| line.eq_ignore_ascii_case("dovi_rpu"))
}

pub(crate) fn encoder_help_supports_dolby_vision(output: &str) -> bool {
    let normalized = output.to_ascii_lowercase();
    normalized.contains("dolbyvision")
        || normalized.contains("dolby vision")
        || normalized.contains("dovi")
}

#[cfg(test)]
mod tests {
    use super::{
        encoder_help_supports_dolby_vision, parse_bsfs_has_dovi_rpu, parse_ffmpeg_version_line,
    };

    #[test]
    fn parse_version_line_success() {
        let text = "ffmpeg version 7.1 Copyright\nbuilt with ...";
        let result = parse_ffmpeg_version_line(text);
        assert_eq!(result.as_deref(), Some("ffmpeg version 7.1 Copyright"));
    }

    #[test]
    fn parse_version_line_none() {
        let text = "built with clang\nconfiguration: ...";
        assert!(parse_ffmpeg_version_line(text).is_none());
    }

    #[test]
    fn parse_bsfs_should_detect_dovi_rpu() {
        let text = "Bitstream filters:\naac_adtstoasc\ndovi_rpu\nh264_metadata\n";
        assert!(parse_bsfs_has_dovi_rpu(text));
        assert!(!parse_bsfs_has_dovi_rpu(
            "Bitstream filters:\nh264_metadata\n"
        ));
    }

    #[test]
    fn encoder_help_should_detect_dolby_vision_option() {
        let text = "libx265 AVOptions:\n  -dolbyvision <boolean> E..V....... Enable Dolby Vision metadata\n";
        assert!(encoder_help_supports_dolby_vision(text));
        assert!(!encoder_help_supports_dolby_vision(
            "libx265 AVOptions:\n  -crf <float>\n"
        ));
    }
}
