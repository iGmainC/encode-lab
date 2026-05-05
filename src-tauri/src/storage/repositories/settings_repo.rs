use std::path::PathBuf;

use crate::{
    models::AppSettings,
    storage::{errors::StorageResult, file_store::FileStore},
};

#[derive(Clone)]
pub struct SettingsRepo {
    store: FileStore,
    path: PathBuf,
}

impl SettingsRepo {
    pub fn new(store: FileStore, path: PathBuf) -> Self {
        Self { store, path }
    }

    pub fn get(&self) -> StorageResult<AppSettings> {
        self.store
            .load_data_or_default(&self.path, AppSettings::default())
    }

    pub fn update(&self, settings: &AppSettings) -> StorageResult<()> {
        self.store.save_data(&self.path, settings)
    }
}
