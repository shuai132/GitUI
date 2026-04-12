# GitUI

跨平台 Git 桌面客户端，基于 **Tauri v2（Rust）+ Vue 3** 构建。目标是轻量、快速、易用，方便多仓库快速切换。

## 功能

### 提交与工作副本
- 工作副本有改动时直接嵌在历史视图顶部（WIP 行），不占独立路由
- 暂存区 / 未暂存 / 未追踪三类分区，单文件或一键全部暂存 / 取消
- 摘要 + 详细描述两行提交框，Cmd/Ctrl+Enter 提交
- Amend（修补上次提交）、Discard（单文件或全部）

### 提交历史（History）
- 分页加载（每页 200 条），提交图可视化
- 查看提交详情：作者、时间、变更文件、Diff
- 右键菜单：Checkout、Cherry-pick、Revert、Reset（soft / mixed / hard）、创建 Tag / 分支

### 分支管理（Branches）
- 本地 / 远程分支树形列表
- 创建、切换、删除分支
- 检出远程分支并建立追踪

### 远程操作
- Fetch、Push、Pull（当前仅支持 fast-forward pull）
- SSH 凭据链：ssh-agent → `~/.ssh/id_ed25519` → `~/.ssh/id_rsa`；HTTPS 走系统 credential helper

### Submodule
- 列表、Initialize、Update、Edit URL、Deinit（完整清理 .gitmodules / .git/config / .git/modules）
- 已克隆的 submodule 可直接作为新仓库打开

### Diff 查看器
- 三种模式：行内（InlineDiff）、并排（SideBySideDiff）、按 hunk 分块
- 按文件扩展名自动识别语言的语法高亮（15 种左右）
- 高亮开关、跳转变更块工具栏
- Untracked 文件也能看到完整的行级 diff

### 多仓库管理
- 侧边栏快速切换仓库，路径持久化跨启动恢复
- 仓库列表可拖动排序、可调整面板高度
- 工作目录文件监控，自动刷新工作区状态（300ms 防抖）

### 其他
- 关闭窗口隐藏到系统托盘，不退出进程
- macOS overlay 标题栏（无缝一体化外观）

## 技术栈

| 层 | 技术 |
|----|------|
| 桌面框架 | Tauri v2（Rust） |
| Git 操作 | git2-rs（libgit2，in-process） |
| 文件监控 | notify-debouncer-mini |
| 前端框架 | Vue 3 + Vite + TypeScript |
| 状态管理 | Pinia |
| 路由 | Vue Router（Hash 模式） |
| 样式 | Tailwind CSS v4 |
| Diff 渲染 | 自绘 inline / side-by-side + Highlight.js |
| 虚拟滚动 | TanStack Vue Virtual |

## 开发

```bash
# 安装依赖
pnpm install

# 开发（同时启动 Vite dev server 和 Tauri 进程）
pnpm tauri dev

# 仅 TypeScript 类型检查
pnpm exec vue-tsc --noEmit

# 仅检查 Rust 代码（速度快）
cd src-tauri && cargo check

# 打包发布
pnpm tauri build
```

## 架构

```
前端（Vue 3 / WebView）
    ↕ IPC: invoke() + Tauri Events
Rust 后端（Tauri v2）
    ↕
git2-rs（libgit2，in-process）
```

**Rust 后端模块**

| 模块 | 职责 |
|------|------|
| `git/engine.rs` | Git 操作封装，每个方法接收 `path: &str` |
| `git/types.rs` | IPC 数据结构（Serialize + Deserialize） |
| `git/credentials.rs` | SSH 凭据回调链 |
| `commands/` | IPC command 层，按功能域拆分 |
| `repo_manager.rs` | 多仓库状态中心 |
| `watcher.rs` | 工作目录监控，推送 `repo://status-changed` 事件 |

## 语法高亮支持的语言

- JavaScript / TypeScript / JSX / TSX
- Python
- Rust
- Go
- Java
- C / C++
- JSON
- CSS / HTML / XML
- Markdown
- SQL
- YAML
- Shell / Bash

## 设计文档

想看实现细节或参与开发，见 [`docs/`](./docs/README.md) 下按功能域组织的设计文档。
