use std::{fs, path::Path, sync::Arc, thread};

use uuid::Uuid;

use crate::{
    models::{
        task::{
            AudioConfig, AudioMode, ContainerConfig, ContainerFormat, OutputConfig, TaskConfigPayload,
            VideoBitrateMode, VideoCodecFormat, VideoConfig, VideoEncoder,
        },
        AppSettings, TemplatePayload, Validate,
    },
    storage::{
        file_store::FileStore,
        lock_registry::LockRegistry,
        paths::StoragePaths,
        repositories::{settings_repo::SettingsRepo, tasks_repo::TasksRepo, templates_repo::TemplatesRepo},
    },
};

fn test_base_dir() -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("encode-lab-storage-test-{}", Uuid::new_v4()));
    fs::create_dir_all(&dir).expect("create temp dir");
    dir
}

fn build_task_payload(name: &str) -> TaskConfigPayload {
    TaskConfigPayload {
        name: name.to_string(),
        video: VideoConfig {
            codec_format: VideoCodecFormat::H264,
            encoder: VideoEncoder::Libx264,
            bitrate_mode: VideoBitrateMode::Crf,
            crf: Some(23),
            preset: Some("medium".to_string()),
            profile: None,
            tune: None,
            resolution: None,
            fps: None,
            pixel_format: Some("yuv420p".to_string()),
            gop: None,
            enable_two_pass: false,
        },
        audio: AudioConfig {
            mode: AudioMode::Copy,
            custom_args: None,
        },
        container: ContainerConfig {
            format: ContainerFormat::Mp4,
            faststart: Some(true),
        },
        advanced_args: None,
        output: OutputConfig {
            dir: String::new(),
            file_name_pattern: "{inputName}_{taskName}".to_string(),
            overwrite: "autoRename".to_string(),
        },
    }
}

fn backup_path(path: &Path) -> std::path::PathBuf {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("storage.json");
    path.with_file_name(format!("{file_name}.bak"))
}

#[test]
fn list_init_and_crud_smoke() {
    let base_dir = test_base_dir();
    let paths = StoragePaths::new(base_dir.clone());
    let store = FileStore::new(Arc::new(LockRegistry::default()), 1);
    let tasks_repo = TasksRepo::new(store.clone(), paths.tasks);
    let templates_repo = TemplatesRepo::new(store.clone(), paths.templates);

    assert!(tasks_repo.list().expect("list tasks").is_empty());

    let task_id = tasks_repo
        .create(build_task_payload("task-a"))
        .expect("create task");
    let tasks = tasks_repo.list().expect("list tasks after create");
    assert_eq!(tasks.len(), 1);
    assert_eq!(tasks[0].id, task_id);

    let template_id = templates_repo
        .save(TemplatePayload {
            name: "tpl-a".to_string(),
            tags: vec!["h264".to_string()],
            task_config_snapshot: build_task_payload("task-a"),
        })
        .expect("save template");

    let copy_id = templates_repo.duplicate(&template_id).expect("duplicate template");
    assert_ne!(template_id, copy_id);

    templates_repo
        .delete(&template_id)
        .expect("delete template");

    assert_eq!(templates_repo.list().expect("list templates").len(), 1);

    let _ = fs::remove_dir_all(base_dir);
}

#[test]
fn concurrent_writes_same_file_are_safe() {
    let base_dir = test_base_dir();
    let paths = StoragePaths::new(base_dir.clone());
    let store = FileStore::new(Arc::new(LockRegistry::default()), 1);
    let settings_repo = Arc::new(SettingsRepo::new(store, paths.settings));

    let mut handles = Vec::new();
    for idx in 0..20 {
        let repo = Arc::clone(&settings_repo);
        handles.push(thread::spawn(move || {
            let mut settings = AppSettings::default();
            settings.concurrency_n = (idx % 8 + 1) as u8;
            repo.update(&settings).expect("update settings");
        }));
    }

    for handle in handles {
        handle.join().expect("thread join");
    }

    let loaded = settings_repo.get().expect("read settings");
    assert!((1..=8).contains(&loaded.concurrency_n));

    let _ = fs::remove_dir_all(base_dir);
}

