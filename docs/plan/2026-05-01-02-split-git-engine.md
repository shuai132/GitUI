# Context

`src-tauri/src/git/engine.rs` 仍有 3700+ 行，虽然工作区相关逻辑已拆到 `engine/workspace.rs`，但历史、diff、引用、远程、子模块、stash/reflog、patch/discard 等领域仍集中在一个文件。这个文件既是热路径集合，也是多人/多窗口并发修改时最容易冲突的地方。

目标是做一次完整的大拆分：保持 `crate::git::engine::GitEngine` 作为 commands 层唯一入口不变，把各领域的 `impl GitEngine` 按职责迁移到 `src-tauri/src/git/engine/` 子模块中。拆分只改变 Rust 内部组织，不改 IPC 命令、数据结构、前端调用路径和用户可见行为。

# 目标结构

```text
src-tauri/src/git/
  engine.rs                 # facade：GitEngine、共享常量、跨领域小工具、mod 声明
  engine/
    workspace.rs            # 已完成：status / index / commit create / repo state
    history.rs              # get_log / commit stats / file log / blame
    diff.rs                 # commit detail / file diff / diff parsing / blob reading
    refs.rs                 # branch / tag / checkout / reset / cherry-pick / revert
    remote.rs               # fetch / pull / push / clone / remote CRUD / init
    submodule.rs            # submodule list/init/update/edit/deinit/add
    stash_reflog.rs         # stash / reflog / gc / drop unreachable
    patch.rs                # discard / apply patch / amend commit
```

# 进度总览

| 阶段 | 状态 | 说明 |
|------|------|------|
| 0. 方案 | 完成 | 明确模块边界、迁移顺序和验证矩阵 |
| 1. 准备 | 完成 | 增加第一批模块声明，确认无行为改动 |
| 2. Diff 拆分 | 完成 | 迁移 diff 与 blob 读取路径 |
| 3. History 拆分 | 完成 | 迁移日志、统计、file log、blame |
| 4. Refs 拆分 | 未开始 | 迁移分支、标签、checkout/reset、cherry-pick/revert |
| 5. Remote 拆分 | 未开始 | 迁移 fetch/pull/push/clone/remotes/init |
| 6. Submodule 拆分 | 完成 | 迁移子模块全路径 |
| 7. Stash/Reflog/Patch 拆分 | 进行中 | patch/discard/amend 已迁移，stash/reflog/gc 待迁移 |
| 8. 收尾验证 | 未开始 | 全量格式化、类型检查、测试和 diff 核对 |

# 子任务清单

- [x] 建立完整拆分计划。
- [x] 阶段 1：把跨模块 helper 做最小可见性调整。
- [x] 阶段 2：新增 `engine/diff.rs` 并迁移 diff/blob 相关方法。
- [x] 阶段 3：新增 `engine/history.rs` 并迁移历史和 file history 相关方法。
- [ ] 阶段 4：新增 `engine/refs.rs` 并迁移引用和提交操作相关方法。
- [ ] 阶段 5：新增 `engine/remote.rs` 并迁移远程、clone、pull/push/fetch 相关方法。
- [x] 阶段 6：新增 `engine/submodule.rs` 并迁移子模块相关方法。
- [ ] 阶段 7：新增 `engine/stash_reflog.rs`、`engine/patch.rs` 并迁移剩余领域。
- [ ] 阶段 8：清理 `engine.rs` 未使用 imports 和重复 helper。
- [ ] 阶段 8：运行完整验证命令。
- [ ] 阶段 8：核对 staged diff 只包含重构与本 plan。

# 迁移映射

## `engine.rs` 保留

- `pub struct GitEngine`
- `GitEngine::open`
- `MAX_PREVIEW_BYTES`
- `LARGE_BLOB_THRESHOLD_BYTES`，若仅 diff 使用则移动到 `diff.rs`
- 编码与 commit 构造 helper：
  - `summary_from`
  - `commit_message_decoded`
  - `signature_name`
  - `signature_email`
  - `build_commit_info`
- 文件状态 helper：
  - `read_trimmed_file`
  - `read_single_oid_file`
  - `read_rebase_state`
- `mod workspace;` 和新增领域模块声明
- `#[cfg(test)] mod tests` 暂时保留在 `engine.rs`，避免测试迁移和业务迁移同时发生

## `engine/diff.rs`

- `get_commit_summary`
- `get_commit_detail`
- `get_file_diff`
- `get_file_diff_at_commit`
- `get_blob_bytes`
- `read_worktree_file`
- `try_conflict_diff`
- `parse_diff`
- `parse_diff_summary`
- `diff_file_blob_metadata`
- `add_tree_change_stats`
- `add_diff_change_stats`

