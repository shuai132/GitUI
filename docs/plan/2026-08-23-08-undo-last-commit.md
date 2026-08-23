# 撤销刚完成的本地提交

## Context

GitUI 已支持通过历史提交右键菜单执行 Reset，但用户刚提交后发现漏文件、分组错误或信息不合适时，需要离开工作区、定位父提交并理解 Reset 模式。高频纠错动作被暴露成了高级历史操作。

[GitHub Desktop 官方文档](https://docs.github.com/en/desktop/managing-commits/undoing-a-commit-in-github-desktop)把未推送提交的 Undo 放在 Changes 页底部，并明确恢复提交改动到工作目录；[GitKraken 官方文档](https://help.gitkraken.com/gitkraken-desktop/undo-and-redo/)也把 Commit 列为一级 Undo 能力。

本阶段在 GitUI 工作区状态中保留“刚由当前窗口创建的提交”上下文，并在顶部工具栏提供一次点击撤销入口。后端原子校验预期 HEAD、当前分支与上游发布状态后执行 mixed reset，避免复用通用 Reset 时因状态变化误回退更多提交。

## 进度总览

| 阶段 | 状态 |
|------|------|
| 契约与安全边界 | 已完成 |
| 实现与测试 | 已完成 |
| 构建与回归验证 | 已完成 |

## 子任务清单

- [x] 对比同类产品的提交撤销交互与安全约束
- [x] 核对现有提交、状态刷新与 Reset 数据流
- [x] 新增带预期 HEAD 校验的撤销提交 IPC
- [x] 阻止撤销游离、根提交、HEAD 已变化或已发布提交
- [x] 顶部工具栏展示仅针对最近成功提交的 Undo 入口
- [x] 撤销后恢复原提交信息草稿并回到 WIP
- [x] 补充 Rust 安全边界与前端交互测试
- [x] 同步工作区、IPC 文档与 README
- [x] 完成前后端全量检查

## 关键决策

- 只撤销当前窗口刚成功创建的普通提交；Amend 不进入候选，应用重启后也不恢复候选。
- 后端接收 `expected_head` 并在同一次仓库操作中重新读取 HEAD；HEAD 不一致时拒绝，不能让过期 UI 回退新的提交。
- 只允许单父提交且 HEAD 必须位于本地分支；根提交和游离 HEAD 不走隐式建删引用流程。
- 若本地已知 upstream 已包含目标提交，则拒绝改写已发布历史，并引导用户使用 Revert。
- 使用 mixed reset：提交中的改动回到未暂存工作区，便于重新选择、编辑和提交；不丢弃文件内容。
- Undo 候选在切换仓库、HEAD 变化、再次提交或成功撤销时清除。

## 验证方式

1. 创建一个未推送的普通提交，确认顶部工具栏出现 Undo，点击后 HEAD 回到父提交、改动进入未暂存区、原提交信息恢复为草稿。
2. 修改 HEAD、切换仓库或再次提交，确认旧 Undo 候选不可继续执行。
3. 让 upstream 指向待撤销提交，确认后端拒绝并保持 HEAD 不变。
4. 对根提交、游离 HEAD 和错误 `expected_head` 运行后端测试，确认安全拒绝。
5. 运行 `npx vue-tsc --noEmit`、`npm run test`、`cd src-tauri && cargo check`、`cd src-tauri && cargo test`。

验证结果：前端 211 个、后端 80 个测试通过，TypeScript 类型检查和 Rust 编译检查通过。
