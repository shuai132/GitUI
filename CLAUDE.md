# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

GitUI 是一个跨平台 Git 桌面客户端，基于 **Tauri v2（Rust 后端）+ Vue 3 前端**构建，目标是轻量、快速、易用，方便多仓库快速切换。

按功能域的详细设计文档在 `docs/` 目录，索引见 [docs/README.md](./docs/README.md)。改动任何一个模块前，先读对应那份文档。

## 文档驱动开发

`docs/` 下按功能域组织的设计文档是项目的单一事实来源，索引见 [docs/README.md](./docs/README.md)。改动前先读对应那份文档建立上下文。

**什么时候需要同步更新文档**：改动涉及 UI 结构、用户可见行为、模块职责或 IPC 契约时。IPC 契约变动（新增 / 修改 / 删除命令或数据结构）**必须**同步改 [docs/11-ipc.md](./docs/11-ipc.md)。纯内部重构、变量改名、小 bugfix 不触发文档更新。

**文档写契约和取舍，不贴实现**：设计文档描述目标、UI 组件 / store / 命令的**名字**、数据流、关键决策和为什么这么选；**不要复制函数体、结构体字段定义、具体常量值**——代码是单一事实来源，文档贴过去会立刻过时，还会污染下次读文档时的判断。需要引用某个类型时，写 "见 `git/types.rs::StashEntry`" 即可。

**操作规则**：文档更新和代码改动放在同一次提交里。如果实现中发现原方案不合理，先回到文档改方案，再继续写代码。拿不准某次改动是否触发文档更新时，先问用户。


## 提交规范

**单次 commit 聚焦一个主题**。用户让"提交"时，只 `git add` 本次对话实际改过的文件——即便工作区里还有其他 modified 文件，也不要顺手打包进来。那些很可能是用户自己正在推进的、准备走独立提交的半成品。

**提交前先 `git diff --cached` 核对**：staged 内容要和你心里"我改了什么"对得上。如果某个文件里出现了 Claude 没动过的修改（比如你只改了 A 函数，diff 里却还冒出 B 函数的变动），说明该文件可能在另一个窗口被并发编辑了——**停下来告诉用户**，让用户决定一起提交、拆分、还是先 `git restore --staged <file>` 把那块还原。

完成提交后用 `git status` 回报一下哪些文件被保留未提交，让用户对工作区状态有数。不确定某个文件是否该一起提交时，先问。

**提交信息简洁为主**：标题一行说清做了什么即可，不要堆砌具体色值、常量、函数名、行号这类实现细节——那是 diff 该说的事。body 只在需要解释"为什么"时才写，且保持一两句话。

**保持 `README.md` 为最新**：增删用户可见功能时，同步更新根目录 `README.md` 的「已实现 / 未实现」清单——已落地的从「未实现」挪到「已实现」，新加的功能补进对应位置，移除的功能直接删条目。该改动随同功能 commit 一起提交。仅内部重构、bugfix、UI 微调不触发 README 更新。


## 性能底线

GitUI 目标是"轻量、快速"，性能是硬约束。新功能或 bug 修复**不得悄悄引入可感知的性能损失**，尤其是 revwalk / diff / 状态刷新 / 文件监控这些热路径，以及虚拟滚动、防抖、缓存这些已有的规避手段不能被绕过或废掉。

