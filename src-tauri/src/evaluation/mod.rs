use std::{collections::HashMap, fs, path::Path};

use serde::Deserialize;
use uuid::Uuid;

use crate::commands::error::CommandError;

/** VMAF 评估命令配置。 */
pub struct VmafCommandOptions {
    /** 源参考视频路径 */
    pub reference_file: String,
    /** 转码后待评估视频路径 */
    pub distorted_file: String,
    /** VMAF JSON 日志输出路径 */
    pub log_path: String,
    /** 可选 VMAF 模型路径 */
    pub model_path: Option<String>,
    /** 可选缩放宽度，需与 scale_height 同时存在 */
    pub scale_width: Option<u32>,
    /** 可选缩放高度，需与 scale_width 同时存在 */
    pub scale_height: Option<u32>,
    /** 可选抽样间隔，对应 libvmaf n_subsample */
    pub frame_step: Option<u32>,
    /** 可选线程数，对应 libvmaf n_threads */
    pub thread_count: Option<u32>,
}

/** VMAF JSON 日志中的聚合指标。 */
#[derive(Debug, Deserialize)]
struct VmafMetricAggregate {
    /** 平均分 */
    mean: Option<f64>,
}

/** VMAF JSON 日志结构。 */
#[derive(Debug, Deserialize)]
struct VmafLog {
    /** 每帧指标，用于返回实际参与评估的帧数 */
    frames: Option<Vec<serde_json::Value>>,
    /** 聚合指标，通常包含 pooled_metrics.vmaf.mean */
    pooled_metrics: Option<HashMap<String, VmafMetricAggregate>>,
}

/**
 * 构建 FFmpeg libvmaf 评估参数。
 * @param options VMAF 命令配置
 * @returns 可直接传给 ffmpeg 的参数数组
 */
pub fn build_vmaf_command_args(options: &VmafCommandOptions) -> Result<Vec<String>, CommandError> {
    validate_vmaf_options(options)?;

    let distorted_chain = build_vmaf_input_chain("0:v", options.scale_width, options.scale_height);
    let reference_chain = build_vmaf_input_chain("1:v", options.scale_width, options.scale_height);
    let libvmaf_options = build_libvmaf_options(options);
    let filter = format!(
        "{distorted_chain}[dist];{reference_chain}[ref];[dist][ref]libvmaf={libvmaf_options}"
    );

    Ok(vec![
        "-i".to_string(),
        options.distorted_file.clone(),
        "-i".to_string(),
        options.reference_file.clone(),
        "-lavfi".to_string(),
        filter,
        "-f".to_string(),
        "null".to_string(),
        "-".to_string(),
    ])
}

/**
 * 解析 VMAF JSON 日志。
 * @param log_path libvmaf 输出的 JSON 文件路径
 * @returns VMAF 平均分和帧数
 */
pub fn parse_vmaf_log(log_path: &Path) -> Result<(f64, Option<usize>), CommandError> {
    let raw = fs::read_to_string(log_path)
        .map_err(|err| CommandError::new("evaluation_log_read_failed", err.to_string()))?;
    let parsed: VmafLog = serde_json::from_str(&raw)
        .map_err(|err| CommandError::new("evaluation_log_parse_failed", err.to_string()))?;
    let score = parsed
        .pooled_metrics
        .as_ref()
        .and_then(|metrics| metrics.get("vmaf"))
        .and_then(|metric| metric.mean)
        .ok_or_else(|| CommandError::new("evaluation_score_missing", "VMAF mean score missing"))?;

    Ok((score, parsed.frames.map(|frames| frames.len())))
}

/**
 * 创建本次评估的唯一标识。
 * @returns UUID 字符串
 */
pub fn create_evaluation_id() -> String {
    Uuid::new_v4().to_string()
}

