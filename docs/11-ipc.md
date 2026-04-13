# 11. IPC 契约

GitUI 的前后端通过 Tauri v2 的 IPC 通道通信：

- **`invoke<T>(cmd, args)` → `Result<T, GitError>`**：同步请求 / 响应
- **`app.emit("event", payload)` → `listen<T>("event", ...)`**：事件推送

## 命名约定

- **命令名**：`snake_case`，与 Rust 函数名一致（Tauri 默认不做转换）
- **参数名**：在 Rust 函数签名里声明为 `snake_case`，但前端 `invoke` 时要用 `camelCase`，Tauri 的 JS 桥接会自动转换 —— **参数对象字段用 camelCase**
- **返回结构体字段**：保持 `snake_case`，前端 TypeScript 接口也用 `snake_case`（不做任何转换）
- **错误**：`GitError` 枚举实现了 `Serialize`，`invoke<T>(...)` 在失败时 Promise reject，rejection value 是序列化后的 `GitError`（字符串或结构）

> 为什么返回字段是 snake_case：避开 serde 的重命名，保持 Rust / TS 字段完全对称，简化"新增字段"的改动范围（两边写同一个名字）。

## 全量命令清单

注册在 `src-tauri/src/lib.rs` 的 `invoke_handler!` 中，按功能域分组：

### Repo

| 命令 | 参数 | 返回 |
|------|------|------|
| `open_repo` | `path: string` | `RepoMeta` |
| `close_repo` | `repoId: string` | `void` |
| `list_repos` | — | `RepoMeta[]` |
| `validate_repo_path` | `path: string` | `boolean` |
| `clone_repo` | `opts: { url, parentDir, name?, depth?, recurseSubmodules }` | `string` (workdir 绝对路径，前端拿到后再走 `open_repo`) |
| `init_repo` | `path: string` | `string` (同 `path`，便于链式调用 `open_repo`) |

`clone_repo` 在后端 `tokio::task::spawn_blocking` 内执行（git2 是阻塞 C 库），过程中通过 `repo://operation-progress` 事件推送进度（见下文事件通道）。完成后命令本身只返回 workdir 路径，**不**自动注册到 `RepoManager`——前端 `repoStore.cloneRepo` 收到路径后统一走 `openRepo` 完成注册 + 启动 watcher + 持久化，避免在两条路径上各写一份"添加仓库"逻辑。

`init_repo` 同样仅创建非 bare 仓库并返回路径，注册由 `openRepo` 完成。`bare` 选项不暴露——`open_repo` 当前不支持 bare。

### Status / Index

| 命令 | 参数 | 返回 |
|------|------|------|
| `get_status` | `repoId` | `WorkspaceStatus` |
| `stage_file` | `repoId, filePath` | `void` |
| `unstage_file` | `repoId, filePath` | `void` |
| `stage_all` | `repoId` | `void` |
| `unstage_all` | `repoId` | `void` |

### Commit

| 命令 | 参数 | 返回 |
|------|------|------|
| `create_commit` | `repoId, message` | `string` (new oid) |
| `amend_commit` | `repoId, message` | `string` (new oid) |
| `checkout_commit` | `repoId, oid` | `void` |
| `cherry_pick_commit` | `repoId, oid` | `void` |
| `revert_commit` | `repoId, oid` | `void` |
| `reset_to_commit` | `repoId, oid, mode: 'soft' \| 'mixed' \| 'hard'` | `void` |
| `create_tag` | `repoId, name, oid, message: string \| null` | `void` |

### Log / Diff

| 命令 | 参数 | 返回 |
|------|------|------|
| `get_log` | `repoId, offset, limit, includeUnreachable, includeStashes` | `LogPage` |
| `get_commit_detail` | `repoId, oid` | `CommitDetail` |
| `get_file_diff` | `repoId, filePath, staged` | `FileDiff` |
| `get_blob_bytes` | `repoId, oid` | `BlobData` (按 blob oid 读取原始字节，用于图片等二进制预览；超过 10 MB 返回 `truncated=true` 且不带字节) |
| `read_worktree_file` | `repoId, relPath` | `BlobData` (读取工作区内相对路径文件；用于 WIP 未暂存的新版；同样受 10 MB 上限限制) |

### Branch

