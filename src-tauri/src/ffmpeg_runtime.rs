use std::{
    env,
    path::{Path, PathBuf},
    process::Command,
    sync::OnceLock,
};

/** FFmpeg runtime 解析结果；优先使用随应用打包的专用二进制。 */
#[derive(Debug, Clone)]
struct FfmpegRuntime {
    /** Tauri 打包后的 resources 目录；开发环境可能不存在。 */
    resource_dir: Option<PathBuf>,
}

/** 已解析的命令路径，以及 bundled runtime 对应的动态库目录。 */
#[derive(Debug, Clone)]
struct ResolvedBinary {
    /** 实际要执行的二进制路径。 */
    path: PathBuf,
    /** bundled runtime 的 lib 目录；系统 PATH 二进制没有这个值。 */
    library_dir: Option<PathBuf>,
    /** bundled macOS runtime 的 Vulkan ICD manifest；系统 PATH 二进制没有这个值。 */
    vulkan_icd_path: Option<PathBuf>,
}

static FFMPEG_RUNTIME: OnceLock<FfmpegRuntime> = OnceLock::new();

/** 初始化 runtime 解析上下文；应用启动时调用一次即可。 */
pub fn init_ffmpeg_runtime(resource_dir: Option<PathBuf>) {
    let _ = FFMPEG_RUNTIME.set(FfmpegRuntime { resource_dir });
}

/** 创建 FFmpeg 命令；调用方只负责追加参数。 */
pub fn ffmpeg_command() -> Command {
    command_for_binary("ffmpeg")
}

/** 创建 FFprobe 命令；调用方只负责追加参数。 */
pub fn ffprobe_command() -> Command {
    command_for_binary("ffprobe")
}

/** 解析当前应使用的 FFmpeg 路径。 */
pub fn resolve_ffmpeg_path() -> Option<PathBuf> {
    resolve_binary("ffmpeg").map(|binary| binary.path)
}

/** 解析当前应使用的 FFprobe 路径。 */
pub fn resolve_ffprobe_path() -> Option<PathBuf> {
    resolve_binary("ffprobe").map(|binary| binary.path)
}

/** 将路径转换成前端可展示的字符串。 */
pub fn display_path(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

fn command_for_binary(name: &str) -> Command {
    let resolved = resolve_binary(name).unwrap_or_else(|| ResolvedBinary {
        path: PathBuf::from(name),
        library_dir: None,
        vulkan_icd_path: None,
    });
    let mut command = Command::new(&resolved.path);

    if let Some(library_dir) = resolved.library_dir {
        apply_library_path_env(&mut command, &library_dir);
    }
    if let Some(vulkan_icd_path) = resolved.vulkan_icd_path {
        apply_vulkan_icd_env(&mut command, &vulkan_icd_path);
    }

    command
}

fn resolve_binary(name: &str) -> Option<ResolvedBinary> {
    resolve_bundled_binary(name).or_else(|| {
        resolve_system_binary_path(name).map(|path| ResolvedBinary {
            path,
            library_dir: None,
            vulkan_icd_path: None,
        })
    })
}

fn resolve_bundled_binary(name: &str) -> Option<ResolvedBinary> {
    let target = runtime_target()?;
    let binary_name = binary_file_name(name);

    for root in runtime_roots() {
        let target_dir = root.join(target);
        let candidate = target_dir.join("bin").join(&binary_name);
        if candidate.is_file() {
            return Some(ResolvedBinary {
                path: candidate,
                library_dir: Some(target_dir.join("lib")),
                vulkan_icd_path: bundled_vulkan_icd_path(&target_dir),
            });
        }
    }

    None
}

fn bundled_vulkan_icd_path(target_dir: &Path) -> Option<PathBuf> {
    if !cfg!(target_os = "macos") {
        return None;
    }

    let candidate = target_dir
        .join("etc")
        .join("vulkan")
        .join("icd.d")
        .join("MoltenVK_icd.json");

    // 只有随包 runtime 明确包含 MoltenVK ICD 时才固定 Vulkan 驱动来源。
    candidate.is_file().then_some(candidate)
}

fn runtime_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(runtime) = FFMPEG_RUNTIME.get() {
        if let Some(resource_dir) = &runtime.resource_dir {
            // 打包后 resources 内的 runtime 是正式分发路径。
            roots.push(resource_dir.join("ffmpeg-runtime"));
        }
    }

    // 开发和测试环境直接读取仓库内由 prepare:ffmpeg 下载的 runtime。
    roots.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("ffmpeg-runtime"));
    roots
}

fn resolve_system_binary_path(name: &str) -> Option<PathBuf> {
    let path_var = env::var_os("PATH")?;
    for dir in env::split_paths(&path_var) {
        for binary_name in system_binary_names(name) {
            let candidate = dir.join(binary_name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }

    None
}

fn apply_library_path_env(command: &mut Command, library_dir: &Path) {
    if cfg!(target_os = "macos") {
        prepend_env_path(command, "DYLD_LIBRARY_PATH", library_dir);
    }
    if cfg!(target_os = "linux") {
        prepend_env_path(command, "LD_LIBRARY_PATH", library_dir);
    }
}

fn apply_vulkan_icd_env(command: &mut Command, vulkan_icd_path: &Path) {
    if cfg!(target_os = "macos") {
        // libplacebo 依赖 Vulkan；bundled runtime 固定使用随包 MoltenVK，避免读取用户机器的系统 ICD。
        command.env("VK_ICD_FILENAMES", vulkan_icd_path);
    }
}

fn prepend_env_path(command: &mut Command, key: &str, path: &Path) {
    let mut values = vec![path.to_path_buf()];
    if let Some(existing) = env::var_os(key) {
        values.extend(env::split_paths(&existing));
    }

    if let Ok(joined) = env::join_paths(values) {
        // 只影响当前 FFmpeg/FFprobe 子进程，不污染主应用进程环境。
        command.env(key, joined);
    }
}

fn system_binary_names(name: &str) -> Vec<String> {
    if cfg!(target_os = "windows") {
        return env::var_os("PATHEXT")
            .map(|value| {
                env::split_paths(&value)
                    .filter_map(|ext| ext.to_str().map(|ext| format!("{name}{ext}")))
                    .collect()
            })
            .unwrap_or_else(|| vec![format!("{name}.exe"), name.to_string()]);
    }

    vec![name.to_string()]
}

fn binary_file_name(name: &str) -> String {
    if cfg!(target_os = "windows") {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

fn runtime_target() -> Option<&'static str> {
    if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        return Some("darwin-arm64");
    }
    if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
        return Some("linux-x64");
    }

    None
}

#[cfg(test)]
mod tests {
    use super::runtime_target;

    #[test]
    fn supported_targets_are_named_like_release_artifacts() {
        if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
            assert_eq!(runtime_target(), Some("darwin-arm64"));
        }
        if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
            assert_eq!(runtime_target(), Some("linux-x64"));
        }
    }
}
