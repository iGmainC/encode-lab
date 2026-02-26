use std::path::PathBuf;

use chrono::Utc;
use uuid::Uuid;

use crate::{
    models::{Template, TemplatePayload},
    storage::{
        errors::{StorageError, StorageResult},
        file_store::FileStore,
    },
};

#[derive(Clone)]
pub struct TemplatesRepo {
    store: FileStore,
    path: PathBuf,
}

impl TemplatesRepo {
    pub fn new(store: FileStore, path: PathBuf) -> Self {
        Self { store, path }
    }

    pub fn list(&self) -> StorageResult<Vec<Template>> {
        self.store.load_data_or_default(&self.path, Vec::new())
    }

    pub fn save(&self, payload: TemplatePayload) -> StorageResult<String> {
        let mut templates = self.list()?;
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();

        templates.push(Template {
            id: id.clone(),
            name: payload.name,
            tags: payload.tags,
            version: 1,
            task_config_snapshot: payload.task_config_snapshot,
            last_used_at: None,
            created_at: now.clone(),
            updated_at: now,
        });

        self.store.save_data(&self.path, &templates)?;
        Ok(id)
    }

    pub fn update(&self, template_id: &str, payload: TemplatePayload) -> StorageResult<()> {
        let mut templates = self.list()?;
        let template = templates
            .iter_mut()
            .find(|item| item.id == template_id)
            .ok_or_else(|| StorageError::NotFound(template_id.to_string()))?;

        template.name = payload.name;
        template.tags = payload.tags;
        template.task_config_snapshot = payload.task_config_snapshot;
        template.version += 1;
        template.updated_at = Utc::now().to_rfc3339();

        self.store.save_data(&self.path, &templates)
    }

    pub fn delete(&self, template_id: &str) -> StorageResult<()> {
        let mut templates = self.list()?;
        let original_len = templates.len();
        templates.retain(|item| item.id != template_id);

        if templates.len() == original_len {
            return Err(StorageError::NotFound(template_id.to_string()));
        }

        self.store.save_data(&self.path, &templates)
    }

    pub fn duplicate(&self, template_id: &str) -> StorageResult<String> {
        let mut templates = self.list()?;
        let source = templates
            .iter()
            .find(|item| item.id == template_id)
            .cloned()
            .ok_or_else(|| StorageError::NotFound(template_id.to_string()))?;

        let now = Utc::now().to_rfc3339();
        let new_id = Uuid::new_v4().to_string();

        templates.push(Template {
            id: new_id.clone(),
            name: format!("{} (copy)", source.name),
            tags: source.tags,
            version: 1,
            task_config_snapshot: source.task_config_snapshot,
            last_used_at: None,
            created_at: now.clone(),
            updated_at: now,
        });

        self.store.save_data(&self.path, &templates)?;
        Ok(new_id)
    }
}
