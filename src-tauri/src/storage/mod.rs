pub mod errors;
pub mod file_store;
pub mod lock_registry;
pub mod paths;
pub mod repositories;

use std::{path::PathBuf, sync::Arc};

use file_store::FileStore;
use lock_registry::LockRegistry;
use repositories::{
    jobs_history_repo::JobsHistoryRepo, settings_repo::SettingsRepo, tasks_repo::TasksRepo,
    templates_repo::TemplatesRepo,
};

#[derive(Clone)]
pub struct AppStorage {
    pub settings: SettingsRepo,
    pub tasks: TasksRepo,
    pub templates: TemplatesRepo,
    pub jobs_history: JobsHistoryRepo,
}

impl AppStorage {
    pub fn new(base_dir: PathBuf) -> Self {
        let lock_registry = Arc::new(LockRegistry::default());
        let file_store = FileStore::new(lock_registry, 1);
        let storage_paths = paths::StoragePaths::new(base_dir);

        Self {
            settings: SettingsRepo::new(file_store.clone(), storage_paths.settings),
            tasks: TasksRepo::new(file_store.clone(), storage_paths.tasks),
            templates: TemplatesRepo::new(file_store.clone(), storage_paths.templates),
            jobs_history: JobsHistoryRepo::new(file_store, storage_paths.jobs_history),
        }
    }
}

#[cfg(test)]
mod tests;
