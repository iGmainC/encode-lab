use serde::Serialize;

use crate::storage::errors::StorageError;

/// 命令层统一错误结构：
/// 前端只需要识别 code，并展示 message 即可。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub code: String,
    pub message: String,
}

impl From<StorageError> for CommandError {
    fn from(value: StorageError) -> Self {
        // 后端内部错误统一映射到可前端消费的错误模型。
        Self {
            code: value.code().to_string(),
            message: value.to_string(),
        }
    }
}

/// 命令返回类型别名，避免每个命令重复声明错误类型。
pub type CommandResult<T> = Result<T, CommandError>;
