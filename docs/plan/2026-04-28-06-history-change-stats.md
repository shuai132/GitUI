# 历史列表变更规模列

## Context

历史列表当前只展示提交信息、作者和日期，无法快速判断一个提交是小改动、大规模代码改动，还是包含大二进制文件。目标是在不拖慢 `get_log` 分页和虚拟滚动的前提下，为历史列表增加一个轻量的「变更」列，展示文件数、增删行数，并标出二进制/大文件风险。

## 进度总览

| 阶段 | 内容 | 状态 |
|------|------|------|
| P1 | 后端统计契约与 IPC | 已完成 |
| P2 | 前端缓存与懒加载 | 已完成 |
| P3 | 历史列表 UI | 已完成 |
| P4 | 文档与验证 | 已完成 |

## 子任务清单

- [x] 新增 `CommitChangeStats` 类型和 `get_commit_change_stats` IPC。
- [x] 后端按提交 first parent 计算文件数、增删行、二进制文件数和大文件指标。
- [x] 前端 `historyStore` 增加 stats 缓存、请求去重和批量懒加载。
- [x] 历史列表新增可拖拽「变更」列，展示 `files +add -del` 与 `BIN` / `BIG` badge。
- [x] WIP 行同列展示当前工作区变更规模。
- [x] 更新 `docs/04-history.md`、`docs/11-ipc.md` 和 README。
- [x] 增加单元测试并通过前后端检查。

## 关键决策

- 不把统计塞进 `get_log` / `CommitInfo`，避免历史首屏和分页路径为每页提交额外展开 diff。
- 统计由前端按虚拟列表可见提交批量懒加载并缓存；同一提交只请求一次，失败不阻塞列表。
- 大文件阈值 v1 固定为 1 MiB，不先做设置项。
- merge commit 只对 first parent 统计，和普通 Git 历史审查语义保持一致。
- stash 统计沿用现有提交详情语义：除 parent[0] 对比外，补上 untracked parent。

## 验证方式

1. `npx vue-tsc --noEmit`
2. `npm run test`
3. `cd src-tauri && cargo check`
4. `cd src-tauri && cargo test`
5. 手动打开大仓库，滚动历史列表确认统计按需出现，列表滚动无明显卡顿；选择含二进制/大文件的提交确认 badge 与详情文件列表一致。
