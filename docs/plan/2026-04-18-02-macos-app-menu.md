# macOS Application Menu：About 跳转应用内模态框

## Context

macOS 下 Tauri v2 默认会为应用生成一份标准 application menu，第一项 submenu 下的「About GitUI」点击后弹出 Tauri 默认的原生 about 小窗。该小窗与应用内已有的 AboutInfo 模态框（含 logo / 作者 / 版本 / GitHub 链接，且适配 i18n 与主题）样式不一致，体验割裂。

`AppToolbar.vue` 早已预留 `show-about` 事件监听（`onMounted` 内 `listen('show-about', ...)`），触发后会把 `showAboutDialog` 置为 `true` 弹出现有模态框，但后端从未 emit 过该事件——这条链路一直是死代码。

本次改动：在 macOS 上自定义 application menu，把 About 项替换为发 `show-about` 事件的自定义 `MenuItem`，让原生菜单点击复用应用内 About 模态框。Windows / Linux 无 application menu 概念，本次不涉及。

## 进度总览

| 阶段 | 范围 | 状态 | 依赖 |
|------|------|------|------|
| 1 | 后端：新建 `menu.rs`，`lib.rs` 注册 + setup 调用 | 已完成 | — |
| 2 | 文档：`docs/02-repo-management.md` 补 macOS application menu 节 | 已完成 | 阶段 1 |

## 子任务

- [x] 新建 `src-tauri/src/menu.rs`，构造 application menu（自定义 About + 其他项 PredefinedMenuItem），注册 `app.on_menu_event` 在 About id 命中时 emit `show-about`
- [x] `src-tauri/src/lib.rs`：`#[cfg(target_os = "macos")] mod menu;`，setup 闭包中调用 `menu::setup_menu(&app.handle())`
- [x] `cargo check` 通过
- [x] 同步 `docs/02-repo-management.md`「窗口与托盘」节，新增「macOS application menu」子节并补全「涉及模块」/ 事件清单
- [ ] macOS 下手动验证：点击「About GitUI」弹应用内模态框；Cmd+Q / Cmd+C / Cmd+V / Cmd+A / Cmd+M 系统快捷键照常工作

## 关键决策

- **仅 macOS**：`#[cfg(target_os = "macos")]` 包裹 `mod menu` 与 setup 调用。其他平台不创建 application menu，沿用现状。
- **复用现有模态框**：不新建 `/about` 路由 / 视图，复用 `AppToolbar.vue` 已有的 `showAboutDialog` + `show-about` 监听。链路最短、可立刻验证。
- **保留默认菜单其他项**：Edit / Window / Quit / Hide 等用 `PredefinedMenuItem::*` 构造，复用系统标准行为，避免漏标准快捷键。
- **菜单事件用全局 `app.on_menu_event`**：不复用 `tray.rs` 里的 tray-builder `on_menu_event`，分开放在新模块 `menu.rs` 里，与 `tray::setup_tray` 平级。
- **不引入新 IPC command**：菜单 → emit event → 前端监听，不动 `docs/11-ipc.md` 命令清单。`show-about` 是一次性通知事件，不需要类型化的命令封装。

## 验证方式

1. `cd src-tauri && cargo check` —— 无 warning / error。
2. macOS 下 `npm run tauri dev` 启动：
   - 顶部菜单栏首项是「GitUI」，点开看到「About GitUI」
   - 点击「About GitUI」：弹出的是应用内 AboutInfo 模态框，**而非** Tauri 默认的小窗
   - Cmd+Q 退出，Cmd+M 最小化
   - 在任意输入框（如提交信息输入框）按 Cmd+C / Cmd+V / Cmd+A / Cmd+Z 正常工作；点 Edit 菜单的 Copy/Paste 也能在 WebView 内生效
3. Windows / Linux 启动：菜单栏行为与改动前一致（无 application menu，未引入异常）。