说明：`history.rs` 的 `get_commit_change_stats` 需要复用 `add_tree_change_stats`；先把这些 helper 设为 `pub(super)`，避免复制实现。

## `engine/history.rs`

- `get_log`
- `get_commit_change_stats`
- `commit_change_stats`
- `get_file_log`
- `commit_touches_file`
- `get_file_blame`
- `checkout_file_at_commit`

说明：`get_log` 依赖 stash oid 收集；`list_stashes` 若保留在 `stash_reflog.rs`，需要设为 `pub(super)`。

## `engine/refs.rs`

- `list_branches`
- `checkout_remote_branch`
- `create_branch`
- `switch_branch`
- `delete_branch`
- `list_tags`
- `delete_tag`
- `list_remote_tags`
- `checkout_commit`
- `cherry_pick_commit`
- `cherry_pick_continue`
- `cherry_pick_abort`
- `revert_commit`
- `revert_continue`
- `revert_abort`
- `reset_to_commit`
- `create_tag`

说明：这些方法共享引用解析、工作区状态检查和 `read_single_oid_file`。先不抽新 helper，按现有实现直接移动。

## `engine/remote.rs`

- `fetch`
- `fetch_tags`
- `push`
- `push_tag`
- `delete_remote_tag`
- `delete_remote_branch`
- `pull`
- `pull_rebase`
- `pull_merge`
- `clone_repo`
- `clone_repo_ssh`
- `parse_clone_progress`
- `init_repo`
- `list_remotes`
- `add_remote`
- `remove_remote`
- `edit_remote`

说明：这是最高风险迁移之一，涉及 credential callback、shellout、进度回调和 external git。迁移时不重写网络逻辑，不改变错误消息。

## `engine/submodule.rs`

- `list_submodules`
- `classify_submodule_state`
- `init_submodule`
- `update_submodule`
- `set_submodule_url`
- `submodule_workdir`
- `deinit_submodule`
- `add_submodule`
- `strip_gitmodules_section`

说明：`strip_gitmodules_section` 只由 submodule 使用，迁移后保持私有。

## `engine/stash_reflog.rs`

- `stash_push`
- `stash_pop`
- `stash_apply`
- `stash_drop`
- `stash_list`
- `list_stashes`
- `stash_count`
- `get_reflog`
- `run_gc`
- `compute_drop_unreachable_indices`
- `drop_unreachable_commit`
- `preview_drop_unreachable_commit`

说明：`get_log` 需要 `list_stashes` 识别 stash commit；迁移后暴露为 `pub(super)`。

## `engine/patch.rs`

- `amend_commit`
- `amend_commit_message`
- `discard_all_changes`
- `discard_file`
- `apply_patch`
- `apply_patch_to_index`
- `apply_patch_to_workdir_and_index`

说明：这些方法共同修改 index/workdir，和工作区视图紧密相关；暂时不并入 `workspace.rs`，避免 `workspace.rs` 继续膨胀。

# 实施顺序

1. **准备层**
   - 在 `engine.rs` 增加所有目标模块声明。
   - 把跨模块 helper 改为 `pub(super)`，只在 `engine/` 子模块内部可见。
   - 运行 `cd src-tauri && cargo check`，确认准备动作无行为影响。

2. **先拆低耦合模块**
   - `submodule.rs`
   - `patch.rs`
   - 每拆一个模块运行 `cd src-tauri && cargo check`。

3. **拆 diff**
   - 先迁移 diff parsing 和 blob 读取。
   - 再迁移 commit detail / file diff。
   - 针对 diff 路径运行相关测试：
     - `cd src-tauri && cargo test git::engine::tests::test_stash_diff_includes_untracked_and_staged_new_files`
     - `cd src-tauri && cargo test git::engine::tests::test_get_commit_change_stats_for_root_and_text_commit`

4. **拆 history**
   - 迁移 `get_log` 和 change stats。
   - 迁移 file log / blame / checkout file。
   - 运行日志相关测试：
     - `cd src-tauri && cargo test git::engine::tests::test_get_log`
     - `cd src-tauri && cargo test git::engine::tests::test_get_log_can_exclude_remote_only_commits`
     - `cd src-tauri && cargo test git::engine::tests::test_get_log_current_first_parent_excludes_merged_side_branch`

5. **拆 refs**
   - 迁移分支、标签、checkout/reset、cherry-pick/revert。
   - 运行 `cd src-tauri && cargo check`。

