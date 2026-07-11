use crate::storage::errors::{StorageError, StorageResult};

/// 当前结构化专业面板会生成、且值本身不具备文件或网络 I/O 语义的视频输出参数。
const ADVANCED_OUTPUT_FLAGS: [&str; 15] = [
    "-b:v",
    "-maxrate",
    "-minrate",
    "-bufsize",
    "-crf",
    "-preset",
    "-color_primaries",
    "-color_trc",
    "-colorspace",
    "-cpu-used",
    "-row-mt",
    "-tiles",
    "-svtav1-params",
    "-dolbyvision",
    "-metadata",
];

/// 允许直接作用于全部音轨的音频输出参数。
const AUDIO_OUTPUT_FLAGS: [&str; 8] = [
    "-acodec",
    "-ab",
    "-ar",
    "-ac",
    "-sample_fmt",
    "-channel_layout",
    "-ch_layout",
    "-audio_service_type",
];

/// 允许通过 `:a[:index]` 明确限定到音轨的输出参数。
const AUDIO_STREAM_OUTPUT_FLAGS: [&str; 17] = [
    "-c:a",
    "-codec:a",
    "-b:a",
    "-q:a",
    "-qscale:a",
    "-ar:a",
    "-ac:a",
    "-sample_fmt:a",
    "-channel_layout:a",
    "-ch_layout:a",
    "-profile:a",
    "-compression_level:a",
    "-bsf:a",
    "-frames:a",
    "-disposition:a",
    "-metadata:s:a",
    "-tag:a",
];

/// 按当前参数契约拆分 FFmpeg 参数。
///
/// 当前 UI 只承诺空白分隔，不执行 shell，也不解释引号或转义字符。
pub(crate) fn split_args(raw: &str) -> Vec<String> {
    raw.split_whitespace().map(ToString::to_string).collect()
}

/// 校验高级视频参数只使用当前专业面板支持的无 I/O 输出白名单。
///
/// 开放式 FFmpeg CLI 无法可靠推断每个未知 flag 是否消费下一个 token；因此这里不再
/// 用启发式寻找“裸路径”，而是只接受语义和取值都可验证的 option/value 对。
pub(crate) fn guard_advanced_output_args(value: Option<&str>) -> StorageResult<()> {
    let Some(raw) = value else {
        return Ok(());
    };

    let tokens = split_args(raw);
    if tokens.is_empty() {
        return Ok(());
    }
    if tokens.len() % 2 != 0 {
        return Err(StorageError::InvalidPayload(
            "advancedArgs must contain supported option/value pairs only".to_string(),
        ));
    }

    for pair in tokens.chunks_exact(2) {
        let flag = pair[0].as_str();
        let value = pair[1].as_str();
        if !ADVANCED_OUTPUT_FLAGS.contains(&flag) || !is_valid_advanced_output_value(flag, value) {
            return Err(StorageError::InvalidPayload(format!(
                "advancedArgs option/value '{flag} {value}' is not allowed"
            )));
        }
    }

    Ok(())
}

/// 校验自定义音频参数只包含明确限定到音频输出的白名单选项。
pub(crate) fn guard_audio_output_args(value: &str) -> StorageResult<()> {
    let tokens = split_args(value);
    if tokens.is_empty() {
        return Err(StorageError::InvalidPayload(
            "audio.customArgs cannot be empty".to_string(),
        ));
    }

    // 白名单中的参数均需要一个值；按二元组校验也会拒绝裸路径和缺失参数值。
    if tokens.len() % 2 != 0 {
        return Err(StorageError::InvalidPayload(
            "audio.customArgs must contain option/value pairs only".to_string(),
        ));
    }

    for pair in tokens.chunks_exact(2) {
        let flag = pair[0].as_str();
        if !is_allowed_audio_output_flag(flag) {
            return Err(StorageError::InvalidPayload(format!(
                "audio.customArgs option '{flag}' is not an allowed audio output option"
            )));
        }
    }

    Ok(())
}

/// 校验高级参数值的受控语法，避免嵌套参数重新引入文件或网络 I/O。
fn is_valid_advanced_output_value(flag: &str, value: &str) -> bool {
    if value.is_empty() || value.starts_with('-') || value.chars().any(char::is_control) {
        return false;
    }

    match flag {
        "-b:v" | "-maxrate" | "-minrate" | "-bufsize" => is_positive_rate(value),
        "-crf" => value
            .parse::<f64>()
            .is_ok_and(|number| number.is_finite() && (0.0..=63.0).contains(&number)),
        "-preset" | "-color_primaries" | "-color_trc" | "-colorspace" => is_identifier(value),
        "-cpu-used" => value.parse::<u8>().is_ok_and(|number| number <= 8),
        "-row-mt" | "-dolbyvision" => matches!(value, "0" | "1"),
        "-tiles" => value.split_once('x').is_some_and(|(columns, rows)| {
            is_unsigned_integer(columns) && is_unsigned_integer(rows)
        }),
        "-svtav1-params" => is_safe_svtav1_params(value),
        // metadata 的值只会作为单个输出标签写入，不会被再次解释为 CLI 或 filtergraph。
        "-metadata" => !value.trim().is_empty(),
        _ => false,
    }
}

