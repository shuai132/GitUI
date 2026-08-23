# 文件历史弹窗统一焦点契约

## Context

`FileHistoryModal` 自行实现遮罩、Escape 与顶层弹窗判断，但没有 modal dialog 语义、初始焦点、Tab 焦点边界和关闭后的触发点恢复；同类能力已经由公共 `Modal` 统一提供，继续保留两套实现会让键盘行为分叉。

预期结果：文件历史 / Blame 弹窗复用公共 `Modal`，保留现有尺寸、标签页、分栏拖动、异步请求隔离与 tooltip，同时继承统一的顶层 Escape、焦点循环和焦点恢复行为。

## 进度总览

| 阶段 | 状态 | 内容 |
| --- | --- | --- |
| 现状核对 | 已完成 | 核对文件历史弹窗与公共 Modal 契约 |
| 结构统一 | 已完成 | 移除重复遮罩 / 键盘代码并接入公共 Modal |
| 测试与交付 | 已完成 | 覆盖语义、焦点与 Escape，执行完整门禁 |

## 子任务清单

- [x] 阅读文件历史与公共 Modal 实现、测试和相关设计文档
- [x] 用公共 Modal 承载文件历史内容
- [x] 保留 `min(1100px, 94vw)` × `min(720px, 90vh)` 布局与无内边距内容区
- [x] 为弹窗提供随当前标签变化的可访问名称
- [x] 删除重复的 Escape / topmost listener
- [x] 让提交记录使用原生按钮并暴露选中状态
- [x] 覆盖 dialog 语义、初始焦点、Tab 边界与 Escape 回归
- [x] 更新历史设计文档并执行完整门禁
- [x] 核对 staged diff，提交并推送 `dev`

## 关键决策

- 不在 `FileHistoryModal` 复制公共焦点管理逻辑，统一由 `Modal` 维护嵌套层级与焦点恢复。
- 使用公共 Modal 的 header slot 保留原有标签栏、路径和关闭按钮，不改变数据加载和业务状态。
- 通过专用 body class 覆盖内容区 padding / overflow，不扩大公共 Modal 的样式 API。

## 验证方式

1. 从可聚焦触发控件打开弹窗，确认第一个标签按钮获得焦点且存在 dialog / aria-modal 语义。
2. 在首尾控件使用 Shift+Tab / Tab，确认焦点留在弹窗中。
3. 按 Escape 仅关闭最上层弹窗，关闭后焦点回到触发控件。
4. 切换仓库和文件路径，确认旧 File History / Blame 响应仍不会覆盖新上下文。
5. 运行 `npx vue-tsc --noEmit`、`npm run test`、`cd src-tauri && cargo check`、`cd src-tauri && cargo test`。
