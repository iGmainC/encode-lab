use tauri::{AppHandle, Runtime, State};

use crate::{
    commands::error::{CommandError, CommandResult},
    models::{AppSettings, Validate},
    AppState,
};

#[derive(serde::Serialize)]
pub struct UpdateSettingsResponse {
    pub ok: bool,
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> CommandResult<AppSettings> {
    state.storage.settings.get().map_err(CommandError::from)
}

#[tauri::command]
pub fn update_settings<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    payload: AppSettings,
) -> CommandResult<UpdateSettingsResponse> {
    payload.validate()?;

    state
        .storage
        .settings
        .update(&payload)
        .map_err(CommandError::from)?;

    state
        .transcode_manager
        .update_concurrency(app, state.storage.clone(), payload.concurrency_n);

    Ok(UpdateSettingsResponse { ok: true })
}
