use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskConfig {
    pub id: String,
    pub name: String,
    pub video: VideoConfig,
    pub audio: AudioConfig,
    pub container: ContainerConfig,
    pub advanced_args: Option<String>,
    pub output: OutputConfig,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskConfigPayload {
    pub name: String,
    pub video: VideoConfig,
    pub audio: AudioConfig,
    pub container: ContainerConfig,
    pub advanced_args: Option<String>,
    pub output: OutputConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoConfig {
    pub codec_format: VideoCodecFormat,
    pub encoder: VideoEncoder,
    pub bitrate_mode: VideoBitrateMode,
    pub crf: Option<u8>,
    pub preset: Option<String>,
    pub profile: Option<String>,
    pub tune: Option<String>,
    pub resolution: Option<Resolution>,
    pub fps: Option<f32>,
    pub pixel_format: Option<String>,
    pub gop: Option<u32>,
    pub enable_two_pass: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Resolution {
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum VideoCodecFormat {
    H264,
    H265,
    Av1,
    Vp9,
    Copy,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VideoEncoder {
    Libx264,
    H264Videotoolbox,
    Libx265,
    HevcVideotoolbox,
    HevcNvenc,
    LibaomAv1,
    Svtav1,
    Av1Nvenc,
    Av1Videotoolbox,
    LibvpxVp9,
    Copy,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum VideoBitrateMode {
    Crf,
    Cbr,
    Abr,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioConfig {
    pub mode: AudioMode,
    pub custom_args: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AudioMode {
    Copy,
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerConfig {
    pub format: ContainerFormat,
    pub faststart: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ContainerFormat {
    Mp4,
    Mkv,
    Mov,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputConfig {
    pub dir: String,
    pub file_name_pattern: String,
    pub overwrite: String,
}
