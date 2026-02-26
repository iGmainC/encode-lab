use serde::{Deserialize, Serialize};

use crate::{
    commands::error::{CommandError, CommandResult},
    models::{TaskConfigPayload, Validate},
    transcode::command_builder::build_ffmpeg_commands,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildCommandRequest {
    pub payload: TaskConfigPayload,
    pub input_file: String,
    pub output_file: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildCommandResponse {
    pub commands: Vec<String>,
    pub warnings: Vec<String>,
    pub sanitized_advanced_args: Option<String>,
}

#[tauri::command]
pub fn build_ffmpeg_command(request: BuildCommandRequest) -> CommandResult<BuildCommandResponse> {
    request.payload.validate()?;

    let result = build_ffmpeg_commands(&request.payload, &request.input_file, &request.output_file)
        .map_err(CommandError::from)?;

    Ok(BuildCommandResponse {
        commands: result.commands,
        warnings: result.warnings,
        sanitized_advanced_args: result.sanitized_advanced_args,
    })
}