#[test]
fn concurrent_writes_different_files_work() {
    let base_dir = test_base_dir();
    let paths = StoragePaths::new(base_dir.clone());
    let store = FileStore::new(Arc::new(LockRegistry::default()), 1);
    let tasks_repo = Arc::new(TasksRepo::new(store.clone(), paths.tasks));
    let templates_repo = Arc::new(TemplatesRepo::new(store, paths.templates));

    let task_handle = {
        let repo = Arc::clone(&tasks_repo);
        thread::spawn(move || {
            for i in 0..10 {
                repo.create(build_task_payload(&format!("task-{i}")))
                    .expect("create task in thread");
            }
        })
    };

    let template_handle = {
        let repo = Arc::clone(&templates_repo);
        thread::spawn(move || {
            for i in 0..10 {
                repo.save(TemplatePayload {
                    name: format!("tpl-{i}"),
                    tags: vec![],
                    task_config_snapshot: build_task_payload("task-for-template"),
                })
                .expect("save template in thread");
            }
        })
    };

    task_handle.join().expect("task thread join");
    template_handle.join().expect("template thread join");

    assert_eq!(tasks_repo.list().expect("list tasks").len(), 10);
    assert_eq!(templates_repo.list().expect("list templates").len(), 10);

    let _ = fs::remove_dir_all(base_dir);
}

#[test]
fn payload_validation_works() {
    let mut payload = build_task_payload("invalid-task");
    payload.video.enable_two_pass = true;
    payload.video.codec_format = VideoCodecFormat::H265;
    payload.video.encoder = VideoEncoder::HevcNvenc;

    let err = payload.validate().expect_err("expected payload validation error");
    assert_eq!(err.code(), "INVALID_PAYLOAD");
}

#[test]
fn validation_rejects_crf_on_hardware_encoder() {
    let mut payload = build_task_payload("invalid-crf-hw");
    payload.video.codec_format = VideoCodecFormat::H265;
    payload.video.encoder = VideoEncoder::HevcNvenc;
    payload.video.bitrate_mode = VideoBitrateMode::Crf;
    payload.video.crf = Some(24);

    let err = payload.validate().expect_err("expected validation error");
    assert_eq!(err.code(), "INVALID_PAYLOAD");
}

#[test]
fn validation_rejects_cbr_without_bitrate_flag() {
    let mut payload = build_task_payload("invalid-cbr-no-bitrate");
    payload.video.bitrate_mode = VideoBitrateMode::Cbr;
    payload.video.crf = None;
    payload.advanced_args = None;

    let err = payload.validate().expect_err("expected validation error");
    assert_eq!(err.code(), "INVALID_PAYLOAD");
}

#[test]
fn validation_rejects_encoder_codec_mismatch_for_vp9() {
    let mut payload = build_task_payload("invalid-vp9-encoder");
    payload.video.codec_format = VideoCodecFormat::Vp9;
    payload.video.encoder = VideoEncoder::Libx265;
    payload.video.bitrate_mode = VideoBitrateMode::Cbr;
    payload.video.crf = None;
    payload.advanced_args = Some("-b:v 3M".to_string());

    let err = payload.validate().expect_err("expected validation error");
    assert_eq!(err.code(), "INVALID_PAYLOAD");
}

#[test]
fn corrupted_json_can_restore_from_backup() {
    let base_dir = test_base_dir();
    let paths = StoragePaths::new(base_dir.clone());
    let store = FileStore::new(Arc::new(LockRegistry::default()), 1);
    let settings_repo = SettingsRepo::new(store, paths.settings.clone());

    let mut settings = AppSettings::default();
    settings.concurrency_n = 4;
    settings_repo.update(&settings).expect("initial save settings");

    let backup = backup_path(&paths.settings);
    assert!(backup.exists());

    fs::write(&paths.settings, b"{ invalid json").expect("write invalid json");

    let restored = settings_repo.get().expect("recover from backup");
    assert_eq!(restored.concurrency_n, 4);

    let content = fs::read_to_string(&paths.settings).expect("read restored file");
    assert!(content.contains("schemaVersion"));

    let _ = fs::remove_dir_all(base_dir);
}

#[test]
fn schema_version_mismatch_returns_error() {
    let base_dir = test_base_dir();
    let paths = StoragePaths::new(base_dir.clone());
    let store = FileStore::new(Arc::new(LockRegistry::default()), 1);
    let settings_repo = SettingsRepo::new(store, paths.settings.clone());

    let content = r#"{
  "schemaVersion": 99,
  "updatedAt": "2026-01-01T00:00:00Z",
  "data": {
    "concurrencyN": 2,
    "ffmpegStrategy": "system",
    "defaultOutputDir": "",
    "thumbnailMode": "imagePath"
  }
}"#;
    fs::write(&paths.settings, content).expect("write schema mismatch file");

    let err = settings_repo.get().expect_err("schema mismatch should fail");
    assert_eq!(err.code(), "SCHEMA_VERSION_UNSUPPORTED");

    let _ = fs::remove_dir_all(base_dir);
}
