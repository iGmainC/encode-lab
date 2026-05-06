use std::path::PathBuf;

use crate::{
    models::JobHistory,
    storage::{errors::StorageResult, file_store::FileStore},
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

    pub fn append(&self, job: JobHistory) -> StorageResult<()> {
        let mut jobs = self.list()?;
        jobs.push(job);
        self.save_all(&jobs)
    }

    pub fn update(&self, job: &JobHistory) -> StorageResult<()> {
        let mut jobs = self.list()?;
        let existing = jobs
            .iter_mut()
            .find(|item| item.id == job.id)
            .ok_or_else(|| crate::storage::errors::StorageError::NotFound(job.id.clone()))?;

        *existing = job.clone();
        self.save_all(&jobs)
    }
}
