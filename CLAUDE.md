# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

GitUI 是一个跨平台 Git 桌面客户端，基于 **Tauri v2（Rust 后端）+ Vue 3 前端**构建，目标是轻量、快速、易用，方便多仓库快速切换。

按功能域的详细设计文档在 `docs/` 目录，索引见 [docs/README.md](./docs/README.md)。**改动任何一个模块前，先读对应那份文档。**

## 文档驱动开发

`docs/` 是项目的单一事实来源。改动前先读对应那份文档建立上下文。

**何时同步更新文档**：改动涉及 UI 结构、用户可见行为、模块职责或 IPC 契约时。IPC 契约变动（新增 / 修改 / 删除命令或数据结构）**必须**同步改 [docs/11-ipc.md](./docs/11-ipc.md)。纯内部重构、变量改名、小 bugfix 不触发。

**文档写契约和取舍，不贴实现**：描述目标、组件 / store / 命令的**名字**、数据流、关键决策；**不要复制函数体、结构体字段、具体常量值**——代码是单一事实来源，文档贴过去会立刻过时，还会污染下次读文档的判断。需要引用类型时，写 "见 `git/types.rs::StashEntry`" 即可。

**操作规则**：文档更新和代码改动放在同一次提交里。实现中发现原方案不合理，先回到文档改方案，再继续写代码。拿不准是否触发文档更新时，先问用户。

## 规划文档

**非平凡功能 / 重构开工前，先在 `docs/plan/` 下留一份方案文档**，再动代码。小 bugfix、UI 微调、改名等不要求。

**文件命名**：`YYYY-MM-DD-NN-name.md`（`NN` 当日序号两位、从 `01` 起；`name` kebab-case）。例：`2026-04-17-01-merge-rebase.md`。

**必须包含**：Context（为什么做、要解决什么、预期结果）、进度总览（按 PR / 阶段拆分的状态表）、子任务清单（`- [ ]` / `- [x]`）、关键决策（做什么 / 不做什么 + 取舍理由）、验证方式（如何端到端跑一遍）。

**勾选状态随实施实时更新**，状态变化随主要 commit 一起提交。实施中发现原方案不合理，先回到 plan 改方案再写代码。Plan 文档功能落地后**不要删**，长期保留作为决策档案。

## 提交规范

**单次 commit 聚焦一个主题**。用户让"提交"时，只 `git add` 本次对话实际改过的文件——即便工作区还有其他 modified 文件，也不要顺手打包，那些可能是用户自己在推进的半成品。

**提交前 `git diff --cached` 核对**：staged 内容要和你"我改了什么"对得上。如果某个文件出现了 Claude 没动过的修改（你只改了 A 函数，diff 里冒出 B 函数变动），说明该文件可能在另一个窗口被并发编辑——**停下来告诉用户**，由用户决定一起提交、拆分、还是 `git restore --staged <file>` 还原。

完成提交后用 `git status` 回报哪些文件被保留未提交。不确定某个文件是否该一起提交时，先问。

**提交信息简洁且使用中文**：标题一行说清做了什么，**必须使用中文**；不堆砌色值、常量、函数名、行号——那是 diff 的事。body 只在解释"为什么"时写一两句话。

**禁止 AI 协作署名**：不加 `Co-Authored-By: Claude`、`🤖 Generated with Claude Code` 等任何尾注。

**保持 `README.md` 为最新**：增删用户可见功能时，同步更新根目录 `README.md` 的「已实现 / 未实现」清单，随同功能 commit 提交。仅内部重构、bugfix、UI 微调不触发。

## 性能底线

GitUI 目标是"轻量、快速"，性能是硬约束。新功能或 bug 修复**不得悄悄引入可感知的性能损失**，尤其是 revwalk / diff / 状态刷新 / 文件监控这些热路径，以及虚拟滚动、防抖、缓存等已有规避手段不能被绕过或废掉。

如果方案本身就有明显性能代价（同步阻塞 UI、大仓库下 O(N²)、每帧重算等），**实现前先和用户核对**：说清量级、影响场景、能否用惰性加载 / 分页 / 缓存 / 后台线程规避，由用户决定是否接受。改完先在大仓库（几千～几万提交）下感受一遍，别等用户发现卡了才回头补。

