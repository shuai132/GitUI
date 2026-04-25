# 11. IPC 契约

GitUI 采用 Tauri v2 的 IPC 机制实现前后端通信，包括双向的请求-响应模式与单向的事件推送模式。

## 契约规范

- **通信协议**：前端通过 `invoke` 调用后端注册的命令，后端通过 `emit` 推送异步事件。
- **命名规范**：命令名与返回结构体字段保持 `snake_case`；`invoke` 的参数对象字段在前端使用 `camelCase`（由桥接层自动处理）。
- **类型一致性**：所有通过 IPC 传输的数据结构必须在 Rust (`src-tauri/src/git/types.rs`) 与 TypeScript (`src/types/git.ts`) 中同步定义。
- **异常处理**：后端统一抛出 `GitError`。前端在封装层拦截异常，将其推入错误历史，并映射为用户友好的提示。

## 命令清单 (Commands)

### 仓库管理 (Repo)
- `open_repo` / `close_repo` / `list_repos`：仓库名册的基础维护。
- `clone_repo` / `init_repo`：创建新仓库，支持进度事件回调。
- `validate_repo_path`：路径合法性校验。

### 工作区与索引 (Status / Index)
- `get_status` / `get_repo_state`：获取当前工作区状态及仓库特定状态（如 Merge/Rebase 中）。
- `stage_file` / `unstage_file` / `stage_all` / `unstage_all`：索引区精细化管理。
- `apply_patch`：将补丁文本应用到工作区（常用于历史记录的单个变动行/Hunk回滚）。

### 提交管理 (Commit)
- `create_commit` / `amend_commit` / `amend_commit_message`：提交创建与修补。
- `checkout_commit` / `reset_to_commit`：版本回退与切换。
- `cherry_pick_commit` / `revert_commit` / `create_tag`：高级版本操作。

### 历史与对比 (Log / Diff)
- `get_log` / `get_commit_detail` / `get_file_log`：多维度的历史记录查询。
- `get_file_diff` / `get_file_diff_at_commit`：文件级差异计算。
- `get_blob_bytes` / `read_worktree_file`：二进制与原始文本内容按需读取。
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
- `get_reflog` / `run_gc`：仓库底层维护。
- `get_build_info`：获取应用版本与元数据。

## 事件通道 (Events)

| 事件名 | 含义 | 触发时机 |
|------|------|------|
| `repo://status-changed` | 仓库状态变更 | 文件监控感知到工作区或 `.git` 变动。 |
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
