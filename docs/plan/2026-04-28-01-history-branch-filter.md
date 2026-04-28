# 提交图分支显示过滤

## Context

历史图默认展示所有本地、远程、标签和 HEAD 可达提交，信息完整但在分支较多的大仓库里噪音较高。目标是增加两个低成本过滤能力：按当前 HEAD first-parent 链查看更干净的主线，以及隐藏远程分支来源和远程分支 chip。

该变更影响用户可见行为与 `get_log` IPC 契约，需要同步更新历史、提交图与 IPC 文档，并保持默认行为不变。

## 进度总览

| 阶段 | 状态 | 内容 |
| --- | --- | --- |
| 1 | 完成 | 后端 `get_log` 增加分支范围和远程引用参数 |
| 2 | 完成 | 前端 store、IPC 封装、Actions 菜单和设置页接入 |
| 3 | 完成 | 分支 chip 过滤、测试和文档更新 |

## 子任务清单

- [x] 新增 `LogBranchScope` 双端类型和 `get_log` 参数
- [x] 后端 revwalk 支持 `all` / `current_first_parent` 与远程引用过滤
- [x] 前端 `ui` store 持久化 `historyBranchScope`、`showRemoteBranches`
- [x] Actions 菜单和高级设置页加入对应控制项
- [x] `useCommitTags` 在隐藏远程分支时过滤远程 branch chip
- [x] 增加 Rust 与前端单元测试
- [x] 更新 `docs/04-history.md`、`docs/05-commit-graph.md`、`docs/11-ipc.md`、`README.md`
- [x] 运行类型检查、前后端测试和 Rust 编译检查

## 关键决策

- 默认仍为 `all + includeRemoteBranches=true`，保持当前全量 DAG。
- `current_first_parent` 只从 HEAD 起步并启用 first-parent 简化，用于主线浏览，不实现任意分支 solo。
- 隐藏远程分支同时影响日志来源和 branch chip；标签、HEAD、本地分支、stash、reflog 开关保持独立。
- 不在前端对日志做全量过滤，避免绕过分页和增量提交图计算。

## 验证方式

1. Rust 测试覆盖远程独有提交过滤和 first-parent 链过滤。
2. 前端测试覆盖 `useCommitTags` 远程 chip 过滤和 `historyStore.loadLog/loadMore` 参数传递。
3. 运行 `npx vue-tsc --noEmit`、`npm run test`、`cd src-tauri && cargo check`、`cd src-tauri && cargo test`。
