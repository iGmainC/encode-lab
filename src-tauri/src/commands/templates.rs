use tauri::State;

use crate::{
    commands::error::{CommandError, CommandResult},
    models::{Template, TemplatePayload, Validate},
    AppState,
};

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveTemplateResponse {
    pub template_id: String,
}

#[derive(serde::Serialize)]
pub struct UpdateTemplateResponse {
    pub ok: bool,
}

#[derive(serde::Serialize)]
pub struct DeleteTemplateResponse {
    pub ok: bool,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateTemplateResponse {
    pub template_id: String,
}

#[tauri::command]
pub fn save_template(
    state: State<'_, AppState>,
    payload: TemplatePayload,
) -> CommandResult<SaveTemplateResponse> {
    payload.validate()?;

    let template_id = state
        .storage
        .templates
        .save(payload)
        .map_err(CommandError::from)?;

    Ok(SaveTemplateResponse { template_id })
}

#[tauri::command]
pub fn update_template(
    state: State<'_, AppState>,
    template_id: String,
    payload: TemplatePayload,
) -> CommandResult<UpdateTemplateResponse> {
    payload.validate()?;

    state
        .storage
        .templates
        .update(&template_id, payload)
        .map_err(CommandError::from)?;

    Ok(UpdateTemplateResponse { ok: true })
}

#[tauri::command]
pub fn delete_template(
    state: State<'_, AppState>,
    template_id: String,
) -> CommandResult<DeleteTemplateResponse> {
    state
        .storage
        .templates
        .delete(&template_id)
        .map_err(CommandError::from)?;

    Ok(DeleteTemplateResponse { ok: true })
}

#[tauri::command]
pub fn duplicate_template(
    state: State<'_, AppState>,
    template_id: String,
) -> CommandResult<DuplicateTemplateResponse> {
    let template_id = state
        .storage
        .templates
        .duplicate(&template_id)
        .map_err(CommandError::from)?;

    Ok(DuplicateTemplateResponse { template_id })
}

#[tauri::command]
pub fn list_templates(state: State<'_, AppState>) -> CommandResult<Vec<Template>> {
    state.storage.templates.list().map_err(CommandError::from)
}
