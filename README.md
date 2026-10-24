[![Build](https://github.com/shuai132/GitUI/actions/workflows/build.yml/badge.svg?branch=release)](https://github.com/shuai132/GitUI/actions/workflows/build.yml)

<p align="center">
  <img src="./assets/icon.png" width="96" alt="GitUI 图标" />
</p>

<h1 align="center">GitUI</h1>

<p align="center">
  轻量、直观的跨平台 Git 桌面客户端。<br />
  在清晰的可视化界面中，管理仓库、审阅变更、整理提交。
</p>

<p align="center">
  <a href="https://github.com/shuai132/GitUI/releases">下载</a> ·
  <a href="#功能">功能</a> ·
  <a href="#安装">安装</a> ·
  <a href="https://github.com/shuai132/GitUI/issues">反馈问题</a>
</p>

GitUI 将仓库管理、提交历史与差异审阅整合在同一个工作界面中。无论是日常提交、分支协作，还是交互式 Rebase 与冲突处理，都能围绕当前仓库和变更连续完成。支持 macOS、Windows 与 Linux。

<p align="center">
  <a href="./assets/gitui-main-window-light.png#gh-light-mode-only">
    <img src="./assets/gitui-main-window-light.png#gh-light-mode-only" width="960" alt="GitUI 浅色主题主界面：仓库与分支侧栏、提交历史图及代码差异审阅" />
  </a>
  <a href="./assets/gitui-main-window-dark.png#gh-dark-mode-only">
    <img src="./assets/gitui-main-window-dark.png#gh-dark-mode-only" width="960" alt="GitUI 深色主题主界面：仓库与分支侧栏、提交历史图及代码差异审阅" />
  </a>
</p>

## 功能

### 高效管理多个项目

集中管理仓库、子模块与 Worktree，通过搜索和快捷键快速切换，也可在独立窗口中并行处理多个项目。提交草稿按仓库自动保存，切换后即可继续编辑。

### 可视化浏览与整理历史

通过提交图查看分支、标签与 Stash，按提交信息、作者或 SHA 搜索历史，结合文件历史与 Blame 追溯修改。支持 Cherry-pick、Revert、Reset 和交互式 Rebase，便于整理提交与维护分支。

### 精细审阅与组织变更

提供行内和左右对比、语法与字符级高亮，支持展开上下文、跳转变更，并按文件、目录或变更块暂存。图片、Markdown、Mermaid 与文档预览，让代码和文档的修改都清晰可读。

### 完成分支协作与冲突处理

在界面中完成 Fetch、Pull、Push 与远程分支管理，支持多种 Merge 与 Rebase 操作。通过三路合并视图逐行处理冲突，整合分支时可自动暂存并恢复工作区改动。

### 适配你的工作习惯

支持中文与英文界面、深浅主题、自定义字体与配色，以及可调整的面板布局。兼容 UTF-8 / GBK 编码，内置多标签终端，并可通过本地插件扩展常用操作。

## 安装

从 [GitHub Releases](https://github.com/shuai132/GitUI/releases) 下载对应平台的安装包。

| 平台 | 安装包架构 |
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

在「设置 → 更新」中选择「检查开发版」，即可体验最新改进。支持可选的启动时自动检查，更新安装需手动确认，并验证签名。

也可从 [Actions](https://github.com/shuai132/GitUI/actions/workflows/build.yml) 的成功运行中下载开发包，保留 7 天。日常使用建议选择正式版。

## 功能详情

<details>
<summary>查看完整功能</summary>

| 功能 | 支持能力 |
| --- | --- |
| 仓库管理 | 打开、新建、拖入与克隆仓库；浅克隆与递归子模块；搜索、排序、快捷切换与多窗口；创建 Worktree；重新定位缺失仓库 |
| 工作区与提交 | 文件树；按文件、目录或变更块暂存与取消暂存；提交与 Amend；修改作者和提交者日期；自动保存提交草稿；撤销最近未推送提交 |
| 历史浏览 | 可视化提交图；按提交信息、作者或 SHA 搜索历史；分支过滤；first-parent 视图；变更统计；重命名识别；文件历史与 Blame |
| 历史整理 | Checkout、Cherry-pick、Revert、Reset；修改提交信息与时间；恢复文件历史版本 |
| 分支与标签 | 本地与远程分支管理；建立追踪关系；带改动切换分支；标签创建、删除与远程同步 |
| 合并与 Rebase | 快进、非快进与 Squash 合并；交互式 Rebase，支持 Reword、Squash、Fixup、Drop 与重排；三路冲突解决；自动 Stash 与恢复 |
| 远程操作 | Fetch、Push、Pull；发布分支与设置 upstream；远端偏好；SSH agent、SSH 密钥与系统 HTTPS 凭据助手 |
| 差异审阅 | 行内与左右对比；完整文件与变更块视图；按需展开上下文；语法与字符级高亮；变更跳转；反向应用提交中的变更块 |
| 内容预览 | 图片与 SVG；Markdown 渲染与差异对比；Mermaid 图表；仓库内图片及文本链接；PDF 预览与文本差异；DOCX / PPTX 抽取文本预览与差异 |
| Stash 与恢复 | 创建、应用、弹出与删除 Stash；包含未跟踪文件；图中查看 Stash；查看 Reflog 与丢失引用提交；丢弃工作区文件时移入系统废纸篓 |
| 子模块 | 初始化、更新、修改 URL 与反初始化；侧栏导航；作为独立仓库打开 |
| 工具与扩展 | 内置多标签终端；外部终端与编辑器；本地可信插件；调试日志；手动 Git GC |
| 界面与偏好 | 中文与英文；深浅主题；字体、字号、强调色与差异高亮配色；阅读区缩放；面板布局调整；自动刷新；正式版与开发版更新 |

</details>

## 问题反馈

欢迎通过 [Issues](https://github.com/shuai132/GitUI/issues) 反馈问题或提出建议。请附上操作系统、GitUI 版本和复现步骤；提供截图或日志前，请先移除敏感信息。
