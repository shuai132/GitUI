# 编辑任意提交的 Commit Message（rebase 驱动）

## Context

当前历史视图右键菜单的「修改提交信息…」只对 HEAD 开放，走 `amend_commit_message` 快速路径。编辑历史中间提交必须手动打开 `RebasePlanDialog`、挑到目标项改 `reword`、再填消息提交——操作繁琐且用户不一定知道这条路径。

本次让右键菜单对任意祖先提交都能直接编辑消息，底层复用交互式 rebase 基础设施：构造 `parent..HEAD` 的 todo，目标设为 `reword` 且 `new_message` 预填。`run_rebase_loop` 里 `new_message` 预填时直接 commit、不暂停，整个过程对用户透明。

HEAD 仍走 `amend_commit_message`，避开 rebase 对脏工作区的拒绝和重播的性能代价。

## 进度总览

| 阶段 | 范围 | 状态 | 依赖 |
|---|---|---|---|
| 1 | HistoryView 菜单条件与祖先判定 | 已完成 | — |
| 2 | 编辑对话框加 auto-stash 勾选 | 已完成 | 1 |
| 3 | 分发逻辑 + todo 构造 | 已完成 | 1, 2 |
| 4 | i18n / docs / README 同步 | 已完成 | 3 |

## 子任务清单

- [x] `src/views/HistoryView.vue::commitMenuItems`：`editMessage` 改为禁用当且仅当——`is_unreachable` / `mergeRebaseStore.isOngoing` / `parent_oids.length !== 1`（排除根与合并）/ 非 HEAD 祖先。stash 走独立菜单，天然不出现
- [x] `isAncestorOfHead(oid)`：基于 `historyStore.commits` 做 parent_oids BFS，HEAD 自指为 true
- [x] 编辑对话框非 HEAD 时显示 `autoStash` 勾选与 `rewordHint` 提示
- [x] `onEditMessageConfirm` 分发：HEAD → `historyStore.amendCommitMessage(msg)`；非 HEAD → `git.rebasePlan(parent, null)` 得 todo，目标项替换为 `reword` + `new_message`，调 `mergeRebaseStore.startRebase(parent, null, todo, autoStash)`
- [x] i18n（`zh-CN.ts` / `en.ts`）：`history.dialog.editMessage.{rewordHint, autoStash}`、`errors.rebase.planMismatch`
- [x] `docs/04-history.md`：右键菜单表补「修改提交信息...」条目
- [x] `docs/15-merge-rebase.md`：入口表加一行
- [x] `README.md`：提交操作条目加入"修改提交信息"

## 关键决策

**做**：
- HEAD 保留 amend 快速路径；非 HEAD 走 rebase `reword`
- 对话框加 `autoStash` 勾选，复用 `mergeRebaseStore.startRebase` 现有 auto-stash 逻辑
- 禁用合并提交（rebase 线性化丢合并语义）、根提交（`rebase_start` 不支持 `--root`）、非 HEAD 祖先（避免改写其他分支）
- 祖先判定放前端 BFS，不新增后端命令

**不做**：
- 不对已推送提交做 force-push 警告（与现有 reset/rebase 一致）
- 不改后端 `rebase_start` / `amend_commit_message`

## 验证方式

1. 回归：HEAD 编辑仍走 amend，历史刷新正常
2. 线性中段提交编辑：message 更新、后续提交 oid 重播
3. 脏工作区 + 勾选 auto-stash：自动恢复
4. 脏工作区 + 不勾选：错误提示
5. 冲突路径：`OngoingOpBanner` 接管 continue/skip/abort
6. 禁用态：合并提交 / 根提交 / 非祖先 / ongoing op / stash / unreachable 均灰
7. 性能：约 1w 提交仓库中段编辑不卡
