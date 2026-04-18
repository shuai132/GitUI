# GitUI

[![Build](https://github.com/shuai132/GitUI/actions/workflows/build.yml/badge.svg)](https://github.com/shuai132/GitUI/actions/workflows/build.yml)

跨平台 Git 桌面客户端，基于 **Tauri v2（Rust）+ Vue 3** 构建。目标是轻量级、高性能、跨平台。

## 亮点

- **内存与 CPU 占用极低，包体积小**：基于 Tauri + libgit2 的 in-process 调用，没有 Electron 的 Chromium 实例和 Node 进程，也不 fork 外部 `git` 子进程（仅 `git gc` 例外）
- **混合编码自适应**：Windows 老仓库常见的 commit message 与源码编码不一致（UTF-8 / GBK 等），按 commit `encoding` header 与 `.gitattributes` 的 `working-tree-encoding` 各自独立解码——SourceTree / Fork 这类 GUI 的长期乱码痛点在 GitUI 里不会出现
- **拖拽式 Merge / Rebase**：在提交图上直接拖动 commit 触发 merge / rebase，冲突走内置三路合并编辑器，不必切到命令行
- **多仓库托盘常驻**：关闭窗口隐藏到系统托盘、侧边栏一键切换，跨项目高频跳转的开发场景比单窗口工具更顺手
- **找回误删 commit**：HEAD reflog 中不可达的提交仍然画在提交图里、标记 reflog tip，配合右键「剥链移除」可以精确清理而非粗暴 `git gc`
- **Stash 视为 commit**：每条 stash 在提交图里作为独立 1-parent commit 渲染，与 HEAD 的位置关系一眼可见，而不是埋在一个单独的列表里
- **WIP 行内嵌在提交图顶部**：工作区不占独立 tab，未提交变更直接出现在历史第一行，点开右侧切到暂存 / 提交 / amend / discard 面板，减少视图来回切换
- **大仓库流畅**：提交图基于 pvigier 变体 lane 算法 + 虚拟滚动，几万 commit 仓库下滚动不卡；diff 视图同样虚拟滚动
- **内置终端 + 文件监控自动刷新**：xterm.js + PTY 应用内跑任意 git / shell 命令，工作目录变更通过 notify 事件 300ms 防抖刷新到 UI，不用手动 refresh

## 功能

### 已实现

- [x] 多仓库管理：侧边栏快速切换、路径持久化、关闭窗口隐藏到系统托盘、仓库右键菜单（新窗口 / Finder / 终端）
- [x] 添加仓库：打开本地 / 克隆远程（含浅克隆、递归子模块、实时进度）/ 新建本地仓库
- [x] 工作副本：暂存 / 取消暂存、提交、amend、discard（单文件或全部）；文件右键菜单（复制路径、在 Finder/编辑器/终端中打开、添加到 .gitignore）
- [x] 提交历史：分页加载、提交图可视化、丢失引用 / 贮藏可视化、本地搜索、提交行 tag 胶囊；变动文件右键菜单（复制路径、在 Finder/编辑器中打开、签出该文件历史版本）
- [x] 提交操作：checkout、cherry-pick、revert、reset（soft / mixed / hard）、创建 tag、修改提交信息（HEAD 走 amend，历史提交走 rebase reword）
- [x] Merge / Rebase：完整 merge（ff / no-ff / squash）、交互式 rebase（reword / squash / fixup / drop / reorder）；右键菜单或拖拽 commit 触发；冲突时用内置三路合并编辑器解决；可选"自动 stash & 恢复"
- [x] 分支管理：本地 / 远程树形、创建 / 切换 / 删除、检出远程分支并建立追踪
- [x] Tag 管理：侧边栏 TAGS 列表、创建、删除
- [x] 远程操作：fetch、push、pull（fast-forward / ff-only / rebase 三模式）、tag 推送
- [x] SSH 凭据链：ssh-agent → `~/.ssh/id_ed25519` → `~/.ssh/id_rsa`，HTTPS 走系统 credential helper
- [x] Submodule：init / update / edit URL / deinit，已克隆的可作为新仓库打开
- [x] Diff 查看器：inline / side-by-side / by-hunk 三种模式、多语言语法高亮、图片 / SVG 预览
- [x] 字符编码自适应：commit message 按 git `encoding` header 解码、文件内容按 `.gitattributes` 的 `working-tree-encoding` 或 chardetng 自动检测，混合 UTF-8 / GBK 仓库正常显示
- [x] Stash：push / pop / apply / delete（含 untracked 文件），用提交信息作 stash message
- [x] Reflog 查看、git gc 触发入口；右键丢失引用提交可从 HEAD reflog 中剥链移除
- [x] 工作目录文件监控，状态自动刷新
- [x] 内置终端：应用内（xterm.js + PTY）/ 调用外部终端
- [x] 调试日志面板：命令历史 + Rust 后端日志
- [x] 设置面板：界面语言（跟随系统 / 中文 / English）、主题（跟随系统 / 浅色 / 深色）、UI / 代码字体字号、强调色覆盖、行分隔线强度/样式、提交图分叉样式、外部终端、视图开关
- [x] 灵活布局：历史面板可拖拽停靠到任意方向、侧边栏可拖到最左隐藏、提交表单高度可拖
- [x] 文件历史 / Blame：右键提交详情或工作区文件 → 查看该文件的提交历史及每行 blame 注解

### 未实现（计划中）

- （当前无）

## 安装

macOS 上因应用未签名，首次打开可能被系统拦截，需执行：

```bash
sudo xattr -dr com.apple.quarantine /Applications/GitUI.app
```

## 开发

```bash
# 安装依赖
npm install

# 开发（同时启动 Vite dev server 和 Tauri 进程）
npm run tauri dev

# 仅做 TypeScript 类型检查
npx vue-tsc --noEmit

# 仅检查 Rust 代码（速度快）
cd src-tauri && cargo check

# 打包发布
npm run tauri build
```

## 架构

```
前端（Vue 3 / WebView）
    ↕ IPC: invoke() + Tauri Events
Rust 后端（Tauri v2）
    ↕
git2-rs（libgit2，in-process）
```

## 技术栈

Tauri v2 · git2-rs（libgit2）· Vue 3 + Vite + TypeScript · Pinia · Vue Router · Tailwind CSS v4 · highlight.js · TanStack Vue Virtual

## 设计文档

想看实现细节或参与开发，见 [`docs/`](./docs/README.md) 下按功能域组织的设计文档。
