# 11. IPC 契约

GitUI 采用 Tauri v2 的 IPC 机制实现前后端通信，包括双向的请求-响应模式与单向的事件推送模式。

## 契约规范

- **通信协议**：前端通过 `invoke` 调用后端注册的命令，后端通过 `emit` 推送异步事件。
- **命名规范**：命令名与返回结构体字段保持 `snake_case`；`invoke` 的参数对象字段在前端使用 `camelCase`（由桥接层自动处理）。
- **类型一致性**：所有通过 IPC 传输的数据结构必须在 Rust (`src-tauri/src/git/types.rs`) 与 TypeScript (`src/types/git.ts`) 中同步定义。
- **异常处理**：后端统一抛出 `GitError`。前端在封装层拦截异常，将其推入错误历史，并映射为用户友好的提示。

## 命令清单 (Commands)

### 仓库管理 (Repo)
- `open_repo` / `list_repos`：仓库名册的基础维护。
- `set_active_repo(repo_id, generation)`：同步当前激活仓库到后端，使 watcher、auto-fetch 与托盘 registry 只跟随该仓库；后端只接受不小于当前值的 `generation`，忽略旧请求。
- `close_repo(repo_id, next_active_repo_id, generation)`：关闭仓库并移除名册。关闭当前 active repo 时，后端在同一命令内切换 watcher / auto-fetch / 托盘 registry 到 `next_active_repo_id`，或在其为 `null` 时清空 active repo。
- `clone_repo` / `init_repo`：创建新仓库，支持进度事件回调。
- `create_worktree`：从已打开仓库创建 linked worktree，接收目标路径、新本地分支名和可选起点分支，返回创建后的 worktree 路径。
- `validate_repo_path`：路径合法性校验。

### 工作区与索引 (Status / Index)
- `get_status` / `get_repo_state`：获取当前工作区状态及仓库特定状态（如 Merge/Rebase 中）。`FileEntry.status` 使用 `git/types.rs::FileStatusKind`，其中 `type_changed` 表示普通文件、符号链接、gitlink 等文件类型变化。
- `stage_file` / `unstage_file` / `stage_files` / `unstage_files` / `stage_all` / `unstage_all`：索引区精细化管理。批量命令接收仓库相对路径数组，复用一次仓库打开和 Index 写盘。
- `apply_patch`：将补丁文本应用到工作区（常用于历史记录的单个变动行/Hunk回滚，或放弃未暂存 Hunk）。
- `apply_patch_to_index`：将补丁文本应用到 Index（用于工作区单个 Hunk 的暂存 / 取消暂存）。
- `apply_patch_to_workdir_and_index`：将补丁文本同时应用到工作区和 Index（用于放弃已暂存 Hunk）。

### 提交管理 (Commit)
- `create_commit` / `amend_commit` / `amend_commit_message`：提交创建与修补。
- `undo_last_commit(repo_id, expected_head)`：撤销当前分支刚创建的未发布单父提交；原子校验 HEAD 与 upstream 后执行 mixed reset，返回父提交 OID。
- `checkout_commit` / `reset_to_commit`：版本回退与切换。
- `cherry_pick_commit` / `revert_commit` / `create_tag`：高级版本操作。

### 历史与对比 (Log / Diff)
- `get_log` / `get_commit_detail` / `get_file_log`：多维度的历史记录查询。`get_log` 接收分页、`include_unreachable`、`include_stashes`、`branch_scope` 和 `include_remote_branches`，其中 `branch_scope` 见 `git/types.rs::LogBranchScope`。
- `search_commits`：在与 `get_log` 相同的引用和过滤范围内扫描完整提交元数据，按消息、作者姓名 / 邮箱或 OID 前缀返回 `git/types.rs::CommitSearchPage`；单次结果上限由命令层收口。
- `get_commit_change_stats`：按 OID 批量获取提交变更规模统计，返回 `git/types.rs::CommitChangeStats`，用于历史列表「变更」列的懒加载。
- `get_file_diff` / `get_file_diff_at_commit`：文件级差异计算，均接收 `ignore_whitespace` 控制是否忽略所有空白差异。`FileDiff` 会携带两侧文件 mode，用于前端识别 submodule gitlink 等类型变更。
- `get_blob_bytes` / `read_worktree_file`：二进制与原始文本内容按需读取。
- `extract_document_text`：从 blob 或工作区文件来源抽取 PDF / DOCX / PPTX 文本，返回 `git/types.rs::DocumentText`，用于文档预览的文本 diff。
- `get_file_blame`：逐行追溯分析。

