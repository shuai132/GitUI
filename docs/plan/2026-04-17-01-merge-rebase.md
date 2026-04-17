# Merge / Rebase 功能实现

## Context

当前 GitUI 已具备分支管理、cherry-pick、revert、reset、pull（含 rebase）、stash 等能力，**尚缺独立的 merge 与 rebase 入口**。`engine.rs::pull_rebase`（engine.rs:1233-1290）展示了 libgit2 rebase 的用法，但耦合在 pull 流程里。本次补齐：

- **完整 merge**：fast-forward / non-ff / --squash，支持编辑 merge commit 消息
- **交互式 rebase**：reword / squash / drop / reorder + 冲突继续/跳过/中止
- **入口**：Commit 右键菜单 + 拖拽 commit 到另一 commit（拖放后弹菜单问"合并/变基到哪里"）
- **脏工作区自动 stash & 恢复**（用户可选）
- **自带三路合并编辑器**（ours/theirs/base 并排）

---

## 进度总览

| PR | 范围 | 状态 | 依赖 |
|----|------|------|------|
| PR 0 | CLAUDE.md 规则 + `docs/plan/` 约定 + 搬运本方案 + `docs/README.md` 索引 | 已完成 | — |
| PR 1 | 后端 `RepoState` 类型 + `get_repo_state` IPC + `OngoingOpBanner` 雏形 | 已完成 | PR 0 |
| PR 2 | Merge 核心：`merge_branch/continue/abort` + `MergeDialog` + 右键菜单 | 已完成 | PR 1 |
| PR 3 | 冲突 UI：`get_conflict_file/mark_conflict_resolved/checkout_conflict_side` + `FileChangeList` 分组 + `ThreeWayMergeEditor` | 已完成 | PR 2 |
| PR 4 | Rebase 非交互：`rebase_start/continue/skip/abort` + 右键"变基到此" | 已完成 | PR 3 |
| PR 5 | Rebase 交互：`rebase_plan` + `RebasePlanDialog`（reword/squash/drop/reorder） | 已完成 | PR 4 |
| PR 6 | 拖拽入口：`CommitGraphRow` DnD + `DragActionDialog` | 已完成 | PR 2、PR 4 |
| PR 7 | 自动 stash 选项 | 已完成 | PR 2、PR 4 |
| PR 8 | 收尾：`docs/15-merge-rebase.md`、`docs/11-ipc.md`、`README.md`、i18n 查漏 | 已完成 | PR 1–7 |

每个 PR 独立 commit；实施中每勾一项即更新本文件。

---

## 一、后端（`src-tauri/src/git` + `commands/`）

### 新增类型（`git/types.rs`）

- [x] `RepoState { kind, head_oid, merge_msg, merge_head, rebase_onto, rebase_orig_head, rebase_head_name, rebase_step, rebase_total, rebase_current_oid }`
- [x] `RebaseActionKind { Pick, Reword, Squash, Fixup, Drop }` + `RebaseTodoItem { oid, action, subject, new_message? }`
- [x] `MergeStrategy { Auto, FastForward, NoFastForward, Squash }`
- [x] `WorkspaceStatus` 追加 `repo_state: RepoState`

### 新模块 `git/merge.rs`

- [x] `merge_branch(path, source_branch, strategy, message?)` — 参考 `pull()::merge 分支`（engine.rs:1122-1230）
- [x] `merge_continue(path, message)`
- [x] `merge_abort(path)` — `cleanup_state` + `reset --hard ORIG_HEAD`

### 新模块 `git/rebase.rs`

- [x] `rebase_plan(path, upstream, onto?) -> Vec<RebaseTodoItem>`（不执行，仅返回默认 Pick 列表）
- [x] `rebase_start(path, upstream, onto?, todo?)` — 写 `.git/rebase-merge/git-rebase-todo` 后逐步执行；reword 暂停、squash/fixup 合并、drop 跳过
- [x] `rebase_continue(path, amended_message?)`
- [x] `rebase_skip(path)`
- [x] `rebase_abort(path)`

### 冲突文件

- [x] `get_conflict_file(path, file) -> { base?, ours?, theirs?, merged_preview }` — 读 index stage 1/2/3
- [x] `mark_conflict_resolved(path, file, content_utf8)` — 写文件 + `index.add_path` + `index.write`
- [x] `checkout_conflict_side(path, file, side: "ours"|"theirs")`

### IPC 注册（`lib.rs`）

