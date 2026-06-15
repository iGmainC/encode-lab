use std::{
    path::{Path, PathBuf},
    process::Stdio,
};

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::{
    commands::error::{CommandError, CommandResult},
    evaluation::{
        build_vmaf_command_args, create_evaluation_id, parse_vmaf_log, VmafCommandOptions,
    },
    ffmpeg_runtime::ffmpeg_command,
    models::JobHistory,
    AppState,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunQualityEvaluationRequest {
    pub job_id: Option<String>,
    pub task_id: Option<String>,
    pub reference_file: Option<String>,
    pub distorted_file: Option<String>,
    pub metric: EvaluationMetric,
    pub vmaf: Option<VmafRequestOptions>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EvaluationMetric {
    Vmaf,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmafRequestOptions {
    pub model_path: Option<String>,
    pub scale_width: Option<u32>,
    pub scale_height: Option<u32>,
    pub frame_step: Option<u32>,
    pub thread_count: Option<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunQualityEvaluationResponse {
    pub evaluation_id: String,
    pub metric: EvaluationMetricResponse,
    pub score: f64,
    pub frame_count: Option<usize>,
    pub reference_file: String,
    pub distorted_file: String,
    pub log_path: String,
    pub command: String,
    pub stderr: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum EvaluationMetricResponse {
    Vmaf,
}

#[derive(Debug)]
struct EvaluationFiles {
    reference_file: String,
    distorted_file: String,
}

#[tauri::command]
pub fn run_quality_evaluation(
    state: State<'_, AppState>,
    request: RunQualityEvaluationRequest,
) -> CommandResult<RunQualityEvaluationResponse> {
    match request.metric {
        EvaluationMetric::Vmaf => run_vmaf_evaluation(state, request),
    }
}

fn run_vmaf_evaluation(
    state: State<'_, AppState>,
    request: RunQualityEvaluationRequest,
) -> CommandResult<RunQualityEvaluationResponse> {
    let files = resolve_evaluation_files(&state, &request)?;
    validate_existing_file(&files.reference_file, "referenceFile")?;
    validate_existing_file(&files.distorted_file, "distortedFile")?;

    let evaluation_id = create_evaluation_id();
    let log_path = build_vmaf_log_path(&evaluation_id)?;
    let vmaf = request.vmaf.unwrap_or(VmafRequestOptions {
        model_path: None,
        scale_width: None,
        scale_height: None,
        frame_step: None,
        thread_count: None,
    });
    if let Some(model_path) = &vmaf.model_path {
        validate_existing_file(model_path, "modelPath")?;
    }

    let args = build_vmaf_command_args(&VmafCommandOptions {
        reference_file: files.reference_file.clone(),
        distorted_file: files.distorted_file.clone(),
        log_path: log_path.to_string_lossy().to_string(),
        model_path: vmaf.model_path,
        scale_width: vmaf.scale_width,
        scale_height: vmaf.scale_height,
        frame_step: vmaf.frame_step,
        thread_count: vmaf.thread_count,
    })?;

    let output = ffmpeg_command()
        .args(&args)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .map_err(|err| CommandError::new("evaluation_run_failed", err.to_string()))?;
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if !output.status.success() {
        let _ = std::fs::remove_file(&log_path);
        return Err(CommandError::new("evaluation_run_failed", stderr));
    }

    let (score, frame_count) = parse_vmaf_log(&log_path)?;

    Ok(RunQualityEvaluationResponse {
        evaluation_id,
        metric: EvaluationMetricResponse::Vmaf,
        score,
        frame_count,
        reference_file: files.reference_file,
        distorted_file: files.distorted_file,
        log_path: log_path.to_string_lossy().to_string(),
        command: format!("ffmpeg {}", shell_join(&args)),
        stderr,
    })
}

fn resolve_evaluation_files(
    state: &State<'_, AppState>,
    request: &RunQualityEvaluationRequest,
) -> CommandResult<EvaluationFiles> {
    if let Some(job_id) = request.job_id.as_deref() {
        let jobs = state
            .storage
            .jobs_history
            .list()
            .map_err(CommandError::from)?;
        let job = jobs
            .iter()
            .find(|item| item.id == job_id)
            .ok_or_else(|| CommandError::new("not_found", "job not found"))?;
        return completed_job_files(job);
    }

    if let Some(task_id) = request.task_id.as_deref() {
        let jobs = state
            .storage
            .jobs_history
            .list()
            .map_err(CommandError::from)?;
        let job = jobs
            .iter()
            .filter(|item| item.task_id == task_id && is_completed_status(&item.status))
            .max_by(|a, b| {
                a.ended_at
                    .cmp(&b.ended_at)
                    .then_with(|| a.created_at.cmp(&b.created_at))
            })
            .ok_or_else(|| CommandError::new("not_found", "completed job not found for task"))?;
        return completed_job_files(job);
    }

    let reference_file = request
        .reference_file
        .as_ref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| CommandError::new("invalid_payload", "referenceFile is required"))?;
    let distorted_file = request
        .distorted_file
        .as_ref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| CommandError::new("invalid_payload", "distortedFile is required"))?;

    Ok(EvaluationFiles {
        reference_file: reference_file.clone(),
        distorted_file: distorted_file.clone(),
    })
}

fn completed_job_files(job: &JobHistory) -> CommandResult<EvaluationFiles> {
    if !is_completed_status(&job.status) {
        return Err(CommandError::new(
            "invalid_job_state",
            "quality evaluation requires a completed job",
        ));
    }

    Ok(EvaluationFiles {
        reference_file: job.input_file.clone(),
        distorted_file: job.output_file.clone(),
    })
}

fn is_completed_status(status: &str) -> bool {
    status.eq_ignore_ascii_case("completed")
}

fn validate_existing_file(path: &str, field: &str) -> CommandResult<()> {
    if path.trim().is_empty() {
        return Err(CommandError::new(
            "invalid_payload",
            format!("{field} cannot be empty"),
        ));
    }
    if !Path::new(path).is_file() {
        return Err(CommandError::new(
            "not_found",
            format!("{field} does not exist"),
        ));
    }
    Ok(())
}

fn build_vmaf_log_path(evaluation_id: &str) -> CommandResult<PathBuf> {
    let dir = std::env::temp_dir().join("encode-lab").join("evaluations");
    std::fs::create_dir_all(&dir)
        .map_err(|err| CommandError::new("evaluation_log_create_failed", err.to_string()))?;
    Ok(dir.join(format!("{evaluation_id}-vmaf.json")))
}

fn shell_join(args: &[String]) -> String {
    args.iter()
        .map(|item| shell_quote(item))
        .collect::<Vec<_>>()
        .join(" ")
}

fn shell_quote(value: &str) -> String {
    if value.is_empty() {
        return "''".to_string();
    }

    if value
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || "-_./:=+".contains(ch))
    {
        return value.to_string();
    }

    let escaped = value.replace('"', "\\\"");
    format!("\"{escaped}\"")
}

#[cfg(test)]
mod tests {
    use super::{completed_job_files, is_completed_status};
    use crate::models::JobHistory;

    #[test]
    fn completed_job_files_should_reject_non_completed_job() {
        let job = JobHistory {
            id: "job-1".to_string(),
            task_id: "task-1".to_string(),
            name: None,
            input_file: "source.mp4".to_string(),
            output_file: "output.mp4".to_string(),
            input_location: None,
            output_location: None,
            execution_node_id: None,
            transfer_ids: vec![],
            input_size_bytes: None,
            output_size_bytes: None,
            size_change_percent: None,
            input_video_size_bytes: None,
            output_video_size_bytes: None,
            video_size_change_percent: None,
            status: "failed".to_string(),
            command_line: None,
            error: None,
            created_at: "2026-01-01T00:00:00Z".to_string(),
            started_at: None,
            ended_at: None,
        };

        let err = completed_job_files(&job).expect_err("should reject");
        assert_eq!(err.code, "invalid_job_state");
    }

    #[test]
    fn completed_status_should_be_case_insensitive() {
        assert!(is_completed_status("completed"));
        assert!(is_completed_status("Completed"));
        assert!(!is_completed_status("running"));
    }
}
