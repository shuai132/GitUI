[![Build](https://github.com/shuai132/GitUI/actions/workflows/build.yml/badge.svg)](https://github.com/shuai132/GitUI/actions/workflows/build.yml)

<p align="center">
  <img src="./src-tauri/icons/128x128@2x.png" width="96" alt="GitUI 图标" />
</p>

<h1 align="center">GitUI</h1>

<p align="center">
  轻量的跨平台 Git 桌面客户端。<br />
  多仓库管理、可视化历史与精细变更审阅，一个界面完成。
</p>

<p align="center">
  <a href="https://github.com/shuai132/GitUI/releases">下载</a> ·
  <a href="#功能">功能</a> ·
  <a href="#本地开发">本地开发</a> ·
  <a href="./docs/README.md">设计文档</a> ·
  <a href="https://github.com/shuai132/GitUI/issues">反馈问题</a>
</p>

在多个仓库间快速切换，沿提交图梳理历史，逐块审阅和暂存改动。从日常提交到交互式 Rebase，让每一步操作都有清晰的上下文。

<p align="center">
  <a href="./docs/assets/gitui-main-window-light.png#gh-light-mode-only">
    <img src="./docs/assets/gitui-main-window-light.png#gh-light-mode-only" width="960" alt="GitUI 浅色主题主界面：仓库与分支侧栏、提交历史图及代码差异审阅" />
  </a>
  <a href="./docs/assets/gitui-main-window-dark.png#gh-dark-mode-only">
    <img src="./docs/assets/gitui-main-window-dark.png#gh-dark-mode-only" width="960" alt="GitUI 深色主题主界面：仓库与分支侧栏、提交历史图及代码差异审阅" />
  </a>
</p>

## 功能

### 多个仓库，一个工作界面

仓库、子模块与 Worktree 集中管理，支持搜索、键盘切换和独立窗口。提交草稿按仓库自动保存，切换项目后继续手头的工作。

### 从提交图追到每一行改动

分支、标签与 Stash 在图中呈现，配合完整历史搜索、文件历史和 Blame，追溯改动的来龙去脉。直接从提交图发起 Merge / Rebase，用交互式计划整理提交，用三路合并视图处理冲突。

### 按变更块暂存，让提交更清晰

行内与左右 Diff、字符级高亮和完整文件上下文，帮助你看准变化，再按文件、目录或 Hunk 组织提交。Markdown 与 Mermaid 渲染、图片和文档预览，让代码之外的改动也便于审阅。

### 混合编码仓库，也能顺畅阅读

支持 UTF-8 / GBK 编码识别，兼顾历史仓库与中文内容。中英文界面、深浅主题和可调整布局适配个人习惯，内置终端与本地插件方便接续自己的工具链。

## 安装

从 [GitHub Releases](https://github.com/shuai132/GitUI/releases) 下载对应平台的安装包。

| 平台 | 当前 CI 构建架构 |
| --- | --- |
| macOS | Apple Silicon（arm64） |
| Windows | x86_64 |
| Linux | x86_64 |

### macOS 首次打开

当前 macOS 安装包未进行 Apple 签名与公证，首次打开可能被系统拦截。确认安装包来源可信，并将应用移入「应用程序」目录后，可移除该应用的隔离属性：

```bash
xattr -dr com.apple.quarantine /Applications/GitUI.app
```

若提示权限不足，再以 `sudo` 执行同一命令。

### 开发版

想体验尚未发布的改进，可在「设置 → 更新」中选择「检查开发版」，安装 `main` 分支最新成功构建。也可开启启动时自动检查，默认关闭；自动检查只提示可用更新，安装仍需手动确认，并验证更新签名。

手动测试包可从 [Build Actions](https://github.com/shuai132/GitUI/actions/workflows/build.yml) 的成功运行中下载，构建产物保留 7 天。开发版可能包含尚未充分验证的变化。

## 功能详情

<details open>
<summary>完整功能表（已实现，可折叠）</summary>

| 工作流 | 能力 |
| --- | --- |
| 仓库管理 | 打开、新建、拖入与克隆仓库；浅克隆与递归子模块；仓库搜索、键盘切换、多窗口；创建 linked Worktree；缺失仓库重新定位 |
| 工作区与提交 | 文件树；文件 / 目录 / Hunk 级暂存与取消暂存；提交、Amend、按仓库保存草稿；撤销尚未推送的最近提交；文件双击在编辑器打开 |
| 历史浏览 | 分页提交图；按消息 / 作者 / SHA 搜索完整历史；分支过滤与 first-parent Solo；变更规模统计；重命名识别；文件历史与 Blame |
| 历史整理 | Checkout、Cherry-pick、Revert、Reset；修改提交信息与时间；签出文件历史版本；创建与管理标签 |
| 分支与标签 | 本地 / 远程分支树；创建、切换与删除分支；检出远程分支并建立追踪；带改动切换或 Stash 后切换；标签创建、删除与远程同步 |
| 分支整合 | Merge（快进 / 非快进 / Squash）；交互式 Rebase（Reword / Squash / Fixup / Drop / 重排）；提交拖拽入口；按行选择的三路冲突解决；可选自动 Stash 与恢复 |
| 远程协作 | Fetch、Push、发布新分支并建立 upstream；Pull（fast-forward / ff-only / rebase）；默认远端偏好；标签同步；SSH agent、常用 SSH 密钥与系统 HTTPS credential helper |
| 差异审阅 | 行内 / 左右对比；完整文件 / Hunk 分组；语法与字符级高亮；忽略空白；变更跳转；提交 Hunk 反向应用 |
| 内容预览 | 图片与 SVG；Markdown 源码 / 修改后预览 / 渲染对照，支持 Mermaid；PDF 预览与文本差异；DOCX / PPTX 抽取文本预览与差异 |
| Stash 与恢复 | Stash 创建 / 应用 / 弹出 / 删除，支持未跟踪文件；Stash 图中展示；Reflog 与丢失引用提交查看；文件级、批量及全部丢弃通过系统废纸篓保留恢复机会 |
| 子模块 | 初始化、更新、修改 URL、反初始化；侧边栏子树与工作区导航；作为独立仓库打开 |
| 工具与扩展 | 内置多标签终端、外部终端与编辑器；本地可信插件扩展 Actions 和提交右键菜单；调试日志；手动触发 Git GC |
| 界面与偏好 | 中文 / English；跟随系统或手动选择深浅主题；字体、字号与强调色；可调整面板布局；状态自动刷新；正式版与可选开发版更新 |

</details>

### 当前边界

以下能力仍有使用边界，后续改进与问题跟踪见 [Issues](https://github.com/shuai132/GitUI/issues)。

- **文档预览**：DOCX / PPTX 以抽取文本展示，不还原 Office 原始排版；Markdown 预览暂不解析仓库相对图片与文件链接。
- **提交恢复**：丢失引用提交的可见性取决于对象是否仍保留在仓库中；已被 Git GC 清理的对象无法通过提交图恢复。
- **插件**：当前面向本地可信插件，插件命令会在本机执行。开发方式与示例见 [插件文档](./plugin/README.md)。

## 本地开发

准备 Node.js LTS、Rust stable，以及 Tauri v2 对应平台的系统构建依赖。Linux 的依赖安装项可参考 [构建工作流](./.github/workflows/build.yml)。

```bash
git clone https://github.com/shuai132/GitUI.git
cd GitUI
npm ci
npm run tauri dev
```

常用检查与构建命令：

```bash
# 前端类型检查与单元测试
npx vue-tsc --noEmit
npm run test

# Rust 编译检查与单元测试（在项目根目录执行）
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml

# 构建前端 / 打包桌面应用
npm run build
npm run tauri build
```

应用基于 Tauri v2，使用系统 WebView，通过 Rust 与 libgit2 在进程内完成主要 Git 操作。历史分页、虚拟滚动与按需加载用于控制大仓库下的渲染与读取开销。

主要技术栈：Tauri v2 · Rust / git2-rs（libgit2）· Vue 3 / TypeScript / Vite · Pinia · Tailwind CSS v4 · TanStack Vue Virtual · xterm.js。

## 参与项目

欢迎提交问题、交互建议和 Pull Request。报告问题时，请附上系统与应用版本、复现步骤及相关日志；涉及仓库内容时，请先移除敏感信息。

参与开发前，建议先阅读 [设计文档索引](./docs/README.md) 和对应功能域的说明。设计文档记录模块职责、数据流与关键取舍，具体实现以代码为准。功能与行为变更请同步更新相关文档，并完成前后端类型、编译和单元测试检查。