/// 判断码率值为正数并仅使用 k/m/g 单位。
fn is_positive_rate(value: &str) -> bool {
    let number = value
        .chars()
        .last()
        .filter(|unit| matches!(unit, 'k' | 'K' | 'm' | 'M' | 'g' | 'G'))
        .map_or(value, |_| &value[..value.len() - 1]);
    number
        .parse::<f64>()
        .is_ok_and(|parsed| parsed.is_finite() && parsed > 0.0)
}

/// 判断值只包含 FFmpeg 枚举和 preset 常见的标识符字符。
fn is_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '_' | '-' | '.')
        })
}

/// 判断字符串为非空无符号整数。
fn is_unsigned_integer(value: &str) -> bool {
    !value.is_empty() && value.chars().all(|character| character.is_ascii_digit())
}

/// 只接受当前 UI 生成的 SVT-AV1 tune 与 film-grain 参数。
fn is_safe_svtav1_params(value: &str) -> bool {
    let mut saw_tune = false;
    let mut saw_film_grain = false;

    for item in value.split(':') {
        let Some((key, raw_value)) = item.split_once('=') else {
            return false;
        };
        if !is_unsigned_integer(raw_value) {
            return false;
        }
        match key {
            "tune" if !saw_tune => saw_tune = true,
            "film-grain" if !saw_film_grain => saw_film_grain = true,
            _ => return false,
        }
    }

    saw_tune
}

/// 判断选项是否属于音频输出白名单，并允许合法的数字音轨索引。
fn is_allowed_audio_output_flag(flag: &str) -> bool {
    AUDIO_OUTPUT_FLAGS.contains(&flag)
        || AUDIO_STREAM_OUTPUT_FLAGS
            .iter()
            .any(|prefix| matches_audio_stream_flag(flag, prefix))
}

/// 匹配 `-c:a` 与 `-c:a:0` 这类带可选数字索引的参数。
fn matches_audio_stream_flag(flag: &str, prefix: &str) -> bool {
    if flag == prefix {
        return true;
    }

    flag.strip_prefix(prefix)
        .and_then(|suffix| suffix.strip_prefix(':'))
        .is_some_and(|index| !index.is_empty() && index.chars().all(|char| char.is_ascii_digit()))
}

#[cfg(test)]
mod tests {
    use super::{guard_advanced_output_args, guard_audio_output_args};

    #[test]
    fn advanced_guard_accepts_current_professional_panel_output_options() {
        guard_advanced_output_args(Some(
            "-b:v 5M -maxrate 7M -bufsize 10M -color_primaries bt2020 -color_trc smpte2084 -colorspace bt2020nc -cpu-used 6 -row-mt 1 -tiles 2x1 -svtav1-params tune=0:film-grain=8",
        ))
        .expect("current structured advanced options should pass");
    }

    #[test]
    fn advanced_guard_rejects_unknown_valueless_and_nested_io_options() {
        for value in [
            "-i injected.mov",
            "-map 0:v:0 extra.mp4",
            "-shortest injected.mkv",
            "-af ametadata=mode=print:file=/tmp/sidecar.txt",
            "-x264-params stats=/tmp/x264.log",
        ] {
            guard_advanced_output_args(Some(value))
                .expect_err("unsupported or I/O-capable advanced option should fail");
        }
    }

    #[test]
    fn audio_guard_accepts_common_output_options_and_stream_indexes() {
        guard_audio_output_args("-c:a:0 aac -b:a:0 320k -ar 48000 -ac 2")
            .expect("audio output options should pass");
    }

    #[test]
    fn audio_guard_rejects_video_input_and_extra_output_options() {
        for value in [
            "-c:a aac -c:v libx264",
            "-c:a aac -i injected.wav",
            "-c:a aac extra.mka",
            "-c:a aac -f tee",
            "-c:a aac -af astats=metadata=1,ametadata=mode=print:file=/tmp/audio.txt",
        ] {
            guard_audio_output_args(value).expect_err("unsafe audio option should fail");
        }
    }
}