### 引用与远程 (Branch / Remote / Tag)
- `list_branches` / `create_branch` / `switch_branch` / `delete_branch`：分支全生命周期管理。
- `fetch_remote` / `pull_branch` / `push_branch` / `push_tag`：远程协作与同步。
- `list_remotes` / `add_remote` / `edit_remote` / `remove_remote`：远程节点管理。
- `list_tags` / `delete_tag` / `list_remote_tags` / `fetch_tags_from_remote` / `delete_remote_tag`：标签管理。

### 子模块 (Submodule)
- `list_submodules` / `init_submodule` / `update_submodule` / `deinit_submodule` / `add_submodule`：完整的子模块工具链支持。

### 合并与变基 (Merge / Rebase)
- `merge_branch` / `merge_continue` / `merge_abort`：合并流程控制。
- `rebase_start` / `rebase_continue` / `rebase_abort` / `rebase_plan`：交互式变基流。
- `get_conflict_file` / `mark_conflict_resolved`：冲突解决契约。

### 系统集成 (System)
- `open_terminal` / `open_in_new_window`：外部工具联动。
- `discard_file` / `discard_files`：丢弃一个或多个文件的未暂存变更，参数路径为仓库相对路径；当前工作区原件先进入系统废纸篓，已跟踪文件再恢复到 Index。批量命令只执行一次 Checkout。
- `discard_all_changes`：先解析 Git 基线，再将非 ignored 的当前工作区原件送入系统废纸篓；有 HEAD 时恢复 Index 与工作区，无首个提交时清空 Index。不移动 Submodule 工作目录。
- `get_reflog` / `run_gc`：仓库底层维护。
- `set_auto_fetch_interval`：运行时调整后台自动 fetch 间隔，传入秒数；`0` 表示禁用。
- `get_build_info`：获取应用版本与元数据。

### 插件 (Plugins)
- `list_plugins`：扫描应用数据目录下的本地插件，返回 manifest、启用状态与安装路径。
- `install_plugin_from_path`：从本地目录安装插件，要求目录内存在 `plugin.json`。
- `enable_plugin` / `disable_plugin` / `uninstall_plugin`：管理本地插件生命周期。
- `execute_plugin_command`：执行插件贡献的命令，传入当前仓库上下文与可选选择信息，返回消息与刷新域。

## 事件通道 (Events)

| 事件名 | 含义 | 触发时机 |
|------|------|------|
| `repo://status-changed` | 仓库状态变更 | 当前激活仓库的文件监控感知到工作区、`.git` 变动或系统 rescan 兜底信号，payload 为 `{ repo_id, kind }`；rescan / 无路径批次归类为 `other_git`，`kind` 见 `useGitEvents.ts::StatusChangeKind`。 |
| `repo://operation-progress` | 长耗时任务进度 | Clone、Fetch 等网络或大 IO 操作时推送。 |
| `repo://error` | 后台异步错误 | 如后台自动 Fetch 失败。 |
| `terminal://data` / `exit` | 终端流数据 | 内部 PTY 会话的输出或结束通知。 |

## 数据映射参考

详细的字段定义请参考：
- Rust 侧：`src-tauri/src/git/types.rs`
- TypeScript 侧：`src/types/git.ts`

所有枚举值在传输过程中均序列化为 `snake_case` 字符串。

## 开发 Checklist

新增 IPC 接口时，请确保：
1. 后端实现 `#[tauri::command]` 并注册至 `lib.rs`。
2. 数据结构同步更新至双端并确保序列化行为一致。
3. 在 `useGitCommands.ts` 中完成类型安全封装。
4. 错误处理逻辑能正确识别新的业务异常（如有）。