如果方案本身就有明显性能代价（同步阻塞 UI、大仓库下 O(N²)、每帧重算、每节点 O(N) 开销等），**实现前先和用户核对**：说清量级、影响的场景、是否能用惰性加载 / 分页 / 缓存 / 移到后台线程规避，由用户决定是否接受。改完自己先在大仓库（几千～几万提交）下感受一遍，别等用户发现卡了才回头补。


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
git2-rs（libgit2，in-process）
```

关闭窗口不退出程序——在 `lib.rs` 的 `on_window_event` 中拦截 `CloseRequested`，调用 `window.hide()` 隐藏到系统托盘。只有托盘菜单"退出"才真正退出。

`git gc` 是当前后端**唯一**会 fork 外部 `git` 的地方（见 `commands/system.rs::run_gc`），其余所有 Git 操作都走 libgit2。

### Rust 后端

**`src-tauri/src/git/`** — Git 操作核心层
- `engine.rs`：`GitEngine` 静态方法集合，对 `git2` crate 的封装。每个方法接收 `path: &str`，内部调用 `Repository::open()` 获取 `git2::Repository` 实例（`Repository` 不是 `Send`，不能跨线程持有）
- `types.rs`：所有在 IPC 中传递的 Rust 数据结构，均实现 `serde::Serialize + Deserialize`，字段命名为 `snake_case`，自动映射到前端 TypeScript 的对应类型
- `error.rs`：`GitError` 枚举，实现 `Serialize` 和 `thiserror::Error`，可直接作为 Tauri command 的 `Err` 类型返回给前端
- `credentials.rs`：SSH agent → `~/.ssh/id_ed25519` → `~/.ssh/id_rsa` 的凭据回调链；HTTPS 通过 `Cred::default()` 使用系统 git credential helper

**`src-tauri/src/commands/`** — IPC 命令层，每个文件对应一个功能域（`repo / status / commit / log / diff / branch / remote / submodule / stash / system`）

所有 command 通过 `State<'_, RepoManager>` 获取仓库路径，再调用 `GitEngine` 方法。注册在 `lib.rs` 的 `invoke_handler!` 宏中。完整清单见 [docs/11-ipc.md](./docs/11-ipc.md)。

**`src-tauri/src/repo_manager.rs`** — 多仓库状态中心

`RepoManager` 持有 `Arc<Mutex<HashMap<repo_id, RepoCacheEntry>>>`，被 `.manage()` 注册为 Tauri 全局状态，在所有 command 中通过 `State<'_, RepoManager>` 注入。

**`src-tauri/src/watcher.rs`** — 文件系统监控

`WatcherService` 对每个打开的仓库监听 **整个工作目录**（不是仅 `.git/`，否则会漏掉 tracked 文件的编辑），通过 `notify-debouncer-mini` 做 300ms 防抖，触发后通过 `app.emit("repo://status-changed", repo_id)` 推送事件到前端。

**`src-tauri/src/tray.rs`** — 系统托盘（菜单 `显示窗口 / 退出`，左键点击显示并聚焦窗口）。

### 前端

**IPC 层**（不要直接调用 `invoke`，统一走以下封装）：
- `src/composables/useGitCommands.ts`：所有 Tauri `invoke()` 调用的类型安全封装，参数名需与 Rust command 的参数名完全一致（**camelCase**，Tauri JS 桥接自动转 snake_case）
- `src/composables/useGitEvents.ts`：监听 Tauri Events（`repo://status-changed` 等）

**数据流**：
```
工作目录变更 → WatcherService（debounce 300ms）→ emit "repo://status-changed"
  → useGitEvents.onStatusChanged
  → 仅当 repoId === activeRepoId 时：useWorkspaceStore.refresh() + useSubmodulesStore.loadSubmodules()
  → invoke("get_status") → GitEngine::get_status() → WorkspaceStatus
  → Vue 组件响应式更新
```

**Pinia Stores**（`src/stores/`）：
- `repos.ts`：仓库列表 + `activeRepoId`；调用 `open_repo` / `close_repo`；通过 `@tauri-apps/plugin-store` 的 `LazyStore` 持久化 `paths` + `activePath`
- `workspace.ts`：当前仓库的工作区状态（staged / unstaged / untracked）；监听 status-changed 事件刷新
- `history.ts`：提交历史（分页 200 条）+ 分支列表 + 当前选中 commit 详情 + graph 布局；包装所有"可能影响 HEAD"的命令（switch / checkout / cherry-pick / revert / reset / checkoutRemote），执行后并发刷新 log + branches
- `diff.ts`：当前选中文件的工作区 diff，按需加载（WIP 场景）
- `stash.ts`：stash 列表 + push/pop
- `submodules.ts`：submodule 列表 + init/update/setUrl/deinit
- `ui.ts`：UI 偏好（历史布局模式、搜索关键字、显示丢失引用/贮藏的 toggle），持久化到 localStorage

