mod commands;
mod evaluation;
mod ffmpeg_args;
mod ffmpeg_runtime;
mod models;
mod preview;
mod probe;
mod storage;
mod transcode;

use std::{
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};

use preview::PreviewManager;
use storage::errors::StorageError;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, Runtime, WindowEvent,
};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use transcode::job_manager::TranscodeManager;

#[derive(Clone)]
pub struct AppState {
    pub(crate) storage: storage::AppStorage,
    pub(crate) preview_manager: PreviewManager,
    pub(crate) transcode_manager: TranscodeManager,
    /** 应用运行期目录；正式转码的多阶段临时产物按 job id 隔离。 */
    pub(crate) runtime_dir: PathBuf,
    /** 主窗口与独立预览窗口之间的进程内快照，禁止落盘。 */
    pub(crate) detached_preview_payload: Arc<Mutex<Option<String>>>,
    pub(crate) allow_exit: Arc<AtomicBool>,
    pub(crate) open_jobs_on_next_activate: Arc<AtomicBool>,
}

fn build_state<R: tauri::Runtime>(app: &tauri::App<R>) -> Result<AppState, StorageError> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|_| StorageError::PathResolveFailed)?;
    let runtime_dir = build_runtime_dir();

    // 旧版本曾把可丢弃的运行产物写入 Application Support；迁移后主动清理，避免永久残留。
    cleanup_legacy_runtime_dir(&app_data_dir);
    let storage = storage::AppStorage::new(app_data_dir);
    transcode::job_manager::recover_stale_transcode_state(&storage, &runtime_dir)?;
    commands::evaluation::cleanup_stale_evaluation_runtime();

    Ok(AppState {
        storage,
        preview_manager: PreviewManager::new(runtime_dir.clone()),
        transcode_manager: TranscodeManager::new(),
        runtime_dir,
        detached_preview_payload: Arc::new(Mutex::new(None)),
        allow_exit: Arc::new(AtomicBool::new(false)),
        open_jobs_on_next_activate: Arc::new(AtomicBool::new(false)),
    })
}

/** 构建应用运行期目录；预览和转码中间产物必须进入系统临时目录。 */
fn build_runtime_dir() -> PathBuf {
    std::env::temp_dir().join("encode-lab").join("runtime")
}

/** 清理旧版本位于持久化应用数据目录中的运行期产物。 */
fn cleanup_legacy_runtime_dir(app_data_dir: &Path) {
    let _ = fs::remove_dir_all(app_data_dir.join("runtime"));
}

const TRAY_ID: &str = "encode-lab-tray"; // 托盘图标固定 id，用于任务状态变化时定位并刷新菜单。
const DETACHED_PREVIEW_WINDOW_LABEL: &str = "preview-detached"; // 独立预览窗口的固定 label。

/** 独立预览窗口销毁后回收邮箱和当前帧 pin。 */
fn cleanup_detached_preview_state(state: &AppState) {
    let frame_pin_id = state
        .detached_preview_payload
        .lock()
        .ok()
        .and_then(|mut payload| payload.take())
        .and_then(|payload| serde_json::from_str::<serde_json::Value>(&payload).ok())
        .and_then(|payload| {
            payload
                .get("framePinId")
                .and_then(serde_json::Value::as_str)
                .map(str::to_string)
        });
    if let Some(frame_pin_id) = frame_pin_id {
        let _ = state.preview_manager.release_frame_pin(&frame_pin_id);
    }
}

fn setup_tray<R: Runtime>(app: &tauri::App<R>) -> tauri::Result<()> {
    let menu = build_tray_menu(app)?;
    let icon = app.default_window_icon().cloned();
    let mut tray_builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .show_menu_on_left_click(true)
        .tooltip("Encode Lab")
        .on_menu_event(|app_handle, event| match event.id().as_ref() {
            "show-main-window" => show_main_window(app_handle),
            "quit-app" => request_app_exit(app_handle.clone()),
            _ => {}
        });

    if let Some(icon) = icon {
        // 使用应用图标作为托盘图标，避免额外维护一套平台资源。
        tray_builder = tray_builder.icon(icon);
    }

    tray_builder.build(app)?;
    Ok(())
}

