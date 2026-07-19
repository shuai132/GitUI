use std::{
    panic::{catch_unwind, AssertUnwindSafe},
    sync::Arc,
};

use parking_lot::Mutex;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, Wry,
};

use super::{
    registry::MenuEntry,
    state::{CoordinatorInner, CoordinatorMode},
    TrayCoordinator,
};

pub(super) fn schedule_rebuild_tray_menu(inner: Arc<Mutex<CoordinatorInner>>, app: AppHandle) {
    let app_for_thread = app.clone();
    if let Err(err) = app.run_on_main_thread(move || {
        if catch_unwind(AssertUnwindSafe(|| {
            if let Err(err) = rebuild_tray_menu(&inner, &app_for_thread) {
                log::warn!("[tray] failed to rebuild menu: {err}");
            }
        }))
        .is_err()
        {
            log::error!("[tray] panic while rebuilding tray menu");
        }
    }) {
        log::warn!("[tray] failed to schedule tray menu rebuild: {err}");
    }
}

fn rebuild_tray_menu(inner: &Arc<Mutex<CoordinatorInner>>, app: &AppHandle) -> tauri::Result<()> {
    let entries = {
        let guard = inner.lock();
        let CoordinatorMode::Owner(owner) = &guard.mode else {
            return Ok(());
        };
        owner.registry.menu_entries()
    };
    let menu = build_tray_menu(app, &entries)?;

    let mut guard = inner.lock();
    let CoordinatorMode::Owner(owner) = &mut guard.mode else {
        return Ok(());
    };
    if let Some(tray) = &owner.tray {
        tray.set_menu(Some(menu))?;
    } else {
        let tray = build_tray_icon(app, &menu)?;
        owner.tray = Some(tray);
    }
    Ok(())
}

fn build_tray_menu(app: &AppHandle, entries: &[MenuEntry]) -> tauri::Result<Menu<Wry>> {
    let menu = Menu::new(app)?;
    let show = MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>)?;
    menu.append(&show)?;

    if !entries.is_empty() {
        let separator = PredefinedMenuItem::separator(app)?;
        menu.append(&separator)?;
        for entry in entries {
            let item = MenuItem::with_id(
                app,
                format!("window:{}", entry.window_id),
                &entry.label,
                true,
                None::<&str>,
            )?;
            menu.append(&item)?;
        }
    }

    let separator = PredefinedMenuItem::separator(app)?;
    menu.append(&separator)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    menu.append(&quit)?;
    Ok(menu)
}

fn build_tray_icon(app: &AppHandle, menu: &Menu<Wry>) -> tauri::Result<TrayIcon> {
    let mut tray_builder = TrayIconBuilder::new()
        .menu(menu)
        .show_menu_on_left_click(false)
        .tooltip("GitUI")
        .on_menu_event(|app, event| {
            let id = event.id().as_ref().to_string();
            let app = app.clone();
            if catch_unwind(AssertUnwindSafe(|| {
                app.state::<TrayCoordinator>()
                    .handle_tray_menu_event(&app, &id);
            }))
            .is_err()
            {
                log::error!("[tray] panic in tray menu callback");
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle().clone();
                if catch_unwind(AssertUnwindSafe(|| {
                    app.state::<TrayCoordinator>().show_preferred_window();
                }))
                .is_err()
                {
                    log::error!("[tray] panic in tray icon callback");
                }
            }
        });

    #[cfg(target_os = "macos")]
    {
        tray_builder = tray_builder
            .icon(tauri::include_image!("./icons/tray-template.png"))
            .icon_as_template(true);
    }

    #[cfg(not(target_os = "macos"))]
    if let Some(icon) = app.default_window_icon() {
        tray_builder = tray_builder.icon(icon.clone());
    }

    tray_builder.build(app)
}

pub(super) fn show_local_window(app: AppHandle, open_path: Option<String>) {
    let app_for_thread = app.clone();
    if let Err(err) = app.run_on_main_thread(move || {
        if catch_unwind(AssertUnwindSafe(|| {
            if let Some(window) = app_for_thread.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
            if let Some(path) = open_path {
                let _ = app_for_thread.emit("repo://open-path", path);
            }
        }))
        .is_err()
        {
            log::error!("[tray] panic while showing local window");
        }
    }) {
        log::warn!("[tray] failed to schedule local window show: {err}");
    }
}
