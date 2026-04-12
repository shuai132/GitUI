# GitUI

跨平台 Git 桌面客户端，基于 **Tauri v2（Rust）+ Vue 3** 构建。目标是轻量级、高性能、跨平台。

## 功能

### 已实现

- [x] 多仓库管理：侧边栏快速切换、路径持久化、关闭窗口隐藏到系统托盘
- [x] 工作副本：暂存 / 取消暂存、提交、amend、discard（单文件或全部）
- [x] 提交历史：分页加载、提交图可视化、丢失引用 / 贮藏可视化、本地搜索
- [x] 提交操作：checkout、cherry-pick、revert、reset（soft / mixed / hard）、创建 tag
- [x] 分支管理：本地 / 远程树形、创建 / 切换 / 删除、检出远程分支并建立追踪
- [x] 远程操作：fetch、push、pull（目前仅支持 fast-forward）
- [x] SSH 凭据链：ssh-agent → `~/.ssh/id_ed25519` → `~/.ssh/id_rsa`，HTTPS 走系统 credential helper
- [x] Submodule：init / update / edit URL / deinit，已克隆的可作为新仓库打开
- [x] Diff 查看器：inline / side-by-side / by-hunk 三种模式，内置多语言语法高亮
- [x] Stash：push / pop（含 untracked 文件）
- [x] Reflog 查看、git gc 触发入口
- [x] 工作目录文件监控，状态自动刷新

### 未实现（计划中）

- [ ] Merge / Rebase（含 interactive rebase）
- [ ] 合并冲突解决 UI
- [ ] 非 fast-forward pull（rebase / merge pull）
- [ ] Tag 管理视图（列出、删除、推送到远程）
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
