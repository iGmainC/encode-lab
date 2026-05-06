use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobHistory {
    pub id: String,
    pub task_id: String,
    #[serde(default)]
    pub name: Option<String>,
    pub input_file: String,
    pub output_file: String,
    pub status: String,
    #[serde(default)]
    pub command_line: Option<String>,
    pub error: Option<String>,
    pub created_at: String,
    #[serde(default)]
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
}
