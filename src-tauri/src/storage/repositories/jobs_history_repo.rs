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
        self.store
            .mutate_data_or_default(&self.path, Vec::new(), |jobs: &mut Vec<JobHistory>| {
                jobs.push(job);
                Ok(())
            })
            .map(|_| ())
    }

    pub fn update(&self, job: &JobHistory) -> StorageResult<()> {
        self.store
            .mutate_data_or_default(&self.path, Vec::new(), |jobs: &mut Vec<JobHistory>| {
                let existing = jobs
                    .iter_mut()
                    .find(|item| item.id == job.id)
                    .ok_or_else(|| {
                        crate::storage::errors::StorageError::NotFound(job.id.clone())
                    })?;

                *existing = job.clone();
                Ok(())
            })
            .map(|_| ())
    }

    /** 删除指定历史任务记录。 */
    pub fn delete(&self, job_id: &str) -> StorageResult<()> {
        self.store
            .mutate_data_or_default(&self.path, Vec::new(), |jobs: &mut Vec<JobHistory>| {
                let original_len = jobs.len();
                jobs.retain(|job| job.id != job_id);
                if jobs.len() == original_len {
                    return Err(crate::storage::errors::StorageError::NotFound(
                        job_id.to_string(),
                    ));
                }
                Ok(())
            })
            .map(|_| ())
    }
}
