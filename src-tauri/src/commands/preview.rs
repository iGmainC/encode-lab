use tauri::{AppHandle, Runtime, State};

use crate::{
    commands::error::CommandResult,
    preview::{
        PreviewConfig, PreviewUpdatePatch, StartPreviewResponse, StopPreviewResponse,
        UpdatePreviewResponse,
    },
    AppState,
};

#[tauri::command]
pub fn start_preview<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    payload: PreviewConfig,
) -> CommandResult<StartPreviewResponse> {
    state.preview_manager.start_session(app, payload)
}

#[tauri::command]
pub fn update_preview<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    preview_session_id: String,
    patch: PreviewUpdatePatch,
) -> CommandResult<UpdatePreviewResponse> {
    state
        .preview_manager
        .update_session(app, &preview_session_id, patch)
}

#[tauri::command]
pub fn stop_preview<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    preview_session_id: String,
) -> CommandResult<StopPreviewResponse> {
    state.preview_manager.stop_session(app, &preview_session_id)
}
