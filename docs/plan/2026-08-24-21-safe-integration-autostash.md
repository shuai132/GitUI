# Safe Integration Autostash

## Context

Pull 已在自动 stash 后检查仓库状态，只有操作结束且仓库回到 clean 才恢复原始改动；Merge 与 Rebase 仍会在 `finally` 中无条件 pop。若集成操作停在冲突中，原始改动会被叠加到未完成的工作区，增加冲突复杂度和误操作风险。目标是统一三个入口的自动 stash 生命周期，在中间态或状态不可确认时保留 stash，并让用户明确知道需要稍后手动恢复。

## 进度总览

| 阶段 | 状态 | 内容 |
| --- | --- | --- |
| 方案与契约 | 已完成 | 抽取通用自动 stash 生命周期 |
| Merge / Rebase 接入 | 已完成 | clean 时恢复，中间态时保留 |
| 提示与刷新 | 已完成 | 明确恢复结果并刷新 Stash 列表 |
| 测试与文档 | 已完成 | 覆盖成功、冲突、状态未知与恢复失败 |
| 全量验证 | 已完成 | 前后端类型、测试和编译检查 |

## 子任务清单

- [x] 把 Pull 专用 helper 抽为通用自动 stash 生命周期
- [x] Merge / Rebase 仅在仓库确认 clean 后 pop
- [x] 自动恢复使用 `stash_push` 返回的精确 OID，拒绝误 pop 新插入的条目
- [x] 保留 stash 时向用户说明原因和后续动作
- [x] 自动 stash 后同步刷新 Stash 列表
- [x] 增加通用 helper 与 store 集成测试
- [x] 更新 `docs/15-merge-rebase.md` 与 `docs/11-ipc.md`
- [x] 完成格式化、类型检查、前后端全量测试与编译检查

## 关键决策

- stash 创建失败仍直接中止操作；只有确认 stash 成功后才进入集成操作。
- `stash_push` 返回新建 stash 的 commit OID，恢复时由既有 `expected_oid` 契约复核 `stash@{0}`，外部插入新条目时不碰错误目标。
- 集成操作成功或失败后都查询 `RepoState`；只有 `clean` 才尝试 pop，Merge / Rebase / Revert 等中间态和状态查询失败都保留 stash。
- pop 失败不丢弃 stash，向用户展示恢复失败；集成操作本身的错误与 stash 恢复说明同时保留。
- 不自动在 Continue / Abort 后恢复此前保留的 stash，避免跨应用重启维护隐式状态；用户从可见的 Stash 列表显式恢复。

## 验证方式

- 脏工作区发起无冲突 Merge / Rebase，确认顺序为 stash → 操作 → 状态检查 → pop。
- 制造 Merge / Rebase 冲突，确认不调用 pop，stash 条目仍可见，错误说明原始改动已保留。
- 模拟状态查询与 pop 失败，确认不掩盖原操作结果且 Stash 列表刷新。
- 运行目标 Vitest、`npx vue-tsc --noEmit`、`npm run test`、`cargo fmt`、`cargo check`、`cargo test`。
