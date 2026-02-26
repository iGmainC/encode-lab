use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobHistory {
    pub id: String,
    pub task_id: String,
    pub input_file: String,
    pub output_file: String,
    pub status: String,
    pub error: Option<String>,
    pub created_at: String,
    pub ended_at: Option<String>,
}
