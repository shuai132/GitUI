// macOS application menu。其他平台不创建 application menu，依赖各自的窗口装饰。
//
// 唯一的自定义项是 "About GitUI"：点击后 emit `show-about` 事件，由前端
// AppToolbar 监听后弹出应用内 AboutInfo 模态框，替代 Tauri 默认的小窗。
// 其余项全部用 PredefinedMenuItem 复用系统标准行为，确保 Cmd+Q / Cmd+C /
// Cmd+V / Cmd+M 等快捷键不被改写。

use tauri::{
    menu::{MenuBuilder, MenuItem, PredefinedMenuItem, SubmenuBuilder},
    AppHandle, Emitter,
};

const ABOUT_MENU_ID: &str = "about-app";

pub fn setup_menu(app: &AppHandle) -> tauri::Result<()> {
    let about = MenuItem::with_id(app, ABOUT_MENU_ID, "About GitUI", true, None::<&str>)?;

    let app_submenu = SubmenuBuilder::new(app, "GitUI")
        .item(&about)
        .separator()
        .item(&PredefinedMenuItem::services(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, None)?)
        .item(&PredefinedMenuItem::hide_others(app, None)?)
        .item(&PredefinedMenuItem::show_all(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, None)?)
        .build()?;

    let edit_submenu = SubmenuBuilder::new(app, "Edit")
        .item(&PredefinedMenuItem::undo(app, None)?)
        .item(&PredefinedMenuItem::redo(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .build()?;

    let window_submenu = SubmenuBuilder::new(app, "Window")
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .item(&PredefinedMenuItem::maximize(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::close_window(app, None)?)
        .build()?;

    let menu = MenuBuilder::new(app)
        .item(&app_submenu)
        .item(&edit_submenu)
        .item(&window_submenu)
        .build()?;

    app.set_menu(menu)?;

    app.on_menu_event(|app, event| {
        if event.id().as_ref() == ABOUT_MENU_ID {
            let _ = app.emit("show-about", ());
        }
    });

    Ok(())
}
