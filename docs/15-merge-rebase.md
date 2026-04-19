# 15. Merge / Rebase

本模块提供独立于 Pull 的合并 / 变基能力，覆盖：

- **完整 merge**：fast-forward / non-ff / squash；非 ff 时可自定义 commit message
- **交互式 rebase**：reword / squash / fixup / drop / 上下移（reorder）
- **冲突解决**：自带三路合并编辑器 + 一键使用 ours / theirs
- **脏工作区**：对话框提供"自动 stash & 恢复"可选
- **触发入口**：Commit 右键菜单 + 拖拽 commit 到另一 commit（选择合并/变基）

## 入口与 UI

| 位置 | 行为 |
|------|------|
| 历史视图 commit 右键菜单 | "将此提交所在分支合并到 <branch>..." → 打开 `MergeDialog`；"将 <branch> 变基到此提交..." → 打开 `RebasePlanDialog` |
| 历史视图 commit 右键 "修改提交信息..." | HEAD 走 amend；**非 HEAD 且是单父祖先提交**时以 `reword` 预填消息启动 rebase（`parent..HEAD`），`new_message` 已填故 rebase 循环不会暂停——见 [04-history.md](./04-history.md) |
| 历史视图 commit 拖拽 | 拖拽一条 commit 到另一条 commit，松开后打开 `DragActionDialog` 让用户选合并 / 变基 |
| 顶部 `OngoingOpBanner` | 仓库处于 merge / rebase / cherry-pick / revert 中间态时显示；按钮：继续（merge 弹消息编辑框，其余直接推进）/ 跳过（仅 rebase）/ 中止 |
| `WipPanel` 冲突文件右键 | 打开三路合并编辑器 / 使用 ours / 使用 theirs / 标记已解决 |

关键组件：

- `components/common/OngoingOpBanner.vue`
- `components/merge/MergeDialog.vue`
- `components/diff/ConflictView.vue`（三路合并编辑器）
- `components/rebase/RebasePlanDialog.vue`
- `components/history/DragActionDialog.vue`

## 数据流

```
MergeDialog / RebasePlanDialog / DragActionDialog
  → mergeRebase store action（startMerge / startRebase / continueMerge / continueRebase / ...）
  → useGitCommands 封装
  → Tauri invoke → merge_rebase commands
  → GitEngine::merge_* / rebase_* / ...
  → 刷新 history + branches + workspace（触发 get_status，带回 repo_state）
  → mergeRebase.setRepoState 更新 OngoingOpBanner
```

冲突文件：

```
冲突时 FileStatusKind::Conflicted 出现在 workspaceStore.status.unstaged
  → 右键 "用三路合并编辑器解决" → ConflictView 打开
  → getConflictFile 读 stage 1/2/3
  → 三栏视图：A（ours）| B（theirs）上下排列 + OUTPUT 底部只读预览
    · A/B 每一行带 checkbox，可按行勾选进入 OUTPUT（VSCode 冲突编辑器风格）
    · equal 行始终进入 OUTPUT；默认没有任何冲突行被勾选
    · 顶部按钮：整体用 A / 整体用 B / 全部清空
    · OUTPUT 随勾选实时合成、不可直接编辑；三栏行号与语法高亮同 SideBySideDiff
  → 「保存并 stage」→ markConflictResolved 写入合成内容 + stage（add_path 替换 conflict 条目）
  → workspaceStore.refresh
```

如需做 UI 表达不了的手工微调，在工作区直接编辑文件后从右键菜单「标记为已解决」即可——OUTPUT 故意保持只读，避免逐行勾选与手工编辑两个事实来源分叉。

## 后端实现

- `src-tauri/src/git/merge.rs`：`merge_branch / merge_continue / merge_abort`
- `src-tauri/src/git/rebase.rs`：`rebase_plan / rebase_start / rebase_continue / rebase_skip / rebase_abort`
- `src-tauri/src/git/conflict.rs`：`get_conflict_file / mark_conflict_resolved / checkout_conflict_side`
- `src-tauri/src/git/engine.rs`：`cherry_pick_commit / cherry_pick_continue / cherry_pick_abort / revert_commit / revert_continue / revert_abort`（cherry-pick continue 还原原作者签名，revert continue 沿用用户签名；abort 都是 `reset --hard HEAD` + `cleanup_state`）
- `src-tauri/src/commands/merge_rebase.rs`：命令层薄封装
- `src-tauri/src/git/engine.rs::build_repo_state`：读 `.git/MERGE_MSG / MERGE_HEAD / rebase-merge/*` 汇总到 `RepoState`，随 `get_status` 一起返回

交互式 rebase 的 todo 通过 `.git/gitui-rebase-todo.json` 额外持久化，libgit2 原生的 `.git/rebase-merge/` 目录维护 rebase 自身状态。squash / fixup 在当前步 commit 之后立即把 HEAD 与父合并成一个新 commit（fixup 沿用父消息，squash 使用 todo 中的 `new_message` 或拼接双方）。

## 关键取舍

- **三路合并编辑器按行粒度合并**：A/B 每行独立勾选决定是否进入 OUTPUT，不做字符级；不实现 `rebase --exec`
- **Reword 暂停策略**：前端通过 `rebaseContinue(amendedMessage)` 补交新消息；squash 的最终消息在 plan 阶段就填好，执行过程中不打断
- **自动 stash pop 失败**时前端只提示"请手动处理 stash"，**不自动强合并**——避免进一步破坏工作区
- **新 git2 方法**集中在 `merge.rs` / `rebase.rs` / `conflict.rs`，不再继续堆 `engine.rs`（已超 1600 行）
- **拖拽语义**由弹窗让用户选合并或变基，避免默认行为猜错
- **冲突文件分组**复用现有的 `FileChangeList` + `FileStatusKind::Conflicted`，不为冲突单独做顶部 banner——`OngoingOpBanner` 的"仍有未解决冲突"提示已足以导航

## 错误映射

`src/lib/errorMap.ts` 已处理：

- `Rebase conflict` / `Merge 出现冲突` → `errors.merge.conflict` / `errors.rebase.conflict`
- `uncommitted` / `local changes` → `errors.worktree.dirty`

后端的定制错误消息（含中文）直接作为 `OperationFailed(...)` 抛出，errorMap 模式匹配兜底。

## 验证

在 demo 仓库手动跑：

1. **Merge**：FF / non-FF / squash 各一次；非 FF 冲突一次 → 在 WipPanel 解决冲突 → OngoingOpBanner 继续 → 出 merge commit
2. **Rebase 非交互**：线性 rebase 正常；制造冲突 → continue / skip / abort 三条路径
3. **交互 rebase**：覆盖 reword / squash / fixup / drop；reorder 后成功
4. **拖拽**：历史视图拖一个 commit 到另一个 commit → 弹窗 → 选合并 / 选变基，分别走通
5. **自动 stash**：脏工作区勾选 `autoStash` → 完成 merge/rebase → 改动自动恢复；故意制造 pop 冲突 → UI 提示"请手动处理"
6. 大仓库（≥1w commits）跑 50 步 rebase，UI 不卡
