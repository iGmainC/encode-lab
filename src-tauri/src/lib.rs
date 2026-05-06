mod commands;
mod evaluation;
mod models;
mod preview;
mod probe;
mod storage;
mod transcode;

use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};

use preview::PreviewManager;
use storage::errors::StorageError;
use tauri::{menu::MenuBuilder, tray::TrayIconBuilder, AppHandle, Manager, Runtime, WindowEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

#[derive(Clone)]
pub struct AppState {
    pub(crate) storage: storage::AppStorage,
    pub(crate) preview_manager: PreviewManager,
    pub(crate) allow_exit: Arc<AtomicBool>,
}

fn build_state<R: tauri::Runtime>(app: &tauri::App<R>) -> Result<AppState, StorageError> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|_| StorageError::PathResolveFailed)?;
    let runtime_dir = build_runtime_dir(&app_data_dir);

    Ok(AppState {
        storage: storage::AppStorage::new(app_data_dir),
        preview_manager: PreviewManager::new(runtime_dir),
        allow_exit: Arc::new(AtomicBool::new(false)),
    })
}

fn build_runtime_dir(app_data_dir: &PathBuf) -> PathBuf {
    app_data_dir.join("runtime")
}

fn setup_tray<R: Runtime>(app: &tauri::App<R>) -> tauri::Result<()> {
    let menu = MenuBuilder::new(app)
        .text("show-main-window", "显示主窗口")
        .separator()
        .text("quit-app", "退出 Encode Lab")
        .build()?;
    let icon = app.default_window_icon().cloned();
    let mut tray_builder = TrayIconBuilder::with_id("encode-lab-tray")
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

fn show_main_window<R: Runtime>(app_handle: &AppHandle<R>) {
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
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
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
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
            commands::templates::list_templates,
            commands::settings::get_settings,
            commands::settings::update_settings,
            commands::probe::detect_ffmpeg,
            commands::probe::list_encoder_capabilities,
            commands::probe::read_video_metadata,
            commands::preview::start_preview,
            commands::preview::update_preview,
            commands::preview::stop_preview,
            commands::evaluation::run_quality_evaluation,
            commands::transcode::build_ffmpeg_command,
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
            tauri::RunEvent::ExitRequested { api, .. } if should_confirm_exit(app_handle) => {
                // 处理 Cmd+Q 等系统退出路径，和托盘退出保持同一套二次确认。
                api.prevent_exit();
                confirm_exit_with_running_jobs(app_handle.clone());
            }
            _ => {}
        });
}
