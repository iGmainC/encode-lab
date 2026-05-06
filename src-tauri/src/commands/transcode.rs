use std::{
    fs,
    path::{Path, PathBuf},
};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Runtime, State};
use uuid::Uuid;

use crate::{
    commands::error::{CommandError, CommandResult},
    models::{FileLocation, JobHistory, TaskConfigPayload, Validate, LOCAL_NODE_ID},
    probe::video_metadata::read_video_metadata,
    transcode::command_builder::{build_ffmpeg_command_args, build_ffmpeg_commands},
    transcode::job_manager::TranscodeJobRequest,
    AppState,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildCommandRequest {
    pub payload: TaskConfigPayload,
    pub input_file: String,
    pub output_file: String,
    /** 可选输入节点位置；当前命令拼装仍使用 input_file 保持本机兼容。 */
    #[serde(default)]
    pub input_location: Option<FileLocation>,
    /** 可选输出节点位置；当前命令拼装仍使用 output_file 保持本机兼容。 */
    #[serde(default)]
    pub output_location: Option<FileLocation>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildCommandResponse {
    pub commands: Vec<String>,
    pub warnings: Vec<String>,
    pub sanitized_advanced_args: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnqueueTranscodeJobRequest {
    pub payload: TaskConfigPayload,
    pub input_file: String,
    /** 可选输入节点位置；为空时按 local + input_file 入队。 */
    #[serde(default)]
    pub input_location: Option<FileLocation>,
    /** 可选输出节点位置；为空时按 local + 自动输出路径入队。 */
    #[serde(default)]
    pub output_location: Option<FileLocation>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnqueueTranscodeJobResponse {
    pub task_id: String,
    pub job_id: String,
    pub output_file: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlJobRequest {
    /** 需要控制的任务 id。 */
    pub job_id: String,
    /** 任务控制动作；当前先支持 cancel。 */
    pub action: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlJobResponse {
    /** 控制动作是否已应用。 */
    pub ok: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteJobRequest {
    /** 需要删除的历史任务 id。 */
    pub job_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteJobResponse {
    /** 删除动作是否已应用。 */
    pub ok: bool,
}

#[tauri::command]
pub fn build_ffmpeg_command(request: BuildCommandRequest) -> CommandResult<BuildCommandResponse> {
    request.payload.validate()?;
    // location 字段先进入命令契约，当前本机命令仍以字符串路径为事实输入。
    let _location_contract = (&request.input_location, &request.output_location);

    let result = build_ffmpeg_commands(&request.payload, &request.input_file, &request.output_file)
        .map_err(CommandError::from)?;

    Ok(BuildCommandResponse {
        commands: result.commands,
        warnings: result.warnings,
        sanitized_advanced_args: result.sanitized_advanced_args,
    })
}

#[tauri::command]
pub fn list_jobs(state: State<'_, AppState>) -> CommandResult<Vec<JobHistory>> {
    state
        .storage
        .jobs_history
        .list()
        .map_err(CommandError::from)
}

#[tauri::command]
pub fn enqueue_transcode_job<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    request: EnqueueTranscodeJobRequest,
) -> CommandResult<EnqueueTranscodeJobResponse> {
    request.payload.validate()?;

    let job_id = Uuid::new_v4().to_string();
    let output_file = resolve_output_file(&request.payload, &request.input_file, &job_id)?;
    let command_args =
        build_ffmpeg_command_args(&request.payload, &request.input_file, &output_file)
            .map_err(CommandError::from)?;
    let command_line = build_ffmpeg_commands(&request.payload, &request.input_file, &output_file)
        .map_err(CommandError::from)?
        .commands
        .join(" && ");
    let duration_sec = read_video_metadata(&request.input_file)
        .ok()
        .and_then(|metadata| metadata.duration_sec);
    let input_location = request
        .input_location
        .clone()
        .unwrap_or_else(|| FileLocation::local(request.input_file.clone()));
    let output_node_id = request
        .output_location
        .as_ref()
        .or(request.payload.output.location.as_ref())
        .map(|location| location.node_id.clone())
        .unwrap_or_else(|| LOCAL_NODE_ID.to_string());
    let output_location = request.output_location.clone().unwrap_or(FileLocation {
        node_id: output_node_id,
        path: output_file.clone(),
    });
    let task_id = state
        .storage
        .tasks
        .create(request.payload.clone())
        .map_err(CommandError::from)?;
    let now = Utc::now().to_rfc3339();
    let job = JobHistory {
        id: job_id.clone(),
        task_id: task_id.clone(),
        name: Some(request.payload.name.clone()),
        input_file: request.input_file.clone(),
        output_file: output_file.clone(),
        input_location: Some(input_location),
        output_location: Some(output_location),
        execution_node_id: Some(LOCAL_NODE_ID.to_string()),
        transfer_ids: vec![],
        input_size_bytes: None,
        output_size_bytes: None,
        size_change_percent: None,
        input_video_size_bytes: None,
        output_video_size_bytes: None,
        video_size_change_percent: None,
        status: "queued".to_string(),
        command_line: Some(command_line),
        error: None,
        created_at: now,
        started_at: None,
        ended_at: None,
    };

    state
        .storage
        .jobs_history
        .append(job.clone())
        .map_err(CommandError::from)?;
    let _ = app.emit("job:updated", &job);

    let concurrency_n = state
        .storage
        .settings
        .get()
        .map(|settings| settings.concurrency_n)
        .unwrap_or(1);
    state.transcode_manager.enqueue(
        app,
        state.storage.clone(),
        TranscodeJobRequest {
            job,
            command_args,
            duration_sec,
        },
        concurrency_n,
    );

    Ok(EnqueueTranscodeJobResponse {
        task_id,
        job_id,
        output_file,
    })
}

#[tauri::command]
pub fn control_job<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    request: ControlJobRequest,
) -> CommandResult<ControlJobResponse> {
    if request.action != "cancel" {
        return Err(CommandError::new(
            "unsupported_action",
            "only cancel is supported currently",
        ));
    }

    let ok = state
        .transcode_manager
        .cancel_job(app, state.storage.clone(), &request.job_id);

    if !ok {
        return Err(CommandError::new(
            "not_found",
            "job is not queued or running",
        ));
    }

    Ok(ControlJobResponse { ok })
}

#[tauri::command]
pub fn delete_job(
    state: State<'_, AppState>,
    request: DeleteJobRequest,
) -> CommandResult<DeleteJobResponse> {
    let job = state
        .storage
        .jobs_history
        .list()
        .map_err(CommandError::from)?
        .into_iter()
        .find(|job| job.id == request.job_id)
        .ok_or_else(|| CommandError::new("not_found", "job not found"))?;

    if matches!(job.status.as_str(), "queued" | "running") {
        return Err(CommandError::new(
            "invalid_job_state",
            "queued or running job must be canceled before delete",
        ));
    }

    state
        .storage
        .jobs_history
        .delete(&request.job_id)
        .map_err(CommandError::from)?;

    Ok(DeleteJobResponse { ok: true })
}

fn resolve_output_file(
    payload: &TaskConfigPayload,
    input_file: &str,
    job_id: &str,
) -> CommandResult<String> {
    let input_path = Path::new(input_file);
    let output_dir = if payload.output.dir.trim().is_empty() {
        input_path
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from("."))
    } else {
        PathBuf::from(payload.output.dir.trim())
    };

    fs::create_dir_all(&output_dir)
        .map_err(|err| CommandError::new("output_dir_failed", err.to_string()))?;

    let input_name = input_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("input");
    let base_name = payload
        .output
        .file_name_pattern
        .replace("{inputName}", input_name)
        .replace("{taskName}", &payload.name);
    let extension = container_extension(&payload.container.format);
    let sanitized = sanitize_file_stem(&base_name);
    let job_suffix = job_id.get(..8).unwrap_or(job_id);

    Ok(
        next_available_path(output_dir.join(format!("{sanitized}-{job_suffix}.{extension}")))
            .to_string_lossy()
            .to_string(),
    )
}

fn container_extension(format: &crate::models::task::ContainerFormat) -> &'static str {
    match format {
        crate::models::task::ContainerFormat::Mp4 => "mp4",
        crate::models::task::ContainerFormat::Mkv => "mkv",
        crate::models::task::ContainerFormat::Mov => "mov",
    }
}

fn sanitize_file_stem(value: &str) -> String {
    let sanitized: String = value
        .chars()
        .filter_map(|ch| {
            if is_safe_file_stem_char(ch) {
                // 本机路径由 Command 参数数组传递给 FFmpeg，空格和 Unicode 不需要替换成下划线。
                Some(ch)
            } else if ch.is_control() || matches!(ch, '/' | '\\') {
                None
            } else {
                Some('_')
            }
        })
        .collect::<String>()
        .trim()
        .trim_matches('.')
        .to_string();

    if sanitized.is_empty() {
        "encode-lab-output".to_string()
    } else {
        sanitized
    }
}

/** 判断字符是否可以直接保留在输出文件名主干中。 */
fn is_safe_file_stem_char(ch: char) -> bool {
    !ch.is_control()
        && !matches!(
            ch,
            // Windows 和 Unix 路径的高风险字符统一过滤，避免后续跨节点同步时出问题。
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'
        )
}

#[cfg(test)]
fn legacy_sanitize_file_stem(value: &str) -> String {
    let sanitized: String = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.') {
                ch
            } else {
                '_'
            }
        })
        .collect();

    if sanitized.trim_matches('_').is_empty() {
        "encode-lab-output".to_string()
    } else {
        sanitized
    }
}

#[cfg(test)]
mod tests {
    use super::{legacy_sanitize_file_stem, sanitize_file_stem};

    #[test]
    fn sanitize_file_stem_should_keep_spaces_parentheses_and_unicode() {
        assert_eq!(
            sanitize_file_stem("Core Universe (4K HDR Dolby Atmos)_preview-draft"),
            "Core Universe (4K HDR Dolby Atmos)_preview-draft"
        );
        assert_eq!(sanitize_file_stem("测试 视频_preview"), "测试 视频_preview");
    }

    #[test]
    fn sanitize_file_stem_should_remove_path_separators() {
        assert_eq!(sanitize_file_stem("../bad/name"), "badname");
        assert_eq!(sanitize_file_stem("bad\\name"), "badname");
    }

    #[test]
    fn legacy_sanitize_file_stem_documents_previous_behavior() {
        assert_eq!(
            legacy_sanitize_file_stem("Core Universe (4K HDR Dolby Atmos)_preview-draft"),
            "Core_Universe__4K_HDR_Dolby_Atmos__preview-draft"
        );
    }
}

fn next_available_path(path: PathBuf) -> PathBuf {
    if !path.exists() {
        return path;
    }

    let parent = path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."));
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("output");
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("mp4");

    for index in 1..10_000 {
        let candidate = parent.join(format!("{stem}-{index}.{extension}"));
        if !candidate.exists() {
            return candidate;
        }
    }

    path
}