| 命令 | 参数 | 返回 |
|------|------|------|
| `list_branches` | `repoId` | `BranchInfo[]` |
| `create_branch` | `repoId, name, fromOid?` | `void` |
| `switch_branch` | `repoId, name` | `void` |
| `delete_branch` | `repoId, name` | `void` |
| `checkout_remote_branch` | `repoId, remoteBranch, localName, track` | `void` |

### Tag

| 命令 | 参数 | 返回 |
|------|------|------|
| `list_tags` | `repoId` | `TagInfo[]` |
| `delete_tag` | `repoId, name` | `void` |

### Remote

| 命令 | 参数 | 返回 |
|------|------|------|
| `fetch_remote` | `repoId, remoteName` | `void` |
| `push_branch` | `repoId, remoteName, branchName` | `void` |
| `pull_branch` | `repoId, remoteName, branchName` | `void` |
| `list_remotes` | `repoId` | `string[]` |

### Submodule

| 命令 | 参数 | 返回 |
|------|------|------|
| `list_submodules` | `repoId` | `SubmoduleInfo[]` |
| `init_submodule` | `repoId, name` | `void` |
| `update_submodule` | `repoId, name` | `void` |
| `set_submodule_url` | `repoId, name, url` | `void` |
| `submodule_workdir` | `repoId, name` | `string` (abs path) |
| `deinit_submodule` | `repoId, name` | `void` |

### Stash

| 命令 | 参数 | 返回 |
|------|------|------|
| `stash_push` | `repoId, message: string \| null` | `void` |
| `stash_pop` | `repoId` | `void` |
| `stash_list` | `repoId` | `StashEntry[]` |

### System

| 命令 | 参数 | 返回 |
|------|------|------|
| `open_terminal` | `repoId, terminalApp?: string \| null` | `void`（`terminalApp` 仅 macOS 生效，对应 `open -a <app>`，空值回退到 `Terminal`） |
| `open_in_new_window` | `repoId` | `void` （以新进程打开仓库，macOS 走 `open -n -a`） |
| `reveal_in_file_manager` | `repoId` | `void` |
| `consume_startup_repo` | — | `string \| null`（取走 `--open-repo` 注入的路径，只生效一次） |
| `discard_all_changes` | `repoId` | `void` |
| `discard_file` | `repoId, filePath` | `void` |
| `get_reflog` | `repoId` | `ReflogEntry[]` （最近 500 条） |
| `run_gc` | `repoId` | `string` (消息) |

### Terminal（应用内 PTY）

| 命令 | 参数 | 返回 |
|------|------|------|
| `terminal_spawn` | `repoId, cols, rows` | `string` (session_id) |
| `terminal_write` | `sessionId, data` (base64-encoded bytes) | `void` |
| `terminal_resize` | `sessionId, cols, rows` | `void` |
| `terminal_close` | `sessionId` | `void` |

> 数据以 base64 编码避免 UTF-8 边界被切断。PTY 子 shell 默认取 `$SHELL`（Windows `COMSPEC` / `powershell.exe`），`cwd` 为 `repoId` 对应的仓库路径。详见 `src-tauri/src/terminal.rs::TerminalManager`。

## 类型映射表

`src-tauri/src/git/types.rs` ↔ `src/types/git.ts`：

| Rust | TypeScript |
|------|------------|
| `RepoMeta` | `RepoMeta` |
| `FileStatusKind` enum (`#[serde(rename_all = "snake_case")]`) | `'added' \| 'modified' \| 'deleted' \| 'renamed' \| 'untracked' \| 'conflicted'` |
| `FileEntry` | `FileEntry` |
| `WorkspaceStatus` | `WorkspaceStatus` |
| `CommitInfo`（含 `is_unreachable`, `is_stash`） | `CommitInfo` |
| `BranchInfo`（含 `ahead`, `behind`） | `BranchInfo` |
| `TagInfo`（含 `is_annotated`, `message`, `tagger_name`, `time`） | `TagInfo` |
| `DiffLine` | `DiffLine` |
| `DiffHunk` | `DiffHunk` |
| `FileDiff`（含 `old_blob_oid`, `new_blob_oid` 用于图片预览） | `FileDiff` |
| `BlobData` | `BlobData` |
| `CommitDetail` | `CommitDetail` |
| `LogPage` | `LogPage` |
| `StashEntry` | `StashEntry` |
| `SubmoduleState` enum | `'uninitialized' \| 'not_cloned' \| 'up_to_date' \| 'modified' \| 'not_found'` |
| `SubmoduleInfo` | `SubmoduleInfo` |
| `ReflogEntry` | `ReflogEntry` |

