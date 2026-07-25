use tauri::{AppHandle, Manager, Runtime, State};

use crate::{
    commands::error::{CommandError, CommandResult},
    preview::{
        PinPreviewFrameResponse, PreviewConfig, PreviewUpdatePatch, ReleasePreviewFrameResponse,
        StartPreviewResponse, StopPreviewResponse, UpdatePreviewResponse,
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

#[tauri::command]
pub fn pin_preview_frame(
    state: State<'_, AppState>,
    source_image_path: String,
    preview_image_path: String,
) -> CommandResult<PinPreviewFrameResponse> {
    state
        .preview_manager
        .pin_frame(&source_image_path, &preview_image_path)
}

#[tauri::command]
pub fn release_preview_frame(
    state: State<'_, AppState>,
    frame_pin_id: String,
) -> CommandResult<ReleasePreviewFrameResponse> {
    state.preview_manager.release_frame_pin(&frame_pin_id)
}

#[tauri::command]
pub fn set_detached_preview_payload(
    state: State<'_, AppState>,
    payload: String,
) -> CommandResult<()> {
    let mut snapshot = state.detached_preview_payload.lock().map_err(|_| {
        CommandError::new(
            "preview_payload_lock_failed",
            "detached preview payload lock poisoned",
        )
    })?;
    *snapshot = Some(payload);
    Ok(())
}

#[tauri::command]
pub fn get_detached_preview_payload(state: State<'_, AppState>) -> CommandResult<Option<String>> {
    state
        .detached_preview_payload
        .lock()
        .map(|snapshot| snapshot.clone())
        .map_err(|_| {
            CommandError::new(
                "preview_payload_lock_failed",
                "detached preview payload lock poisoned",
            )
        })
}

#[tauri::command]
pub fn clear_detached_preview_payload(state: State<'_, AppState>) -> CommandResult<()> {
    let mut snapshot = state.detached_preview_payload.lock().map_err(|_| {
        CommandError::new(
            "preview_payload_lock_failed",
            "detached preview payload lock poisoned",
        )
    })?;
    *snapshot = None;
    Ok(())
}

#[tauri::command]
pub fn close_detached_preview_window<R: Runtime>(app: AppHandle<R>) -> CommandResult<()> {
    let window = app
        .get_webview_window("preview-detached")
        .ok_or_else(|| CommandError::new("not_found", "detached preview window not found"))?;
    window
        // 前端已完成 payload 与 pin 清理，直接销毁可避免全屏退出动画重新触发窗口锁定。
        .destroy()
        .map_err(|err| CommandError::new("preview_window_close_failed", err.to_string()))
}