/** 构建托盘菜单；任务状态项为只读展示项，不参与点击交互。 */
fn build_tray_menu<R: Runtime, M: Manager<R>>(manager: &M) -> tauri::Result<tauri::menu::Menu<R>> {
    let task_status_item = MenuItemBuilder::with_id("task-status", tray_task_status_text(manager))
        .enabled(false)
        .build(manager)?;

    let menu = MenuBuilder::new(manager)
        .item(&task_status_item)
        .separator()
        .text("show-main-window", "显示主窗口")
        .separator()
        .text("quit-app", "退出 Encode Lab")
        .build()?;

    Ok(menu)
}

/** 从持久化任务历史中读取当前托盘状态文案。 */
fn tray_task_status_text<R: Runtime, M: Manager<R>>(manager: &M) -> String {
    let Some(state) = manager.try_state::<AppState>() else {
        return "任务：状态读取中".to_string();
    };

    match state.storage.jobs_history.list() {
        Ok(jobs) => format_task_status(&jobs),
        Err(_) => "任务：状态读取失败".to_string(),
    }
}

/** 将任务历史压缩成托盘菜单中的短状态摘要。 */
fn format_task_status(jobs: &[models::JobHistory]) -> String {
    let mut queued = 0;
    let mut running = 0;
    let mut failed = 0;
    let mut interrupted = 0;

    for job in jobs {
        match job.status.as_str() {
            "queued" => queued += 1,
            "running" => running += 1,
            "failed" => failed += 1,
            "interrupted" => interrupted += 1,
            _ => {}
        }
    }

    let mut parts = Vec::new();
    if running > 0 {
        parts.push(format!("运行 {running}"));
    }
    if queued > 0 {
        parts.push(format!("排队 {queued}"));
    }
    if failed > 0 {
        parts.push(format!("失败 {failed}"));
    }
    if interrupted > 0 {
        parts.push(format!("中断 {interrupted}"));
    }

    if parts.is_empty() {
        "任务：空闲".to_string()
    } else {
        format!("任务：{}", parts.join("，"))
    }
}

/** 刷新托盘菜单，确保原生菜单里的任务状态跟随后端任务写回变化。 */
pub(crate) fn refresh_tray_menu<R: Runtime>(app_handle: &AppHandle<R>) {
    let Some(tray) = app_handle.tray_by_id(TRAY_ID) else {
        return;
    };
    let Ok(menu) = build_tray_menu(app_handle) else {
        return;
    };

    // 托盘菜单是原生菜单，任务状态变更后需要替换菜单实例才能刷新文案。
    let _ = tray.set_menu(Some(menu));
}

pub(crate) fn show_main_window<R: Runtime>(app_handle: &AppHandle<R>) {
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/** 主窗口隐藏时，标记下一次应用被通知激活后进入任务中心。 */
pub(crate) fn mark_open_jobs_on_notification_activate_if_hidden<R: Runtime>(
    app_handle: &AppHandle<R>,
) {
    if main_window_is_visible(app_handle) {
        return;
    }

    if let Some(state) = app_handle.try_state::<AppState>() {
        state
            .open_jobs_on_next_activate
            .store(true, Ordering::SeqCst);
    }
}

/** 通知点击或系统重新激活应用后，消费挂起的任务中心跳转。 */
fn open_jobs_if_requested<R: Runtime>(app_handle: &AppHandle<R>) {
    let Some(state) = app_handle.try_state::<AppState>() else {
        return;
    };

    if !state
        .open_jobs_on_next_activate
        .swap(false, Ordering::SeqCst)
    {
        return;
    }

    show_main_window(app_handle);
    // 导航由前端路由层负责，后端只广播目标页面，避免直接耦合 WebView URL 细节。
    let _ = app_handle.emit("app:navigate", "/jobs");
}

/** 判断主窗口当前是否可见；读取失败时按不可见处理。 */
fn main_window_is_visible<R: Runtime>(app_handle: &AppHandle<R>) -> bool {
    let Some(window) = app_handle.get_webview_window("main") else {
        return false;
    };

    window.is_visible().unwrap_or(false)
}

fn request_app_exit<R: Runtime>(app_handle: AppHandle<R>) {
    if should_confirm_exit(&app_handle) {
        confirm_exit_with_running_jobs(app_handle);
        return;
    }

    mark_exit_allowed_and_quit(app_handle);
}

fn confirm_exit_with_running_jobs<R: Runtime>(app_handle: AppHandle<R>) {
    show_main_window(&app_handle);
    app_handle
        .dialog()
        .message("当前还有正在进行或排队中的转码任务。退出应用可能会中断这些任务，确定要退出吗？")
        .title("确认退出 Encode Lab")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "退出应用".to_string(),
            "取消".to_string(),
        ))
        .show(move |confirmed| {
            if confirmed {
                mark_exit_allowed_and_quit(app_handle);
            }
        });
}

