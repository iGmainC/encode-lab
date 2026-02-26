use serde::Serialize;
use std::process::Command;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FfmpegProbeResult {
    pub ffmpeg_found: bool,
    pub ffprobe_found: bool,
    pub ffmpeg_path: Option<String>,
    pub ffprobe_path: Option<String>,
    pub version: Option<String>,
}

pub fn detect_ffmpeg_runtime() -> FfmpegProbeResult {
    let ffmpeg_path = which_binary("ffmpeg");
    let ffprobe_path = which_binary("ffprobe");

    let version = ffmpeg_path
        .as_ref()
        .and_then(|_| query_ffmpeg_version().ok())
        .and_then(|text| parse_ffmpeg_version_line(&text));

    FfmpegProbeResult {
        ffmpeg_found: ffmpeg_path.is_some(),
        ffprobe_found: ffprobe_path.is_some(),
        ffmpeg_path,
        ffprobe_path,
        version,
    }
}

fn which_binary(name: &str) -> Option<String> {
    let output = Command::new("which").arg(name).output().ok()?;
    if !output.status.success() {
        return None;
    }

    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

fn query_ffmpeg_version() -> Result<String, std::io::Error> {
    let output = Command::new("ffmpeg").arg("-version").output()?;
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

pub(crate) fn parse_ffmpeg_version_line(output: &str) -> Option<String> {
    output
        .lines()
        .find(|line| line.starts_with("ffmpeg version"))
        .map(ToString::to_string)
}

#[cfg(test)]
mod tests {
    use super::parse_ffmpeg_version_line;

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
}
