use serde::{Deserialize, Serialize};

use crate::models::TaskConfigPayload;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Template {
    pub id: String,
    pub name: String,
    pub tags: Vec<String>,
    pub version: u32,
    pub task_config_snapshot: TaskConfigPayload,
    pub last_used_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplatePayload {
    pub name: String,
    pub tags: Vec<String>,
    pub task_config_snapshot: TaskConfigPayload,
}
