use tauri::State;

use crate::{
    commands::error::{CommandError, CommandResult},
    models::{TaskConfig, TaskConfigPayload, Validate},
    AppState,
};

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTaskResponse {
    pub task_id: String,
}

#[derive(serde::Serialize)]
pub struct UpdateTaskResponse {
    pub ok: bool,
}

#[tauri::command]
pub fn create_task(
    state: State<'_, AppState>,
    payload: TaskConfigPayload,
) -> CommandResult<CreateTaskResponse> {
    // 命令层先校验，确保仓储层收到的都是合法数据。
    payload.validate()?;

    let task_id = state
        .storage
        .tasks
        .create(payload)
        .map_err(CommandError::from)?;

    Ok(CreateTaskResponse { task_id })
}

#[tauri::command]
pub fn update_task(
    state: State<'_, AppState>,
    task_id: String,
    payload: TaskConfigPayload,
) -> CommandResult<UpdateTaskResponse> {
    // 更新同样走统一校验，避免 create/update 规则分叉。
    payload.validate()?;

    state
        .storage
        .tasks
        .update(&task_id, payload)
        .map_err(CommandError::from)?;

    Ok(UpdateTaskResponse { ok: true })
}

#[tauri::command]
pub fn list_tasks(state: State<'_, AppState>) -> CommandResult<Vec<TaskConfig>> {
    state.storage.tasks.list().map_err(CommandError::from)
}
