# 17. 插件系统

插件系统用于把团队工作流、本地脚本和外部服务接入 GitUI，同时保持核心应用轻量、稳定。

## 设计目标

- **本地可信**：第一版只支持本机目录插件，由用户显式安装、启用或禁用。
- **能力受控**：插件不能直接访问 GitUI 内部 Vue/Pinia/Rust 状态，只能通过插件 Host API 进入稳定边界。
- **轻量可调试**：插件 manifest 是声明式 JSON，本地后端任务通过 JSON-RPC 进程通信，便于任意语言实现。
- **渐进扩展**：第一版先支持命令和菜单；面板、设置页与更深 UI 插槽后续在同一 manifest 模型上扩展。

## 插件目录与 Manifest

插件安装在应用数据目录的 `plugins/<plugin_id>/` 下。每个插件目录必须包含 `plugin.json`。安装器先把源目录复制到插件扫描范围之外的事务目录，并重新验证 manifest 与插件 ID；覆盖同 ID 插件时通过同卷目录切换保留旧版本，只有新版本就位后才把旧副本移入系统废纸篓。复制、切换或回收失败会清理新副本并恢复旧版本，不把半安装目录暴露给插件扫描。

`plugin.json` 描述插件身份、API 版本、入口资源、后端进程、权限和贡献点。字段命名使用 `snake_case`，与 IPC 数据结构保持一致。

核心字段：

- `api_version`：插件 API 版本，第一版为 `1`。
- `id` / `name` / `version`：插件唯一标识、显示名和版本。
- `description`：可选说明。
- `entry`：可选前端入口资源，供后续 iframe 面板使用。
- `backend`：可选后端进程定义，见 `plugin.rs::PluginBackend`。
- `permissions`：声明所需能力，例如 `git:read`、`git:write`、`process:run`。
- `contributes`：声明命令、菜单、面板和设置页贡献点。

## 贡献点

第一版实际接入：

- `commands`：插件可贡献可执行命令。
- `menus`：插件可把命令挂到 `toolbar.actions`，显示在工具栏 Actions 菜单。
- `menus`：插件也可把命令挂到 `commit.context`，显示在提交右键菜单的「插件」子菜单；执行时 `selection` 会包含当前提交信息。

第一版建模但暂不渲染：

- `panels`：侧栏、详情页或独立面板入口。
- `settings`：插件自己的设置页面入口。

## 后端执行模型

带 `backend` 的插件命令由 Rust Plugin Host 启动本地进程执行。GitUI 通过 stdin 发送 JSON-RPC 请求，插件通过 stdout 返回结果。

插件后端属于非交互后台进程。Windows 下 Host 使用无控制台启动配置，插件若需要展示界面，应由自身显式创建 GUI，而不能依赖控制台窗口。

`backend.command` 可以是绝对路径，也可以是 `PATH` 中的命令名。打包后的 GUI 应用不一定继承终端 PATH；Host 在命令找不到时会先检查常见 Node 版本管理器目录，再尝试通过用户 shell 解析一次，并缓存解析到的绝对路径。插件作者在依赖 `node`、`python` 等运行时时仍应优先写绝对路径或确保运行时安装在系统 PATH。

请求方法为 `execute_command`，参数包含命令 ID 与当前上下文。上下文可包含当前仓库 ID、仓库路径与调用方提供的选择信息。

命令结果见 `plugin.rs::PluginCommandResult`，可携带：

- `message`：执行完成后展示给用户的提示。
- `refresh`：插件希望 GitUI 刷新的域，例如 `workspace`、`history`、`branches`。

## 前端集成

前端通过 `plugins` store 维护插件列表与启用状态。设置页提供安装、刷新、启用、禁用和卸载入口，并区分首次安装与覆盖更新成功反馈。禁用只改变启用状态；卸载确认会展示插件名称、版本、ID 与安装路径，确认期间目标被替换时取消旧请求。卸载只把应用数据目录中的安装副本移入系统废纸篓，用户最初选择的源目录不受影响。工具栏 Actions 菜单读取启用插件的 `toolbar.actions` 菜单贡献并执行对应命令。

## 示例插件

示例插件位于 `plugin/examples/commit-status-toast/`。该插件演示提交右键菜单插件：命令挂到 `commit.context`，后端读取当前仓库路径和提交 selection，执行 `git status --short --branch`，并把摘要作为 `PluginCommandResult.message` 返回，由 GitUI 通过 toast 展示。

## 关键取舍

1. **不直接加载插件到主应用上下文**：避免插件破坏核心 UI、状态和性能边界。
2. **第一版不做市场和签名**：先解决本地工作流扩展，降低发布和安全体系复杂度。
3. **刷新由插件声明**：插件执行后只刷新必要域，避免大仓库中产生可感知性能回退。