fn mark_exit_allowed_and_quit<R: Runtime>(app_handle: AppHandle<R>) {
    if let Some(state) = app_handle.try_state::<AppState>() {
        // 二次确认通过后允许本次退出，避免 ExitRequested 再次拦截。
        state.allow_exit.store(true, Ordering::SeqCst);
        // 预览的三个 FFmpeg 阶段都是独立子进程，退出前必须统一终止并删除运行目录。
        state.preview_manager.shutdown();
        // 退出前统一中断排队/运行中的任务，并回写 history，避免下次启动误判。
        state
            .transcode_manager
            .shutdown(&app_handle, &state.storage);
    }
    app_handle.exit(0);
}

fn should_confirm_exit<R: Runtime>(app_handle: &AppHandle<R>) -> bool {
    let Some(state) = app_handle.try_state::<AppState>() else {
        return false;
    };

    if state.allow_exit.load(Ordering::SeqCst) {
        return false;
    }

    state
        .storage
        .jobs_history
        .list()
        .map(|jobs| {
            jobs.iter()
                .any(|job| matches!(job.status.as_str(), "queued" | "running"))
        })
        .unwrap_or(false)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(desktop)]
    // 必须最先注册：第二个进程在进入 setup 和运行期垃圾回收前就会退出。
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        show_main_window(app);
    }));
    let builder = builder
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let resource_dir = app.path().resource_dir().ok();
            ffmpeg_runtime::init_ffmpeg_runtime(resource_dir);
            let state = build_state(app).map_err(|err| err.to_string())?;
            app.manage(state);
            setup_tray(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::tasks::create_task,
            commands::tasks::update_task,
            commands::tasks::list_tasks,
            commands::templates::save_template,
            commands::templates::update_template,
            commands::templates::delete_template,
            commands::templates::duplicate_template,
            commands::templates::apply_template,
            commands::templates::list_templates,
            commands::settings::get_settings,
            commands::settings::update_settings,
            commands::probe::detect_ffmpeg,
            commands::probe::list_encoder_capabilities,
            commands::probe::read_video_metadata,
            commands::preview::start_preview,
            commands::preview::update_preview,
            commands::preview::stop_preview,
            commands::preview::pin_preview_frame,
            commands::preview::release_preview_frame,
            commands::preview::set_detached_preview_payload,
            commands::preview::get_detached_preview_payload,
            commands::preview::clear_detached_preview_payload,
            commands::preview::close_detached_preview_window,
            commands::evaluation::run_quality_evaluation,
            commands::transcode::build_ffmpeg_command,
            commands::transcode::control_job,
            commands::transcode::delete_job,
            commands::transcode::enqueue_transcode_job,
            commands::transcode::list_jobs,
        ]);

    builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| match event {
            tauri::RunEvent::WindowEvent {
                label,
                event: WindowEvent::CloseRequested { api, .. },
                ..
            } if label == "main" => {
                // 主窗口关闭只隐藏到托盘，真正退出只能通过托盘菜单或系统退出事件。
                api.prevent_close();
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
            tauri::RunEvent::WindowEvent {
                label,
                event: WindowEvent::Focused(true),
                ..
            } if label == "main" => {
                open_jobs_if_requested(app_handle);
            }
            tauri::RunEvent::WindowEvent {
                label,
                event: WindowEvent::Destroyed,
                ..
            } if label == DETACHED_PREVIEW_WINDOW_LABEL => {
                if let Some(state) = app_handle.try_state::<AppState>() {
                    cleanup_detached_preview_state(&state);
                }
            }
            tauri::RunEvent::ExitRequested { api, .. } if should_confirm_exit(app_handle) => {
                // 处理 Cmd+Q 等系统退出路径，和托盘退出保持同一套二次确认。
                api.prevent_exit();
                confirm_exit_with_running_jobs(app_handle.clone());
            }
            tauri::RunEvent::ExitRequested { .. } => {
                if let Some(state) = app_handle.try_state::<AppState>() {
                    // 没有运行任务的系统退出不会走确认回调，仍需要回收预览管线。
                    state.preview_manager.shutdown();
                }
            }
            tauri::RunEvent::Exit => {
                if let Some(state) = app_handle.try_state::<AppState>() {
                    // macOS 系统菜单和快捷键可能直接结束事件循环；最终退出事件必须再次幂等回收。
                    state.preview_manager.shutdown();
                    state.transcode_manager.shutdown(app_handle, &state.storage);
                }
            }
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { .. } => {
                // macOS Dock 重新打开应用时同步处理待打开的任务页面。
                open_jobs_if_requested(app_handle);
            }
            _ => {}
        });
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        sync::{atomic::AtomicBool, Arc, Mutex},
    };

    use uuid::Uuid;

    use super::{
        build_runtime_dir, cleanup_detached_preview_state, cleanup_legacy_runtime_dir,
        preview::PreviewManager, storage::AppStorage, transcode::job_manager::TranscodeManager,
        AppState,
    };

    #[test]
    fn runtime_dir_should_use_system_temp_directory() {
        assert_eq!(
            build_runtime_dir(),
            std::env::temp_dir().join("encode-lab").join("runtime")
        );
    }

    #[test]
    fn legacy_runtime_cleanup_should_preserve_persistent_data() {
        let app_data_dir =
            std::env::temp_dir().join(format!("encode-lab-legacy-runtime-test-{}", Uuid::new_v4()));
        let runtime_dir = app_data_dir.join("runtime");
        fs::create_dir_all(&runtime_dir).expect("create legacy runtime directory");
        fs::write(runtime_dir.join("preview.png"), b"preview")
            .expect("write legacy runtime artifact");
        fs::write(app_data_dir.join("settings.json"), b"settings")
            .expect("write persistent settings");

        cleanup_legacy_runtime_dir(&app_data_dir);

        assert!(!runtime_dir.exists());
        assert!(app_data_dir.join("settings.json").is_file());
        let _ = fs::remove_dir_all(app_data_dir);
    }

    #[test]
    fn detached_window_cleanup_should_release_payload_frame_pin() {
        let base_dir = std::env::temp_dir().join(format!(
            "encode-lab-detached-cleanup-test-{}",
            Uuid::new_v4()
        ));
        let runtime_dir = base_dir.join("runtime");
        let preview_manager = PreviewManager::new(runtime_dir.clone());
        let session_dir = runtime_dir.join("preview").join("session-a");
        fs::create_dir_all(&session_dir).expect("create detached cleanup session");
        let source_path = session_dir.join("source-2.png");
        let preview_path = session_dir.join("preview-2.png");
        fs::write(&source_path, b"source").expect("write detached source frame");
        fs::write(&preview_path, b"preview").expect("write detached preview frame");
        let pinned = preview_manager
            .pin_frame(
                &source_path.to_string_lossy(),
                &preview_path.to_string_lossy(),
            )
            .expect("pin detached preview frame");
        let state = AppState {
            storage: AppStorage::new(base_dir.join("data")),
            preview_manager,
            transcode_manager: TranscodeManager::new(),
            runtime_dir: runtime_dir.clone(),
            detached_preview_payload: Arc::new(Mutex::new(Some(
                serde_json::json!({ "framePinId": pinned.frame_pin_id }).to_string(),
            ))),
            allow_exit: Arc::new(AtomicBool::new(false)),
            open_jobs_on_next_activate: Arc::new(AtomicBool::new(false)),
        };

        cleanup_detached_preview_state(&state);

        assert!(state
            .detached_preview_payload
            .lock()
            .expect("detached payload lock")
            .is_none());
        assert!(!std::path::Path::new(&pinned.source_image_path).exists());
        assert!(!std::path::Path::new(&pinned.preview_image_path).exists());
        let _ = fs::remove_dir_all(base_dir);
    }
}
