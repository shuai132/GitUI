# GitUI

[![Build](https://github.com/shuai132/GitUI/actions/workflows/build.yml/badge.svg)](https://github.com/shuai132/GitUI/actions/workflows/build.yml)

跨平台 Git 桌面客户端，基于 **Tauri v2（Rust）+ Vue 3** 构建。目标是轻量级、高性能、跨平台。

## 功能

### 已实现

- [x] 多仓库管理：侧边栏快速切换、路径持久化、关闭窗口隐藏到系统托盘、仓库右键菜单（新窗口 / Finder / 终端）
- [x] 工作副本：暂存 / 取消暂存、提交、amend、discard（单文件或全部）
- [x] 提交历史：分页加载、提交图可视化、丢失引用 / 贮藏可视化、本地搜索、提交行 tag 胶囊
- [x] 提交操作：checkout、cherry-pick、revert、reset（soft / mixed / hard）、创建 tag
- [x] 分支管理：本地 / 远程树形、创建 / 切换 / 删除、检出远程分支并建立追踪
- [x] Tag 管理：侧边栏 TAGS 列表、创建、删除
- [x] 远程操作：fetch、push、pull（fast-forward / ff-only / rebase 三模式）
- [x] SSH 凭据链：ssh-agent → `~/.ssh/id_ed25519` → `~/.ssh/id_rsa`，HTTPS 走系统 credential helper
- [x] Submodule：init / update / edit URL / deinit，已克隆的可作为新仓库打开
- [x] Diff 查看器：inline / side-by-side / by-hunk 三种模式、多语言语法高亮、图片 / SVG 预览
- [x] Stash：push / pop（含 untracked 文件），用提交信息作 stash message
- [x] Reflog 查看、git gc 触发入口
- [x] 工作目录文件监控，状态自动刷新
- [x] 内置终端：应用内（xterm.js + PTY）/ 调用外部终端
- [x] 调试日志面板：命令历史 + Rust 后端日志
- [x] 设置面板：主题（跟随系统 / 浅色 / 深色）、UI / 代码字体字号、强调色覆盖、外部终端、视图开关
- [x] 灵活布局：历史面板可拖拽停靠到任意方向、侧边栏可拖到最左隐藏、提交表单高度可拖

### 未实现（计划中）

- [ ] 显式 Merge / Rebase 操作（含 interactive rebase）
- [ ] 合并冲突解决 UI
- [ ] 推送 tag 到远程
- [ ] 文件历史 / Blame
- [ ] 提交全文搜索（按作者 / message）
- [ ] GPG 签名提交

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
