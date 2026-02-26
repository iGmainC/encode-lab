use std::path::PathBuf;

pub struct StoragePaths {
    pub settings: PathBuf,
    pub tasks: PathBuf,
    pub templates: PathBuf,
    pub jobs_history: PathBuf,
}

impl StoragePaths {
    pub fn new(base_dir: PathBuf) -> Self {
        Self {
            settings: base_dir.join("settings.json"),
            tasks: base_dir.join("tasks.json"),
            templates: base_dir.join("templates.json"),
            jobs_history: base_dir.join("jobs-history.json"),
        }
    }
}