## 常用命令

```bash
npm run tauri dev               # 开发（同时启动 Vite + Tauri）
npm run build                   # 仅构建前端（含 tsc 检查）
npx vue-tsc --noEmit            # 仅 TypeScript 类型检查
cd src-tauri && cargo check     # 仅检查 Rust（快）
cd src-tauri && cargo test      # Rust 测试
npm run tauri build             # 打包发布
```

## 架构关键点

整体结构：Vue 3 前端 ↔ Tauri IPC（`invoke` + Events）↔ Rust 后端 ↔ git2-rs（libgit2，in-process）。

### 目录索引（细节读对应文件）

- `src-tauri/src/git/`：git2 封装层。`engine.rs` 是核心 API，`types.rs` 是 IPC 数据结构，`error.rs` 是错误类型，`credentials.rs` 是凭据回调链
- `src-tauri/src/commands/`：IPC 命令层，按功能域分文件（`repo / status / commit / log / diff / branch / remote / submodule / stash / system`），在 `lib.rs::generate_handler!` 注册
- `src-tauri/src/repo_manager.rs`：多仓库状态中心（`RepoManager`，Tauri 全局 state）
- `src-tauri/src/watcher.rs`：文件系统监控（`notify-debouncer-mini`，300ms 防抖）
- `src/composables/useGitCommands.ts`：所有 `invoke()` 的类型安全封装，新增命令必经此处
- `src/composables/useGitEvents.ts`：Tauri Events 监听
- `src/stores/`：Pinia stores，按域分文件
- `src/components/diff/DiffView.vue`：diff 主入口（side-by-side / inline / by-hunk 三模式，持久化到 localStorage）
- `src/utils/graph.ts`：提交图 lane 算法（pvigier 变体），细节见 [docs/05-commit-graph.md](./docs/05-commit-graph.md)

### 几条反直觉的决策（AI 容易猜错）

1. **关闭窗口不退出**：`lib.rs::on_window_event` 拦截 `CloseRequested` → `window.hide()` 隐到托盘。只有托盘"退出"才真正退出
2. **`git gc` 是唯一 fork 外部 `git` 的地方**（`commands/system.rs::run_gc`），其余全走 libgit2
3. **Watcher 监听整个工作目录**（不是只 `.git/`），否则会漏掉 tracked 文件的编辑
4. **`git2::Repository` 不是 `Send`**：每个 command 内部 `Repository::open()`，不能跨线程持有
5. **工作区没有独立路由**：`HistoryView` 顶部插一条 `WipRow`，点击后右侧切到 `WipPanel`（详见 [docs/03-workspace.md](./docs/03-workspace.md)）

### 数据流

```
工作目录变更 → Watcher（debounce 300ms）→ emit "repo://status-changed"
  → useGitEvents.onStatusChanged
  → 仅当 repoId === activeRepoId 时：workspaceStore.refresh() + submodulesStore.loadSubmodules()
  → invoke("get_status") → GitEngine::get_status() → WorkspaceStatus
  → Vue 组件响应式更新
```

### IPC 命名规则（容易踩坑）

- **数据结构字段**：Rust `snake_case` ↔ TypeScript `snake_case`（Tauri 默认不做驼峰转换）
- **`invoke()` 调用参数对象的 key**：用 **`camelCase`**（Tauri JS 桥接会自动转 snake_case 给 Rust 端）
- 完整命令清单和类型映射见 [docs/11-ipc.md](./docs/11-ipc.md)

### 新增 IPC command 流程

1. `commands/` 对应文件加 `#[tauri::command]` 函数
2. `lib.rs::generate_handler!` 注册
3. `useGitCommands.ts` 加 `invoke<T>()` 封装（参数对象用 camelCase）
4. 新数据结构同步 `git/types.rs` + `src/types/git.ts`（字段 snake_case，枚举 `#[serde(rename_all = "snake_case")]`）

### 样式

Tailwind CSS v4（`@tailwindcss/vite` 插件），全局 CSS 变量在 `src/assets/main.css`，组件用 `<style scoped>`，配色 Catppuccin Macchiato。
