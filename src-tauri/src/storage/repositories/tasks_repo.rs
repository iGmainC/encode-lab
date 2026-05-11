use std::path::PathBuf;

use chrono::Utc;
use uuid::Uuid;

use crate::{
    models::{TaskConfig, TaskConfigPayload},
    storage::{
        errors::{StorageError, StorageResult},
        file_store::FileStore,
    },
};

#[derive(Clone)]
pub struct TasksRepo {
    store: FileStore,
    path: PathBuf,
}

impl TasksRepo {
    pub fn new(store: FileStore, path: PathBuf) -> Self {
        Self { store, path }
    }

    pub fn list(&self) -> StorageResult<Vec<TaskConfig>> {
        self.store.load_data_or_default(&self.path, Vec::new())
    }

    pub fn create(&self, payload: TaskConfigPayload) -> StorageResult<String> {
        let now = Utc::now().to_rfc3339();
        let mut tasks = self.list()?;
        let id = Uuid::new_v4().to_string();

        tasks.push(TaskConfig {
            id: id.clone(),
            name: payload.name,
            clip_range: payload.clip_range,
            video: payload.video,
            audio: payload.audio,
            container: payload.container,
            advanced_args: payload.advanced_args,
            output: payload.output,
            created_at: now.clone(),
            updated_at: now,
        });

        self.store.save_data(&self.path, &tasks)?;
        Ok(id)
    }

    pub fn update(&self, task_id: &str, payload: TaskConfigPayload) -> StorageResult<()> {
        let mut tasks = self.list()?;
        let task = tasks
            .iter_mut()
            .find(|item| item.id == task_id)
            .ok_or_else(|| StorageError::NotFound(task_id.to_string()))?;

        task.name = payload.name;
        task.clip_range = payload.clip_range;
        task.video = payload.video;
        task.audio = payload.audio;
        task.container = payload.container;
        task.advanced_args = payload.advanced_args;
        task.output = payload.output;
        task.updated_at = Utc::now().to_rfc3339();

        self.store.save_data(&self.path, &tasks)
    }
}
