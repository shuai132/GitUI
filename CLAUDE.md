# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

GitUI 是一个跨平台 Git 桌面客户端，基于 **Tauri v2（Rust 后端）+ Vue 3 前端**构建，目标是低资源占用、支持常驻进程、多仓库管理。

## 常用命令

```bash
# 开发（同时启动 Vite dev server 和 Tauri 进程）
npm run tauri dev

# 仅构建前端（TypeScript 类型检查 + Vite 构建）
npm run build

# 仅做 TypeScript 类型检查
npx vue-tsc --noEmit

# 仅检查 Rust 代码（不编译完整产物，速度快）
cd src-tauri && cargo check

# 运行 Rust 测试
cd src-tauri && cargo test

# 打包发布
npm run tauri build
```

## 架构概览

### 整体结构

```
前端（Vue 3 / WebView）
    ↕ IPC: invoke() 命令 + Tauri Events
后端（Rust / Tauri）
    ↕
git2-rs（libgit2，in-process，无 fork）
```

关闭窗口不退出程序——在 `lib.rs` 的 `on_window_event` 中拦截 `CloseRequested`，调用 `window.hide()` 隐藏到系统托盘。只有托盘菜单"退出"才真正退出。

### Rust 后端

**`src-tauri/src/git/`** — Git 操作核心层
- `engine.rs`：`GitEngine` 静态方法集合，对 `git2` crate 的封装。每个方法接收 `path: &str`，内部调用 `Repository::open()` 获取 `git2::Repository` 实例（`Repository` 不是 `Send`，不能跨线程持有）
- `types.rs`：所有在 IPC 中传递的 Rust 数据结构，均实现 `serde::Serialize + Deserialize`，字段命名为 `snake_case`，自动映射到前端 TypeScript 的对应类型
- `error.rs`：`GitError` 枚举，实现 `Serialize` 和 `thiserror::Error`，可直接作为 Tauri command 的 `Err` 类型返回给前端
- `credentials.rs`：SSH agent → `~/.ssh/id_ed25519` → `~/.ssh/id_rsa` 的凭据回调链

**`src-tauri/src/commands/`** — IPC 命令层，每个文件对应一个功能域

所有 command 通过 `State<'_, RepoManager>` 获取仓库路径，再调用 `GitEngine` 方法。注册在 `lib.rs` 的 `invoke_handler!` 宏中。

**`src-tauri/src/repo_manager.rs`** — 多仓库状态中心

`RepoManager` 持有 `Arc<Mutex<HashMap<repo_id, RepoCacheEntry>>>`，被 `.manage()` 注册为 Tauri 全局状态，在所有 command 中通过 `State<'_, RepoManager>` 注入。

**`src-tauri/src/watcher.rs`** — 文件系统监控

`WatcherService` 对每个打开的仓库监听其 `.git/` 目录（通过 `notify-debouncer-mini`，300ms 防抖），触发后通过 `app.emit("repo://status-changed", repo_id)` 推送事件到前端。

### 前端

**IPC 层**（不要直接调用 `invoke`，统一走以下封装）：
- `src/composables/useGitCommands.ts`：所有 Tauri `invoke()` 调用的类型安全封装，参数名需与 Rust command 的参数名完全一致（camelCase）
- `src/composables/useGitEvents.ts`：监听 Tauri Events（`repo://status-changed` 等）

**数据流**：
```
.git/ 变更 → WatcherService → emit "repo://status-changed"
  → useGitEvents.onStatusChanged → useWorkspaceStore.refresh()
  → invoke("get_status") → GitEngine::get_status() → WorkspaceStatus
  → Vue 组件响应式更新
```

**Pinia Stores**（`src/stores/`）：
- `repos.ts`：仓库列表 + `activeRepoId`；调用 `open_repo` / `close_repo`
- `workspace.ts`：当前仓库的工作区状态（staged / unstaged / untracked）；监听 status-changed 事件刷新
- `history.ts`：提交历史（分页 200 条）+ 分支列表；提交后需手动调用 `loadLog()`
- `diff.ts`：当前选中文件的 diff，按需加载

**视图路由**（`src/router/index.ts`）：Hash 模式，三个路由：
- `/workspace` → `WorkspaceView.vue`（工作区 + Diff）
- `/history` → `HistoryView.vue`（提交历史 + 提交详情）
- `/branches` → `BranchesView.vue`（分支管理）

**Diff 渲染**：`DiffViewer.vue` 使用 CodeMirror 6（`codemirror` + `@codemirror/theme-one-dark`），将 Rust 返回的 `FileDiff` 结构重新拼装成 unified diff 文本后展示，只读模式。

### IPC 数据类型对应关系

Rust `snake_case` 字段 ↔ TypeScript `snake_case` 字段（Tauri 默认不做驼峰转换）：

| Rust (`types.rs`) | TypeScript (`src/types/git.ts`) |
|---|---|
| `WorkspaceStatus` | `WorkspaceStatus` |
| `CommitInfo` | `CommitInfo` |
| `FileDiff` | `FileDiff` |
| `BranchInfo` | `BranchInfo` |
| `LogPage` | `LogPage` |

新增 IPC command 时：
1. 在 `src-tauri/src/commands/` 对应文件中添加 `#[tauri::command]` 函数
2. 在 `lib.rs` 的 `tauri::generate_handler![]` 中注册
3. 在 `src/composables/useGitCommands.ts` 中添加对应的 `invoke<T>()` 封装
4. 如有新数据结构，同步更新 `src-tauri/src/git/types.rs` 和 `src/types/git.ts`

### 样式

使用 Tailwind CSS v4（通过 `@tailwindcss/vite` 插件），全局 CSS 变量定义在 `src/assets/main.css`（`--bg-primary`、`--accent-blue` 等），组件使用 `<style scoped>`。
