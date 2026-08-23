# Modal 焦点与无障碍语义

## Context

公共 `Modal` 已支持最上层 Escape，但打开后不会把焦点移入对话框，Tab 可以离开弹窗，关闭后也不会恢复触发位置；容器缺少 dialog / modal / accessible name 语义。键盘用户可能在被遮罩的背景控件间移动而不知道当前焦点。

预期结果：公共 Modal 对齐 WAI-ARIA Modal Dialog Pattern，为所有现有弹窗统一提供可访问名称、焦点进入、Tab / Shift+Tab 循环和关闭后焦点恢复，同时保持嵌套弹窗的最上层规则。

## 进度总览

| 阶段 | 状态 | 内容 |
| --- | --- | --- |
| 现状与规范 | 已完成 | 核对公共 Modal 与 WAI-ARIA Modal Dialog Pattern |
| 语义与焦点 | 已完成 | 增加 dialog 语义、焦点进入 / 循环 / 恢复 |
| 测试与交付 | 已完成 | 单层、无控件和嵌套弹窗已覆盖，完整门禁通过 |

## 子任务清单

- [x] 阅读架构文档与公共 Modal 实现
- [x] 核对 WAI-ARIA 官方 Modal Dialog 键盘约定
- [x] 为 Modal 增加可访问名称与 modal 语义
- [x] 打开时聚焦首个可交互元素，无可交互元素时聚焦标题
- [x] 在最上层 Modal 内循环 Tab / Shift+Tab
- [x] 关闭或卸载时恢复打开前焦点
- [x] 覆盖焦点进入、循环、恢复和嵌套边界测试
- [x] 更新架构交互契约并执行完整门禁
- [x] 核对 staged diff，提交并推送 `dev`

## 关键决策

- 继续复用现有 Teleport + overlay 实现，不切换原生 `<dialog>`，避免改变所有弹窗的关闭、层级和样式契约。
- 焦点只由最上层可见 Modal 捕获；嵌套弹窗关闭后恢复到下层弹窗中的原触发控件。
- 优先聚焦已有可交互控件；没有控件时让标题成为程序化焦点目标，不把整个大尺寸 dialog 容器设为常规 Tab stop。
- 不自动注入关闭按钮；具体业务弹窗仍负责提供取消 / 关闭动作，Escape 与遮罩关闭行为保持现状。

## 验证方式

1. 从按钮打开含输入框的 Modal，确认焦点进入首个控件，Tab 在首尾循环。
2. 打开无交互控件的 Modal，确认标题获得程序化焦点并提供 accessible name。
3. 关闭 Modal，确认焦点恢复到打开前控件；嵌套 Modal 只约束最上层。
4. 运行 `npx vue-tsc --noEmit`、`npm run test`、`cd src-tauri && cargo check`、`cd src-tauri && cargo test`。