## 事件通道

后端用 `app.emit(event, payload)` 推送：

| 事件 | payload | 触发点 | 订阅方 |
|------|---------|--------|--------|
| `repo://status-changed` | `repoId: string` | `WatcherService` 检测到工作目录变化（300ms 防抖） | `useGitEvents.onStatusChanged` → `workspaceStore.refresh + submodulesStore.loadSubmodules`（仅当 repoId === activeRepoId） |
| `repo://operation-progress` | `{ op, stage, progress, message? }` | `clone_repo` 在 `transfer_progress` / `sideband_progress` / checkout 回调里推送（节流为最多每 100ms 或跨 1% 一次，sideband 不节流）。`op="clone"`，`stage` ∈ `receiving / indexing / checkout / sideband` | `useGitEvents.onOperationProgress`，`CloneRepoDialog` 据此渲染进度条与远端日志 |
| `repo://error` | `{ repoId, msg }` | 目前未使用 | `useGitEvents.onError` |
| `terminal://data` | `{ session_id: string, data: string (base64) }` | `TerminalManager` 读循环每次拿到 PTY 输出时推送 | `TerminalPanel.vue` 按 `sessionId` 过滤后 `term.write(bytes)` |
| `terminal://exit` | `{ session_id: string }` | PTY 子进程退出时推送 | `TerminalPanel.vue` 标记 session 结束、显示 `[shell exited]` |

## 新增命令的 checklist

要加一条新命令 `do_xxx`：

1. **新 IPC**：
   - 在 `src-tauri/src/commands/<域>.rs` 加 `#[tauri::command] pub async fn do_xxx(...)`
   - 在 `src-tauri/src/lib.rs` 的 `generate_handler![]` 中注册（按域注释里的顺序放好）
2. **新数据结构**（如有）：
   - 在 `src-tauri/src/git/types.rs` 里加 struct/enum，实现 `Serialize + Deserialize`
   - 字段名写 `snake_case`，枚举用 `#[serde(rename_all = "snake_case")]`
   - 在 `src/types/git.ts` 里加对应 interface
3. **GitEngine 方法**：
   - 在 `git/engine.rs` 加一个 `pub fn do_xxx(path: &str, ...) -> GitResult<...>`
   - 内部 `let repo = Self::open(path)?;` 再操作，每次都临时打开
4. **前端 composable**：
   - 在 `src/composables/useGitCommands.ts` 里加 `const doXxx = (...) => invoke<T>('do_xxx', { ... })`
   - 参数对象字段名用 `camelCase`
5. **Store**（如涉及状态）：
   - 在对应的 Pinia store 里加 action，调 `git.doXxx` 并在成功后 refresh 相关数据
6. **UI**：按需绑定到组件事件 / 按钮

## `GitError` 枚举

声明在 `src-tauri/src/git/error.rs`，主要变体：

```
RepoNotFound(String)
RepoNotOpen(String)
InvalidPath(String)
OperationFailed(String)
Git2(#[from] git2::Error)
Io(#[from] std::io::Error)
```

前端收到的 rejection 是一个形如 `{ RepoNotFound: "..." }` 或 `{ OperationFailed: "..." }` 的对象（取决于 `Serialize` 的默认行为）。

## 前端错误映射

所有 IPC 调用都经过 `useGitCommands.wrap(op, fn)`：

```ts
async function wrap<T>(op: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (raw) {
    errorsStore.push(op, raw)
    throw new Error(mapGitError(op, raw))
  }
}
```

`lib/errorMap.ts` 负责把原始错误（可能是 `{ Git2: "..." }` 对象、`{ OperationFailed: "..." }` 对象或字符串）映射成中文友好消息。映射规则按优先级匹配：

1. 命中 `GitError` 变体结构 → 按变体分类
2. 命中已知 git2 原始消息子串（`reference ... already exists`、`needs merge`、`non-fast-forward`、`authentication required` 等）→ 中文说明
3. 兜底 → 截断后的原始字符串

调用方的 `catch` 拿到的 `Error.message` 就是用户可读的中文，同时 `errorsStore` 保留完整原始记录以备翻查。

新增 IPC 命令时不用改 errorMap——错误映射是事后分析，未命中规则会走兜底分支，体验只比原始串好一点但不会崩。
