use std::{
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
    sync::Arc,
};

use chrono::Utc;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use uuid::Uuid;

use crate::storage::{
    errors::{StorageError, StorageResult},
    lock_registry::LockRegistry,
};

/// JSON 文件统一封装结构。
/// - schema_version: 用于后续演进与迁移
/// - updated_at: 最后写入时间，便于排障
/// - data: 业务数据主体
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredEnvelope<T> {
    pub schema_version: u32,
    pub updated_at: String,
    pub data: T,
}

/// 通用 JSON 存储器：
/// 1. 负责原子写入（tmp -> fsync -> rename）
/// 2. 负责按 schemaVersion 读取与校验
/// 3. 负责损坏时的备份恢复
#[derive(Clone)]
pub struct FileStore {
    lock_registry: Arc<LockRegistry>,
    expected_schema_version: u32,
}

impl FileStore {
    pub fn new(lock_registry: Arc<LockRegistry>, expected_schema_version: u32) -> Self {
        Self {
            lock_registry,
            expected_schema_version,
        }
    }

    pub fn load_data_or_default<T>(&self, path: &Path, default_data: T) -> StorageResult<T>
    where
        T: Clone + Serialize + DeserializeOwned,
    {
        match fs::read_to_string(path) {
            // 正常读取时做解析；若主文件损坏会尝试走备份恢复。
            Ok(content) => self.parse_or_recover(path, &content),
            // 首次启动文件不存在：落默认值并回写，保证后续读取稳定。
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                self.save_data(path, &default_data)?;
                Ok(default_data)
            }
            Err(err) => Err(StorageError::IoError(err)),
        }
    }

    pub fn save_data<T>(&self, path: &Path, data: &T) -> StorageResult<()>
    where
        T: Serialize + ?Sized,
    {
        // 所有数据统一写成 envelope，避免不同文件格式分叉。
        let envelope = StoredEnvelope {
            schema_version: self.expected_schema_version,
            updated_at: Utc::now().to_rfc3339(),
            data,
        };

        let content = serde_json::to_vec_pretty(&envelope)?;
        self.write_atomic(path, &content)
    }

    fn write_atomic(&self, path: &Path, content: &[u8]) -> StorageResult<()> {
        // 文件级锁：同一文件串行写，不同文件可并行写。
        let lock = self.lock_registry.lock_for(path);
        let _guard = lock.lock().expect("file lock poisoned");

        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }

        let temp_path = temporary_path(path);
        let mut file = File::create(&temp_path)?;
        file.write_all(content)?;
        file.flush()?;
        file.sync_all()?;

        // rename 在同文件系统下是原子操作，避免半写入状态。
        fs::rename(&temp_path, path).map_err(|err| StorageError::AtomicWriteFailed {
            path: path.to_path_buf(),
            reason: err.to_string(),
        })?;

        // 写成功后刷新一份备份，供主文件损坏时快速回滚。
        let backup = backup_path(path);
        let _ = fs::copy(path, &backup);

        Ok(())
    }

    fn parse_or_recover<T>(&self, path: &Path, content: &str) -> StorageResult<T>
    where
        T: DeserializeOwned + Serialize + Clone,
    {
        match self.parse_envelope(content) {
            Ok(data) => Ok(data),
            // 主文件 JSON 损坏时，尝试从 .bak 恢复。
            Err(StorageError::JsonParseError(_)) => self.try_restore_from_backup(path),
            Err(err) => Err(err),
        }
    }

    fn parse_envelope<T>(&self, content: &str) -> StorageResult<T>
    where
        T: DeserializeOwned,
    {
        let envelope: StoredEnvelope<T> = serde_json::from_str(content)?;
        // 版本一致，直接返回数据。
        if envelope.schema_version == self.expected_schema_version {
            return Ok(envelope.data);
        }

        // 预留迁移入口：当前仅占位，尚未真正迁移。
        if envelope.schema_version == 1 && self.expected_schema_version == 2 {
            return migrate_v1_to_v2(content);
        }

        Err(StorageError::SchemaVersionUnsupported(
            envelope.schema_version,
        ))
    }

    fn try_restore_from_backup<T>(&self, path: &Path) -> StorageResult<T>
    where
        T: DeserializeOwned + Serialize + Clone,
    {
        let backup = backup_path(path);
        // 读取备份失败则直接返回恢复失败错误。
        let backup_content =
            fs::read_to_string(&backup).map_err(|err| StorageError::BackupRecoveryFailed {
                path: backup.clone(),
                reason: err.to_string(),
            })?;

        // 备份内容也要经过 schema 校验，避免恢复到不合法数据。
        let data = self.parse_envelope::<T>(&backup_content)?;
        // 恢复成功后回写主文件，确保下次读取走主文件即可。
        self.write_atomic(path, backup_content.as_bytes())?;
        Ok(data)
    }
}

fn temporary_path(path: &Path) -> PathBuf {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("storage.json");
    let tmp_name = format!("{}.{}.tmp", file_name, Uuid::new_v4());
    path.with_file_name(tmp_name)
}

fn backup_path(path: &Path) -> PathBuf {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("storage.json");
    path.with_file_name(format!("{file_name}.bak"))
}

/// schema 迁移钩子（占位）：
/// 后续升级版本时在这里实现 v1 -> v2 的结构转换。
fn migrate_v1_to_v2<T>(_legacy_content: &str) -> StorageResult<T> {
    Err(StorageError::SchemaVersionUnsupported(1))
}