fn validate_vmaf_options(options: &VmafCommandOptions) -> Result<(), CommandError> {
    if options.reference_file.trim().is_empty() || options.distorted_file.trim().is_empty() {
        return Err(CommandError::new(
            "invalid_payload",
            "referenceFile and distortedFile cannot be empty",
        ));
    }
    if options.log_path.trim().is_empty() {
        return Err(CommandError::new(
            "invalid_payload",
            "VMAF log path cannot be empty",
        ));
    }
    if options.scale_width.is_some() != options.scale_height.is_some() {
        return Err(CommandError::new(
            "invalid_payload",
            "scaleWidth and scaleHeight must be provided together",
        ));
    }
    if matches!(options.frame_step, Some(0)) {
        return Err(CommandError::new(
            "invalid_payload",
            "frameStep must be greater than 0",
        ));
    }
    if matches!(options.thread_count, Some(0)) {
        return Err(CommandError::new(
            "invalid_payload",
            "threadCount must be greater than 0",
        ));
    }
    Ok(())
}

fn build_vmaf_input_chain(
    label: &str,
    scale_width: Option<u32>,
    scale_height: Option<u32>,
) -> String {
    let mut filters = vec![format!("[{label}]setpts=PTS-STARTPTS")];
    if let (Some(width), Some(height)) = (scale_width, scale_height) {
        // VMAF 要求两路视频尺寸一致，用户配置缩放时两路都收敛到同一尺寸。
        filters.push(format!("scale={width}:{height}:flags=bicubic"));
    }
    filters.join(",")
}

fn build_libvmaf_options(options: &VmafCommandOptions) -> String {
    let mut values = vec![
        "log_fmt=json".to_string(),
        format!("log_path={}", escape_filter_value(&options.log_path)),
    ];

    if let Some(model_path) = &options.model_path {
        values.push(format!("model=path={}", escape_filter_value(model_path)));
    }
    if let Some(frame_step) = options.frame_step {
        values.push(format!("n_subsample={frame_step}"));
    }
    if let Some(thread_count) = options.thread_count {
        values.push(format!("n_threads={thread_count}"));
    }

    values.join(":")
}

fn escape_filter_value(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace(':', "\\:")
        .replace('\'', "\\'")
}

#[cfg(test)]
mod tests {
    use super::{build_vmaf_command_args, parse_vmaf_log, VmafCommandOptions};

    #[test]
    fn build_vmaf_command_should_use_distorted_then_reference_inputs() {
        let args = build_vmaf_command_args(&VmafCommandOptions {
            reference_file: "source.mp4".to_string(),
            distorted_file: "encoded.mp4".to_string(),
            log_path: "/tmp/vmaf.json".to_string(),
            model_path: Some("/tmp/model.json".to_string()),
            scale_width: Some(1920),
            scale_height: Some(1080),
            frame_step: Some(5),
            thread_count: Some(4),
        })
        .expect("vmaf args");

        assert_eq!(args[0], "-i");
        assert_eq!(args[1], "encoded.mp4");
        assert_eq!(args[2], "-i");
        assert_eq!(args[3], "source.mp4");
        assert!(args.iter().any(|item| item.contains("[dist][ref]libvmaf")));
        assert!(args.iter().any(|item| item.contains("scale=1920:1080")));
        assert!(args.iter().any(|item| item.contains("n_subsample=5")));
        assert!(args.iter().any(|item| item.contains("n_threads=4")));
    }

    #[test]
    fn parse_vmaf_log_should_read_mean_score() {
        let path = std::env::temp_dir().join("encode-lab-vmaf-test.json");
        std::fs::write(
            &path,
            r#"{"frames":[{},{}],"pooled_metrics":{"vmaf":{"mean":93.25}}}"#,
        )
        .expect("write fixture");

        let (score, frame_count) = parse_vmaf_log(&path).expect("parse score");
        let _ = std::fs::remove_file(path);

        assert_eq!(score, 93.25);
        assert_eq!(frame_count, Some(2));
    }
}
