use serde::Serialize;

use crate::ffmpeg_runtime::{
    display_path, dovi_tool_command, ffmpeg_command, resolve_dovi_tool_path, resolve_ffmpeg_path,
    resolve_ffprobe_path, resolve_x265_path, x265_command,
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DolbyVisionProbeResult {
    pub supports_dovi_rpu: bool,
    pub supports_dolby_vision_encode: bool,
    pub supports_preserve_pipeline: bool,
    pub supports_external_rpu_pipeline: bool,
    pub dovi_tool_found: bool,
    pub x265_cli_found: bool,
    pub supported_profiles: Vec<String>,
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
    pub x265_path: Option<String>,
    pub dovi_tool_path: Option<String>,
    pub version: Option<String>,
    pub x265_version: Option<String>,
    pub dovi_tool_version: Option<String>,
    pub dolby_vision: DolbyVisionProbeResult,
}

pub fn detect_ffmpeg_runtime() -> FfmpegProbeResult {
    let ffmpeg_path = resolve_ffmpeg_path().map(|path| display_path(&path));
    let ffprobe_path = resolve_ffprobe_path().map(|path| display_path(&path));
    let x265_path = resolve_x265_path().map(|path| display_path(&path));
    let dovi_tool_path = resolve_dovi_tool_path().map(|path| display_path(&path));

    let version = ffmpeg_path
        .as_ref()
        .and_then(|_| query_ffmpeg_version().ok())
        .and_then(|text| parse_ffmpeg_version_line(&text));
    let dolby_vision = ffmpeg_path
        .as_ref()
        .map(|_| probe_dolby_vision_capability(x265_path.is_some(), dovi_tool_path.is_some()))
        .unwrap_or_else(DolbyVisionProbeResult::default_disabled);

    FfmpegProbeResult {
        ffmpeg_found: ffmpeg_path.is_some(),
        ffprobe_found: ffprobe_path.is_some(),
        ffmpeg_path,
        ffprobe_path,
        x265_path,
        dovi_tool_path,
        version,
        x265_version: query_x265_version(),
        dovi_tool_version: query_dovi_tool_version(),
        dolby_vision,
    }
}

impl DolbyVisionProbeResult {
    fn default_disabled() -> Self {
        Self {
            supports_dovi_rpu: false,
            supports_dolby_vision_encode: false,
            supports_preserve_pipeline: false,
            supports_external_rpu_pipeline: false,
            dovi_tool_found: false,
            x265_cli_found: false,
            supported_profiles: vec![],
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

fn query_x265_version() -> Option<String> {
    let output = x265_command().arg("--version").output().ok()?;
    parse_first_nonempty_line(&String::from_utf8_lossy(&output.stderr))
        .or_else(|| parse_first_nonempty_line(&String::from_utf8_lossy(&output.stdout)))
}

fn query_dovi_tool_version() -> Option<String> {
    let output = dovi_tool_command().arg("--version").output().ok()?;
    parse_first_nonempty_line(&String::from_utf8_lossy(&output.stdout))
        .or_else(|| parse_first_nonempty_line(&String::from_utf8_lossy(&output.stderr)))
}

fn query_x265_help() -> Option<String> {
    let output = x265_command().arg("--fullhelp").output().ok()?;
    Some(format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    ))
}

fn query_dovi_tool_help() -> Option<String> {
    let output = dovi_tool_command().arg("--help").output().ok()?;
    Some(format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    ))
}

fn probe_dolby_vision_capability(
    x265_cli_found: bool,
    dovi_tool_found: bool,
) -> DolbyVisionProbeResult {
    let supports_dovi_rpu = query_ffmpeg_bsfs()
        .ok()
        .is_some_and(|text| parse_bsfs_has_dovi_rpu(&text));

    let libx265_support = query_encoder_help("libx265")
        .ok()
        .is_some_and(|text| encoder_help_supports_dolby_vision(&text));
    let x265_cli_support = x265_cli_found
        && query_x265_help().is_some_and(|text| x265_help_supports_dolby_vision(&text));
    let dovi_tool_support = dovi_tool_found
        && query_dovi_tool_help().is_some_and(|text| dovi_tool_help_supports_pipeline(&text));
    let supports_external_rpu_pipeline = x265_cli_support && dovi_tool_support;

    let supported_encoders = if libx265_support {
        vec!["libx265".to_string()]
    } else {
        vec![]
    };

    DolbyVisionProbeResult {
        supports_dovi_rpu,
        supports_dolby_vision_encode: libx265_support,
        supports_preserve_pipeline: supports_dovi_rpu
            && libx265_support
            && supports_external_rpu_pipeline,
        supports_external_rpu_pipeline,
        dovi_tool_found: dovi_tool_support,
        x265_cli_found: x265_cli_support,
        supported_profiles: if supports_external_rpu_pipeline {
            vec!["5".to_string(), "8.1".to_string()]
        } else {
            vec![]
        },
        supported_encoders,
        recommended_encoder: libx265_support.then(|| "libx265".to_string()),
    }
}

fn parse_first_nonempty_line(output: &str) -> Option<String> {
    output
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(ToString::to_string)
}

pub(crate) fn x265_help_supports_dolby_vision(output: &str) -> bool {
    output.contains("--dolby-vision-profile") && output.contains("--dolby-vision-rpu")
}

pub(crate) fn dovi_tool_help_supports_pipeline(output: &str) -> bool {
    ["extract-rpu", "inject-rpu", "demux", "info"]
        .iter()
        .all(|command| output.contains(command))
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
        dovi_tool_help_supports_pipeline, encoder_help_supports_dolby_vision,
        parse_bsfs_has_dovi_rpu, parse_ffmpeg_version_line, x265_help_supports_dolby_vision,
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

    #[test]
    fn external_tools_should_expose_required_rpu_commands() {
        assert!(x265_help_supports_dolby_vision(
            "--dolby-vision-profile <float>\n--dolby-vision-rpu <filename>"
        ));
        assert!(dovi_tool_help_supports_pipeline(
            "extract-rpu inject-rpu demux info"
        ));
    }
}
