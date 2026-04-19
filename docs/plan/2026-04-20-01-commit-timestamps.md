# 提交时间戳编辑

## Context

Git 每个 commit 有两个时间戳：
- **Author Date**（`commit.author().when()`）：原始工作时间，`git log` 默认展示
- **Committer Date**（`commit.time()`）：写入仓库的时间，rebase/amend 会更新

现有问题：
1. `amend_commit_message` 和 `amend_commit` 对 author/committer 都用 `repo.signature()`（当前时间），导致 amend 后 **author date 被错误重置**，与 `git commit --amend` 默认行为不符（bug）
2. `CommitInfo` 只暴露 `time`（committer date），前端无法读取 author date
3. Edit Message 对话框没有时间编辑入口

预期结果：历史视图「修改提交信息」对话框对所有提交（HEAD + 非 HEAD）统一提供 author/committer 时间输入框，默认 author 保留原值、committer 更新为当前时间。

## 进度总览

| 阶段 | 范围 | 状态 |
|------|------|------|
| 1 | 数据结构：`CommitInfo.author_time`、`RebaseTodoItem` 新时间字段 | 已完成 |
| 2 | engine.rs：修 amend bug，`sig_with_time` 辅助，扩展时间参数 | 已完成 |
| 3 | rebase.rs：`run_rebase_loop` reword 分支支持自定义时间 | 已完成 |
| 4 | IPC + TS 层透传 | 已完成 |
| 5 | UI：Edit Message Dialog 加时间输入框 | 已完成 |
| 6 | i18n | 已完成 |
| 7 | 文档同步 | 已完成 |

## 子任务清单

- [x] `src-tauri/src/git/types.rs`：`CommitInfo` 加 `author_time: i64`；`RebaseTodoItem` 加 `new_author_time: Option<i64>`、`new_committer_time: Option<i64>`
- [x] `src/types/git.ts`：同步以上字段
- [x] `src-tauri/src/git/engine.rs`：`build_commit_info` 填 `author_time`；新增 `pub(crate) fn sig_with_time`；`amend_commit` 修 bug（author sig 改从原 commit 取）；`amend_commit_message` 加 `author_time: Option<i64>` / `committer_time: Option<i64>` 参数
- [x] `src-tauri/src/git/rebase.rs`：`run_rebase_loop` reword 分支使用 `new_author_time`/`new_committer_time` 构造自定义 sig
- [x] `src-tauri/src/commands/commit.rs`：`amend_commit_message` 命令加 `author_time: Option<i64>` / `committer_time: Option<i64>`
- [x] `src/composables/useGitCommands.ts`：`amendCommitMessage` 加可选 `authorTime?` / `committerTime?`
- [x] `src/stores/history.ts`：`amendCommitMessage` 透传时间
- [x] `src/views/HistoryView.vue`：Edit Message Dialog 加两个 `datetime-local` 输入框；HEAD/非 HEAD 路径均传时间
- [x] `src/i18n/locales/zh-CN.ts` / `en.ts`：`history.dialog.editMessage.authorDate` / `committerDate`
- [x] `docs/04-history.md`、`docs/11-ipc.md`、`docs/15-merge-rebase.md` 同步

## 关键决策

**做**：
- 时间编辑 UI 对所有提交（HEAD + 非 HEAD）统一显示，对称体验
- author_time 默认保留原值；committer_time 默认更新为当前时间（符合 git 惯例）
- 时区 offset 从原 signature 继承，UI 使用系统本地时间（`datetime-local` input 天然如此）
- 同步修复 WipPanel Amend 的 author date 被错误重置的 bug（`amend_commit`）
- `sig_with_time` 提取为 `pub(crate)` 辅助函数，供 `engine.rs` 和 `rebase.rs` 共用

**不做**：
- 不在 UI 暴露时区选择
- 不重命名现有 `CommitInfo.time` 字段（避免影响所有展示时间组件，后续单独清理）
- rebase reword 暂停恢复路径（`RebasePlanDialog` 手工 reword）不加时间输入

## 验证方式

1. HEAD commit 修改 message + 自定义两个时间：`git log --format="%ai %ci"` 验证
2. 非 HEAD commit 修改时间：rebase 后提交时间正确，后续提交不受影响
3. 只修改 message 不改时间：author_time 保留原值，committer_time ≈ 当前时间
4. WipPanel Amend：author_time 不再被重置（bug 回归验证）
5. 大仓库中段提交时间修改：rebase 正常完成
