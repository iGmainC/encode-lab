use tauri::State;

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
pub fn update_settings(
    state: State<'_, AppState>,
    payload: AppSettings,
) -> CommandResult<UpdateSettingsResponse> {
    payload.validate()?;

    state
        .storage
        .settings
        .update(&payload)
        .map_err(CommandError::from)?;

    Ok(UpdateSettingsResponse { ok: true })
}
