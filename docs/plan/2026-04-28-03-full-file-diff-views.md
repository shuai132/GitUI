# Diff 布局与 Hunk 分组选项方案

## Context

当前 diff 查看模式把 `inline`、`side-by-side`、`by-hunk` 混在同一个枚举里。更准确的产品模型是：`inline` / `side-by-side` 是布局，按 hunk 分组是独立选项。关闭分组时显示完整文件，开启分组时按变更块聚焦阅读。

预期结果：
- `inline` 和 `side-by-side` 都支持完整文件显示。
- `inline` 和 `side-by-side` 都支持按 hunk 分组。
- 新用户默认使用 `inline + 按 hunk 分组`，并可在设置页调整。
- 旧版 `by-hunk` 偏好迁移为 `inline + 按 hunk 分组`。
- 切换布局或 hunk 分组选项时，尽量保持当前顶部行号起始点。
- 大文件沿用现有原始内容读取阈值，读取失败或超限时回退到 hunk 视图，避免明显性能损失。

## 进度总览

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| 1 | 计划与上下文确认 | 完成 |
| 2 | 完整文件 diff 行构造工具与测试 | 完成 |
| 3 | 接入 inline / side-by-side 视图与 hunk 分组选项 | 完成 |
| 4 | 文档更新与验证 | 完成 |

## 子任务清单

- [x] 新增完整文件 diff 行构造工具，复用到 inline / side-by-side。
- [x] 为新增工具补充前端单元测试。
- [x] 在 `DiffView` 中按需加载旧 / 新两侧完整文本。
- [x] `InlineDiff` 连续模式接入完整文件 rows，按 hunk 分组时保持块视图。
- [x] `SideBySideDiff` 接入完整文件 rows，并支持按 hunk 分组回退到 hunk-only。
- [x] 将 diff 偏好拆为布局模式和按 hunk 分组开关，并兼容旧版 `by-hunk`。
- [x] 设置默认值为 `inline + 按 hunk 分组`，并在设置页展示这两项。
- [x] 切换布局 / hunk 分组时按顶部旧 / 新侧行号恢复滚动位置。
- [x] 更新 `docs/06-diff-viewer.md` 与 `README.md`。
- [x] 运行前端类型检查、前端测试、Rust check 与 Rust 测试。

## 关键决策

- 不修改 IPC 契约和 `FileDiff` 结构。完整内容通过已有 `get_blob_bytes` / `read_worktree_file` 按需获取，避免让文件列表、提交摘要等路径变重。
- 按 hunk 分组不再是第三种布局，而是独立开关。布局和分组分别持久化。
- 新用户默认启用按 hunk 分组并使用单列布局；已有旧版偏好按兼容规则迁移。
- 完整文件内容沿用现有 10MB 读取阈值。超限或读取失败时，视图自动回退到当前 hunk-only 结果。
- 本次不引入虚拟滚动。若后续真实大文件场景仍有明显 DOM 渲染压力，再独立评估。

## 验证方式

- `npx vue-tsc --noEmit`
- `npm run test`
- `cd src-tauri && cargo check`
- `cd src-tauri && cargo test`
- 手动验证 WIP 未暂存、已暂存、提交详情 diff：`inline` / `side-by-side` 关闭分组时显示完整文件，开启分组时均显示 hunk 视图。
