use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    thread,
};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Runtime, State};
use uuid::Uuid;

use crate::{
    commands::error::{CommandError, CommandResult},
    models::{JobHistory, TaskConfigPayload, Validate},
    transcode::command_builder::{build_ffmpeg_command_args, build_ffmpeg_commands},
    AppState,
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnqueueTranscodeJobRequest {
    pub payload: TaskConfigPayload,
    pub input_file: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnqueueTranscodeJobResponse {
    pub task_id: String,
    pub job_id: String,
    pub output_file: String,
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

    let output_file = resolve_output_file(&request.payload, &request.input_file)?;
    let command_args =
        build_ffmpeg_command_args(&request.payload, &request.input_file, &output_file)
            .map_err(CommandError::from)?;
    let command_line = build_ffmpeg_commands(&request.payload, &request.input_file, &output_file)
        .map_err(CommandError::from)?
        .commands
        .join(" && ");
    let task_id = state
        .storage
        .tasks
        .create(request.payload.clone())
        .map_err(CommandError::from)?;
    let job_id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let job = JobHistory {
        id: job_id.clone(),
        task_id: task_id.clone(),
        name: Some(request.payload.name.clone()),
        input_file: request.input_file,
        output_file: output_file.clone(),
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

    let storage = state.storage.clone();
    thread::spawn(move || {
        run_transcode_job(app, storage, job, command_args);
    });

    Ok(EnqueueTranscodeJobResponse {
        task_id,
        job_id,
        output_file,
    })
}

fn run_transcode_job<R: Runtime>(
    app: AppHandle<R>,
    storage: crate::storage::AppStorage,
    mut job: JobHistory,
    command_args: Vec<Vec<String>>,
) {
    job.status = "running".to_string();
    job.started_at = Some(Utc::now().to_rfc3339());
    let _ = storage.jobs_history.update(&job);
    let _ = app.emit("job:updated", &job);

    for args in command_args {
        match Command::new("ffmpeg").args(args).output() {
            Ok(output) if output.status.success() => {}
            Ok(output) => {
                let stderr_tail = tail_text(&String::from_utf8_lossy(&output.stderr));
                job.status = "failed".to_string();
                job.error = Some(stderr_tail);
                break;
            }
            Err(err) => {
                job.status = "failed".to_string();
                job.error = Some(err.to_string());
                break;
            }
        }
    }

    if job.status != "failed" {
        job.status = "completed".to_string();
        job.error = None;
    }

    job.ended_at = Some(Utc::now().to_rfc3339());
    let _ = storage.jobs_history.update(&job);
    let _ = app.emit("job:updated", &job);
}

fn resolve_output_file(payload: &TaskConfigPayload, input_file: &str) -> CommandResult<String> {
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

    Ok(
        next_available_path(output_dir.join(format!("{sanitized}.{extension}")))
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

fn tail_text(value: &str) -> String {
    let lines: Vec<&str> = value.lines().rev().take(20).collect();
    lines.into_iter().rev().collect::<Vec<_>>().join("\n")
}
