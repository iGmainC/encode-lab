use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub concurrency_n: u8,
    pub ffmpeg_strategy: String,
    pub default_output_dir: String,
    pub thumbnail_mode: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            concurrency_n: 2,
            ffmpeg_strategy: "system".to_string(),
            default_output_dir: String::new(),
            thumbnail_mode: "imagePath".to_string(),
        }
    }
}
