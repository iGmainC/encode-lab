use std::path::PathBuf;

use crate::{
    models::JobHistory,
    storage::{
        errors::StorageResult,
        file_store::FileStore,
    },
};

#[derive(Clone)]
pub struct JobsHistoryRepo {
    store: FileStore,
    path: PathBuf,
}

impl JobsHistoryRepo {
    pub fn new(store: FileStore, path: PathBuf) -> Self {
        Self { store, path }
    }

    pub fn list(&self) -> StorageResult<Vec<JobHistory>> {
        self.store.load_data_or_default(&self.path, Vec::new())
    }

    pub fn save_all(&self, jobs: &[JobHistory]) -> StorageResult<()> {
        self.store.save_data(&self.path, jobs)
    }
}
