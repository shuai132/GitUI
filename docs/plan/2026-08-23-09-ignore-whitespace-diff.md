# Diff 忽略空白变更

## Context

GitUI 的 Diff 已支持布局、Hunk 分组、完整文件上下文和词级高亮，但格式化、缩进调整或行尾空白会与真实逻辑修改同等突出。审阅大批自动格式化文件时，用户很难快速定位实质变化。

[GitHub Desktop 官方文档](https://docs.github.com/en/desktop/making-changes-in-a-branch/committing-and-reviewing-changes-to-your-project-in-github-desktop#choosing-how-to-display-diffs)把 Hide Whitespace Changes 与 Unified / Split 并列为 Diff 显示选项。

本阶段为 WIP 与历史提交的文本 Diff 增加“忽略所有空白差异”偏好。开关直接放在 Diff 工具栏，持久化到视图设置；切换后只重新加载当前文件，不刷新提交列表或整个仓库。

## 进度总览

| 阶段 | 状态 |
|------|------|
| 契约与交互设计 | 已完成 |
| 实现与测试 | 已完成 |
| 构建与回归验证 | 已完成 |

## 子任务清单

- [x] 核对 GitHub Desktop 的空白过滤入口与语义
- [x] 核对 WIP / 历史 Diff 的加载、缓存和完整文件数据流
- [x] 扩展两个文件 Diff IPC 的空白过滤参数
- [x] 使用 libgit2 DiffOptions 忽略所有空白差异
- [x] UI store 持久化偏好并纳入视图设置重置
- [x] Diff 工具栏增加状态明确的切换按钮
- [x] 切换时只强制重载当前 WIP 或历史文件并处理竞态
- [x] 补充后端过滤、前端参数与持久化测试
- [x] 同步 Diff、IPC 文档与 README
- [x] 完成前后端全量检查

## 关键决策

- 采用 libgit2 `ignore_whitespace(true)`，语义是忽略所有空白差异，而不是只忽略行尾空白；工具提示明确说明范围。
- 默认关闭并跨会话持久化；开关状态适用于全部仓库，与现有 Diff 布局偏好一致。
- 文件列表和提交级变更统计保持原始 Git 结果，只过滤当前文件的正文与正文增删统计；纯空白文件仍留在变更列表，正文显示无内容变更。
- 切换只重拉当前文件，不重新获取工作区状态或提交详情；后端仍是单文件 pathspec，避免放大大仓库成本。
- 图片和文档预览不展示该开关；SVG 切到文本模式后可使用。
- Hunk 操作基于当前可见 Hunk。忽略空白时，被过滤掉的 Hunk 不可暂存、放弃或回滚，避免“隐藏内容却仍可操作”的歧义。

## 验证方式

1. 制造仅缩进 / 行尾空白变化，开启开关后确认正文为空，关闭后恢复原 Hunk。
2. 同一文件同时包含空白与逻辑变化，开启后确认逻辑 Hunk 保留。
3. 分别在 WIP staged / unstaged 与历史提交中切换，确认当前文件重载且快速连续切换不会被旧响应覆盖。
4. 重启 store、使用设置页恢复默认值，确认偏好持久化和重置正确。
5. 运行 `npx vue-tsc --noEmit`、`npm run test`、`cd src-tauri && cargo check`、`cd src-tauri && cargo test`。

验证结果：前端 216 个、后端 82 个测试通过，TypeScript 类型检查和 Rust 编译检查通过。
