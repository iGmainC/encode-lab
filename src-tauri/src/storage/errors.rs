use std::path::PathBuf;

use thiserror::Error;

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("invalid payload: {0}")]
    InvalidPayload(String),

    #[error("io error: {0}")]
    IoError(#[from] std::io::Error),

    #[error("json parse error: {0}")]
    JsonParseError(#[from] serde_json::Error),

    #[error("schema version unsupported: {0}")]
    SchemaVersionUnsupported(u32),

    #[error("record not found: {0}")]
    NotFound(String),

    #[error("conflict: {0}")]
    Conflict(String),

    #[error("atomic write failed for {path:?}: {reason}")]
    AtomicWriteFailed { path: PathBuf, reason: String },

    #[error("failed to resolve app data dir")]
    PathResolveFailed,

    #[error("backup recovery failed for {path:?}: {reason}")]
    BackupRecoveryFailed { path: PathBuf, reason: String },
}

pub type StorageResult<T> = Result<T, StorageError>;

impl StorageError {
    pub fn code(&self) -> &'static str {
        match self {
            StorageError::InvalidPayload(_) => "INVALID_PAYLOAD",
            StorageError::IoError(_) => "IO_ERROR",
            StorageError::JsonParseError(_) => "JSON_PARSE_ERROR",
            StorageError::SchemaVersionUnsupported(_) => "SCHEMA_VERSION_UNSUPPORTED",
            StorageError::NotFound(_) => "NOT_FOUND",
            StorageError::Conflict(_) => "CONFLICT",
            StorageError::AtomicWriteFailed { .. } => "ATOMIC_WRITE_FAILED",
            StorageError::PathResolveFailed => "PATH_RESOLVE_FAILED",
            StorageError::BackupRecoveryFailed { .. } => "BACKUP_RECOVERY_FAILED",
        }
    }
}
