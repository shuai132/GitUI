# 01. 整体架构

## 设计目标

- **轻量、常驻**：关闭窗口隐藏到托盘，不退出进程，多仓库随时切换
- **原生性能**：Git 操作通过 `git2-rs`（libgit2）in-process 执行，不 fork CLI
- **跨平台**：桌面端基于 Tauri v2，macOS / Linux / Windows 一套代码
- **响应式**：`.git/` 与工作区变动通过文件监控推送，前端自动刷新

## 分层

```
┌──────────────────────────────────────────────┐
│ Vue 3 前端（WebView）                        │
│  Views / Components / Pinia Stores          │
│  composables: useGitCommands / useGitEvents │
└──────────────┬───────────────────────────────┘
               │ Tauri IPC: invoke() / event
┌──────────────┴───────────────────────────────┐
│ Rust 后端（Tauri v2）                        │
│  commands/*        ── IPC 命令层             │
│  git/engine.rs     ── GitEngine 静态方法     │
│  repo_manager.rs   ── 多仓库状态中心         │
│  watcher.rs        ── 文件系统监控           │
│  tray.rs           ── 系统托盘               │
└──────────────┬───────────────────────────────┘
               │
┌──────────────┴───────────────────────────────┐
│ git2-rs（libgit2）                           │
└──────────────────────────────────────────────┘
```

### Rust 后端模块

| 模块 | 职责 |
|------|------|
| `git/engine.rs` | `GitEngine` 静态方法集合，对 `git2::Repository` 的封装。每个方法接收 `path: &str`，内部调用 `Repository::open()`。`Repository` 不是 `Send`，不能跨线程持有 |
| `git/types.rs` | 所有 IPC 数据结构，`serde::Serialize + Deserialize`，字段命名为 `snake_case` |
| `git/error.rs` | `GitError` 枚举，实现 `Serialize + thiserror::Error`，可直接作为 Tauri command 的 `Err` 类型 |
| `git/credentials.rs` | SSH agent → `~/.ssh/id_ed25519` → `~/.ssh/id_rsa` 的凭据回调链 |
| `commands/*.rs` | 每个文件对应一个功能域（repo / status / commit / branch / remote / diff / log / stash / submodule / system）。统一通过 `State<'_, RepoManager>` 拿到 `repo_id → path`，再调 `GitEngine` |
| `repo_manager.rs` | 进程内的 `Arc<Mutex<HashMap<repo_id, RepoCacheEntry>>>`，通过 `.manage()` 注册为 Tauri 全局状态 |
| `watcher.rs` | 每个仓库一个 `notify-debouncer-mini`（300ms 防抖），监控整个工作目录 |
| `tray.rs` | 系统托盘菜单 + 左键点击显示窗口 |
| `lib.rs` | Tauri `Builder` 装配、`invoke_handler!` 注册、窗口 `CloseRequested` 拦截 |

### 前端分层

| 层 | 内容 |
|----|------|
| `views/` | 路由页面：`HistoryView.vue`、`BranchesView.vue` |
| `components/` | 按功能域组织：`layout/` `history/` `workspace/` `diff/` `branch/` `commit/` `submodule/` `common/` |
| `stores/` (Pinia) | `repos` `workspace` `history` `diff` `stash` `submodules` `ui` |
| `composables/` | `useGitCommands`（所有 `invoke` 封装）、`useGitEvents`（Tauri Events 订阅）、`useBranchTreeState` |
| `utils/` | `graph.ts`（提交图 lane 算法）、`branchTree.ts`（远程分支树形构造）、`format.ts` |
| `lib/highlight.ts` | highlight.js 子集注册 + 扩展名到语言映射 |
| `types/git.ts` | 与 `git/types.rs` 一一对应的 TypeScript 接口 |

## 数据流

### 主动操作

```
UI → store 方法 → useGitCommands.invoke() → Rust command
    → GitEngine::... → git2 → 返回值
    → store 更新 state → Vue 响应式渲染
```

### 文件系统反向推送

```
.git/ 或工作区变更
  → WatcherService（300ms 防抖）
  → app.emit("repo://status-changed", repo_id)
  → 前端 useGitEvents.onStatusChanged
  → 若 repoId === activeRepoId → workspaceStore.refresh() + submodulesStore.loadSubmodules()
```

当前只订阅了 `repo://status-changed`，后续可扩展 `repo://operation-progress`、`repo://error`（前端 composables 已留接口）。

## 路由

Hash 模式，两个主要路由：

| 路径 | 视图 | 说明 |
|------|------|------|
| `/` | redirect → `/history` | 默认落地页 |
| `/history` | `HistoryView.vue` | 提交图 + 详情 + WIP 行，承担了"工作区"的职责 |
| `/branches` | `BranchesView.vue` | 分支列表视图（次级） |

**工作区和历史合并到同一个视图**：在 `HistoryView` 的虚拟列表顶部插入一条 `WipRow`（有未提交变更时显示），点击后右侧面板切换为 `WipPanel`（文件列表 + 提交表单）。这样不需要单独的 `/workspace` 路由，用户可以把"改代码 → 提交 → 看历史"串在一个视图里完成。

## 关键决策

- **`Repository` 每次临时打开**：`git2::Repository` 不是 `Send`，而且 libgit2 内部会缓存索引；所以每次命令都 `open(path)` 而不是跨调用持有。开销可接受（纳秒级）
- **主要状态放在前端 Pinia，而不是后端 `RepoManager`**：后端的 `RepoCacheEntry.status` 目前只是冗余字段，真实可视状态都从命令返回后缓存在 Pinia store。前端是单一事实来源
- **关闭窗口 = 隐藏**：`lib.rs` 在 `WindowEvent::CloseRequested` 中调 `window.hide()` 并 `prevent_close()`；只有托盘菜单 "退出" 才真正退出
- **watcher 监控整个工作目录而非仅 `.git/`**：只监听 `.git/` 会漏掉 tracked 文件的手动编辑，无法触发状态刷新