6. **拆 remote**
   - 最后迁移远程和 clone 路径。
   - 运行 `cd src-tauri && cargo check`。
   - 不在自动测试中真实访问网络；手动验证列在验证方式里。

7. **收尾**
   - 清理 `engine.rs` import，只保留 facade 必需项。
   - 确认 `engine.rs` 剩余职责清晰，目标是控制在 300 行以内（不含测试）。
   - 更新本 plan 勾选状态。

# 关键决策

- **不改对外 API**：所有 commands 继续调用 `GitEngine::method`；这次不拆 commands、不改 IPC、不改 `useGitCommands.ts`。
- **不做算法重写**：迁移期间不优化 revwalk、diff parsing、pull/merge/rebase 逻辑，避免结构变化和行为变化叠加。
- **优先文件移动，少抽象**：只有跨模块真正需要复用时才用 `pub(super)` helper；不新建 trait、不引入状态对象。
- **测试先不搬**：`#[cfg(test)] mod tests` 暂留在 `engine.rs`，等实现拆分稳定后再单独拆测试。这样失败栈和现有测试名保持稳定。
- **remote 最后拆**：网络、凭据和 shellout 行为不好用单元测试覆盖，最后迁移可以减少中途排错变量。
- **README 不更新**：这是内部重构，不增删用户可见功能。
- **`docs/11-ipc.md` 不更新**：IPC 命令和数据结构不变。

# 风险与缓解

- **私有 helper 可见性风险**：跨模块调用会要求 `pub(super)`。缓解：只暴露给 `engine/` 子模块，不提升到 `pub(crate)`。
- **循环依赖风险**：`history.rs` 需要 stash helper，change stats 需要 diff helper。缓解：共享 helper 放在使用方语义更强的模块中并用 `pub(super)`，不相互 re-export。
- **import 噪音风险**：大规模移动容易留下未使用 import。缓解：每阶段跑 `cargo check`，最后用 `cargo fmt` 统一。
- **remote 行为回归风险**：clone/pull/fetch/push 自动测试覆盖有限。缓解：只移动代码，不改错误处理与回调链；最后做最小手动验证。
- **单次 diff 过大风险**：这次目标是一步到位，但实施上仍按模块顺序小步提交到工作区，每阶段 check；最终可以形成一个聚焦 commit。

# 验证方式

## 自动验证

- `cd src-tauri && cargo fmt`
- `npx vue-tsc --noEmit`
- `npm run test`
- `cd src-tauri && cargo check`
- `cd src-tauri && cargo test`

## 重点后端测试

- `cd src-tauri && cargo test git::engine::tests::test_get_status`
- `cd src-tauri && cargo test git::engine::tests::test_get_log`
- `cd src-tauri && cargo test git::engine::tests::test_get_log_can_exclude_remote_only_commits`
- `cd src-tauri && cargo test git::engine::tests::test_get_log_current_first_parent_excludes_merged_side_branch`
- `cd src-tauri && cargo test git::engine::tests::test_stash_diff_includes_untracked_and_staged_new_files`
- `cd src-tauri && cargo test git::engine::tests::test_apply_patch_to_index_stages_single_hunk`
- `cd src-tauri && cargo test git::engine::tests::test_apply_patch_to_index_unstages_single_hunk`
- `cd src-tauri && cargo test git::engine::tests::test_apply_patch_to_workdir_and_index_discards_staged_hunk`

## 手动验证

- 打开一个普通仓库：状态列表、WIP 行、stage/unstage、commit 创建正常。
- 历史视图：分页加载、Solo 当前分支、显示/隐藏远程分支、显示丢失引用正常。
- 提交详情和 WIP diff：文本 diff、图片/SVG 预览、按 hunk 操作正常。
- 分支/标签：切换分支、创建/删除分支、创建/删除标签、checkout commit 正常。
- 远程：对测试远端执行 fetch；如有安全测试仓库，再验证 push/pull。
- 子模块：打开带 submodule 的仓库，确认列表和状态计算正常。
- Stash/Reflog：stash list/apply/pop/drop、reflog 列表和 drop unreachable 预览/执行正常。

# 完成标准

- `src-tauri/src/git/engine.rs` 只承担 facade 和共享 helper。
- 所有领域方法已迁移到 `src-tauri/src/git/engine/*.rs`。
- commands、IPC 文档和前端调用不需要改动。
- 自动验证全通过。
- `git diff --cached` 中没有算法重写、行为调整或无关文件改动。
