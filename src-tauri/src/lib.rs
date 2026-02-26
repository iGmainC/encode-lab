mod commands;
mod models;
mod probe;
mod storage;
mod transcode;

use storage::errors::StorageError;
use tauri::Manager;

#[derive(Clone)]
pub struct AppState {
    pub(crate) storage: storage::AppStorage,
}

fn build_state<R: tauri::Runtime>(app: &tauri::App<R>) -> Result<AppState, StorageError> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|_| StorageError::PathResolveFailed)?;

    Ok(AppState {
        storage: storage::AppStorage::new(app_data_dir),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let state = build_state(app).map_err(|err| err.to_string())?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::tasks::create_task,
            commands::tasks::update_task,
            commands::tasks::list_tasks,
            commands::templates::save_template,
            commands::templates::update_template,
            commands::templates::delete_template,
            commands::templates::duplicate_template,
            commands::templates::list_templates,
            commands::settings::get_settings,
            commands::settings::update_settings,
            commands::probe::detect_ffmpeg,
            commands::probe::list_encoder_capabilities,
            commands::transcode::build_ffmpeg_command,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
