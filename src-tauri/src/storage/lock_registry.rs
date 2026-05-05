use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

/// 文件级锁注册器：
/// - 同一路径复用同一把锁，保证同文件串行写入
/// - 不同路径拿不同锁，允许并行写入
#[derive(Default)]
pub struct LockRegistry {
    lock_map: Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>,
}

impl LockRegistry {
    pub fn lock_for(&self, path: &Path) -> Arc<Mutex<()>> {
        // 这里的 lock_map 锁只用于“分配/查找路径锁”，生命周期很短。
        let mut lock_map = self.lock_map.lock().expect("lock registry mutex poisoned");

        lock_map
            .entry(path.to_path_buf())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }
}
