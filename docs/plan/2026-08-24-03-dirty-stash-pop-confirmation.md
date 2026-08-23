# 脏工作区 Stash Pop 目标确认

## Context

GitUI 工具栏的 Pop 是恢复最新 stash 的快捷入口，但按钮只显示 stash 总数，不显示即将恢复的消息；当前工作区已有 staged / unstaged / untracked 改动时仍会立即叠加。用户往往到冲突发生后才知道选中了哪条 stash，也更难区分原有改动与刚恢复的内容。

GitKraken 同样提供一键 Pop 最新 stash；Git 官方文档明确 Pop 会把 stash 应用到当前工作树并在成功后删除，冲突时则保留 stash 等待手动处理。预期结果：clean 工作区继续一键 Pop；脏工作区先显示当前改动文件数、准确 stash 序号与消息，用户确认后再叠加。

## 进度总览

| 阶段 | 状态 | 内容 |
| --- | --- | --- |
| 竞品与现状核对 | 已完成 | 确认快捷 Pop 语义、冲突保留规则与当前上下文缺口 |
| Pop 流程 | 已完成 | 捕获 repo、stash OID / index 与工作区改动数 |
| 确认交互 | 已完成 | 脏工作区显示目标和叠加风险，clean 保持直接执行 |
| 文档与验证 | 已完成 | 已同步 Stash / IPC 文档与 README，全量检查通过 |

## 子任务清单

- [x] 核对工具栏、侧边栏、历史图 Stash Apply / Pop 入口
- [x] 核对 Git 官方冲突保留与 GitKraken 快捷 Pop 语义
- [x] 唯一路径统计 staged / unstaged / untracked 改动文件
- [x] clean 工作区保持直接 Pop 最新 stash
- [x] 脏工作区显示改动数、stash 序号和完整消息
- [x] 确认前校验 active repo 与 stash OID，目标变化时拒绝执行
- [x] 确认期间禁用关闭和重复提交
- [x] 覆盖 clean / dirty 判定、目标展示、确认与取消测试
- [x] 更新中英文文案、Stash 文档和 README
- [x] 执行格式化、类型检查、前后端全量测试与 Rust 编译检查
- [x] 核对 staged diff，准备提交并推送 `dev`

## 关键决策

- 只保护工具栏的“最新 stash 快捷 Pop”；侧边栏和历史图已经显式展示并选中目标，维持现有直接 Apply / Pop 效率。
- staged 与 unstaged 同时包含同一路径时只计一个文件，避免确认文案夸大影响范围。
- 挂起请求记录 stash commit OID 而不只记录 index，并作为 `stash_pop` 的 expected OID 交给后端原子校验；外部命令在确认期间改变 stash 栈时拒绝执行，避免 `stash@{0}` 悄悄指向另一条内容。
- 不把脏工作区一律禁用：叠加 stash 有合法用途，确认框提供知情继续而不是阻断高级工作流。
- Pop 冲突沿用 Git / libgit2 语义：stash 条目不删除，错误进入现有统一提示；本次不引入自动冲突解决。

## 验证方式

1. clean 工作区点击工具栏 Pop，确认不弹窗并直接恢复 `stash@{0}`。
2. staged / unstaged / untracked 存在时点击 Pop，确认弹窗按唯一路径计数并显示 stash 消息。
3. 点击取消或 Escape，确认工作区和 stash 栈不变。
4. 弹窗打开后从外部创建 / 删除 stash，再确认，确认旧请求被拒绝且不会误 Pop 新的 `stash@{0}`。
5. 确认执行并制造冲突，确认 stash 条目仍保留且统一错误提示可见。
6. 运行 `npx vue-tsc --noEmit`、`npm run test`、`cd src-tauri && cargo check`、`cd src-tauri && cargo test`。