**视图路由**（`src/router/index.ts`）：Hash 模式，两个路由：
- `/` → redirect `/history`
- `/history` → `HistoryView.vue`（提交图 + 详情 + **WIP 行**，承担了"工作区"的角色）
- `/branches` → `BranchesView.vue`（分支列表视图，渲染 `BranchList.vue`）

> **工作区没有独立路由**。当工作副本有改动时，`HistoryView` 会在虚拟列表顶部插入一条 `WipRow`，点击后右侧面板从 `CommitInfoPanel` 切到 `WipPanel`（暂存 / 提交 / amend / discard）。相关组件在 `components/workspace/WipPanel.vue` 和 `components/history/WipRow.vue`。细节见 [docs/03-workspace.md](./docs/03-workspace.md)。

**Diff 渲染**：`components/diff/DiffView.vue` 是主入口，支持三种模式切换（持久化到 localStorage）：

| 模式 | 组件 |
|------|------|
| `side-by-side` | `SideBySideDiff.vue` |
| `inline` | `InlineDiff.vue`（groupByHunk=false） |
| `by-hunk` | `InlineDiff.vue`（groupByHunk=true） |

语法高亮基于 `lib/highlight.ts`（highlight.js 子集 + 扩展名映射表）。另有一个基于 CodeMirror 6 的 `DiffViewer.vue`，目前仅被 `CommitDetail.vue` 引用，而 `CommitDetail.vue` 未挂载到任何路由——当前活跃代码路径不使用 CodeMirror，但相关依赖保留。

**提交图**：`utils/graph.ts` 的 `computeGraphLayout` 基于 pvigier 变体的 lane 算法，每行产出一个 `GraphRow` 独立渲染（支持虚拟滚动），`CommitGraphRow.vue` 负责 SVG 绘制。算法细节见 [docs/05-commit-graph.md](./docs/05-commit-graph.md)。

### IPC 数据类型对应关系

Rust `snake_case` 字段 ↔ TypeScript `snake_case` 字段（Tauri 默认不做驼峰转换）。完整的命令清单和类型映射见 [docs/11-ipc.md](./docs/11-ipc.md)。

常用：

| Rust (`types.rs`) | TypeScript (`src/types/git.ts`) |
|---|---|
| `RepoMeta` | `RepoMeta` |
| `WorkspaceStatus` | `WorkspaceStatus` |
| `CommitInfo` | `CommitInfo`（含 `is_unreachable`, `is_stash`） |
| `FileDiff` | `FileDiff` |
| `BranchInfo` | `BranchInfo`（含 `ahead`, `behind`） |
| `LogPage` | `LogPage` |
| `SubmoduleInfo` / `SubmoduleState` | `SubmoduleInfo` / `SubmoduleState` |
| `StashEntry` | `StashEntry` |
| `ReflogEntry` | `ReflogEntry` |

新增 IPC command 时：
1. 在 `src-tauri/src/commands/` 对应文件中添加 `#[tauri::command]` 函数
2. 在 `lib.rs` 的 `tauri::generate_handler![]` 中注册
3. 在 `src/composables/useGitCommands.ts` 中添加对应的 `invoke<T>()` 封装（**参数对象字段用 camelCase**）
4. 如有新数据结构，同步更新 `src-tauri/src/git/types.rs` 和 `src/types/git.ts`（字段名 snake_case，枚举用 `#[serde(rename_all = "snake_case")]`）

### 历史视图关键开关

`uiStore` 维护三个持久化开关，均影响 `get_log` 的 revwalk 构造：

- `historyLayoutMode`: `'horizontal' | 'vertical'` —— 详情面板布局
- `showUnreachableCommits`: 是否把 HEAD reflog 里不可达的提交画到图里（"丢失引用"）
- `showStashCommits`: 是否把 stash 的根 commit 画到图里（默认开）

后两个 toggle 会触发 `historyStore.loadLog()` 重新拉取（`views/HistoryView.vue` 里的 `watch` 负责）。

### 样式

使用 Tailwind CSS v4（通过 `@tailwindcss/vite` 插件），全局 CSS 变量定义在 `src/assets/main.css`（`--bg-primary`、`--accent-blue`、`--accent-green`、`--accent-orange`、`--accent-red` 等），组件使用 `<style scoped>`。配色基于 Catppuccin Macchiato 风格。