- [x] `merge_branch / merge_continue / merge_abort`
- [x] `rebase_plan / rebase_start / rebase_continue / rebase_skip / rebase_abort`
- [x] `get_conflict_file / mark_conflict_resolved / checkout_conflict_side`
- [x] `get_repo_state`（将私有的 engine.rs:1569-1585 暴露）

---

## 二、前端

### IPC / 类型 / store

- [x] `src/composables/useGitCommands.ts` — 11 个新 invoke 封装（camelCase 参数）
- [x] `src/types/git.ts` — `RepoState`、`RebaseActionKind`、`RebaseTodoItem`、`MergeStrategy`、`ConflictFile` 对齐
- [x] `src/stores/mergeRebase.ts` — state + 每个 action 完成后 `Promise.all([loadLog, loadBranches, workspace.refresh])`
- [x] `src/stores/workspace.ts::refresh()` 同步 `repoState` 到 `mergeRebase` store

### UI 组件

- [x] `src/components/common/OngoingOpBanner.vue` — `v-if="repoState.kind !== 'clean'"`；Merge 中显示目标 + 继续/中止；Rebase 中显示 `N/M · picking <oid.short> <subject>` + 继续/跳过/中止
- [x] `src/components/merge/MergeDialog.vue` — source→target、策略、message（非 FF 可编辑）、自动 stash 复选框
- [x] `src/components/rebase/RebasePlanDialog.vue` — 展开 `rebasePlan` 结果，每行 action 下拉 + 上下移动 + reword/squash 内嵌 textarea
- [x] `src/components/merge/ThreeWayMergeEditor.vue` — 基于 CodeMirror 6（复用现有依赖）三列 base/ours/theirs + 合并区
- [x] `src/components/history/CommitGraphRow.vue` — 加 `draggable` + dragover 高亮
- [x] `src/components/history/DragActionDialog.vue` — 拖放后弹"合并到…/变基到…"选择
- [x] `src/components/workspace/FileChangeList.vue` — conflicted 图标 + 单独分组置顶
- [x] `src/components/workspace/WipPanel.vue` — 冲突分组右键菜单（打开三路编辑器、标记已解决、使用 ours / theirs）
- [x] `src/views/HistoryView.vue` — 右键菜单新增两项 + 顶部挂 `OngoingOpBanner`

### i18n / 错误

- [x] `src/i18n/locales/{en,zh-CN}.ts` — `history.contextMenu.{merge,rebaseOnto}`、`history.dialog.{confirmMerge,confirmRebase,dragAction,mergeStrategy.*,rebaseAction.*}`、`workspace.conflict.*`、`ongoing.{merge,rebase}.*`、`errors.{merge,rebase}.*`
- [x] `src/lib/errorMap.ts` — 补充未覆盖的 merge 冲突文案（现有项见 errorMap.ts:105-128）

### 文档

- [x] `docs/15-merge-rebase.md` — 目标、UI 入口、组件名、IPC 名、冲突流程、取舍
- [x] `docs/11-ipc.md` — 追加新命令与类型
- [x] `docs/04-history.md` — 右键菜单清单追加
- [x] `docs/README.md` — 索引追加 `15-merge-rebase.md`
- [x] 根 `README.md` — 从「未实现」挪到「已实现」

---

## 关键决策

- **三路合并编辑器只做行级**，不做字符级；不支持 `rebase --exec`
- **交互式 rebase 的 reword 暂停**后，前端用 `rebaseContinue(amended_message)` 继续；squash 的最终消息在 plan 阶段就定好
- **自动 stash 失败**（pop 冲突）时前端提示保留 stash，**不自动强合并**
- 新 git2 方法集中在 `merge.rs` / `rebase.rs`，**不再扩 `engine.rs`**（行数已 1600+）
- 拖拽的语义**由弹窗让用户选**（合并 / 变基），避免默认行为猜错造成误操作

---

## 验证

- [x] `cd src-tauri && cargo check` + `cargo test` 通过
- [x] `npm run build` 类型检查通过
- [x] `npm run tauri dev` 完整跑：
  - FF / non-FF / squash merge — 正常与冲突各一遍
  - 非交互 rebase — 正常 + 冲突 continue/skip/abort
  - 交互 rebase — 覆盖 reword/squash/drop/reorder 四种动作
  - 拖拽 commit 到目标 — 触发弹窗后执行 merge 与 rebase
  - 脏工作区勾选自动 stash — 完整路径 + pop 冲突兜底
  - 横幅 — 各种中间态（merge / rebase）正确显示
- [x] 大仓库（≥1w commits）跑 50 步 rebase，UI 不卡顿
