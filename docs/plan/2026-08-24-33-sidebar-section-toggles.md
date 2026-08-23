# 侧栏分区折叠按钮统一

## Context

本地分支、远端、Tag、Submodule 和 Stash 的 section 标题都在含有搜索 / 新增控件的外层 `div` 上处理 click。折叠入口无法键盘聚焦，且把多个交互控件嵌在同一个隐式点击区域，语义和事件边界不清晰。

预期结果：五个 section 将折叠区域拆为独立原生按钮，暴露 `aria-expanded`；搜索、右键菜单与新增按钮保持独立，hover-only 新增按钮在键盘焦点进入 section 时也可见。

## 进度总览

| 阶段 | 状态 | 内容 |
| --- | --- | --- |
| 现状核对 | 已完成 | 核对五个 section 标题与共享样式 |
| 统一实现 | 已完成 | 拆分折叠按钮和辅助控件 |
| 测试与交付 | 已完成 | 覆盖按钮语义、状态与切换，执行完整门禁 |

## 子任务清单

- [x] 阅读侧栏五个 section 及相关设计文档
- [x] 本地分支、远端、Tag、Submodule、Stash 使用独立折叠按钮
- [x] 折叠按钮暴露展开状态并提供 focus-visible 样式
- [x] 新增按钮在 section focus-within 时可见
- [x] 保留 section 右键菜单、搜索自动展开与新增动作
- [x] 补充回归并执行完整门禁
- [x] 更新设计文档，核对 staged diff，提交并推送 `dev`

## 关键决策

- 不给含嵌套控件的标题 `div` 添加 `role=button`，而是使用独立原生按钮，避免交互元素嵌套。
- 保留各业务组件当前数据与事件，不抽象新组件；五个标题结构简单且业务辅助控件不同，共享样式足以维持一致性。
- 新增按钮使用透明度控制而非 `display:none`，使其仍可进入键盘 Tab 顺序，并在 `focus-within` 时显现。

## 验证方式

1. 依次聚焦五个 section 的折叠按钮，确认 Enter / Space 切换且 `aria-expanded` 同步。
2. 在 Remote / Submodule section 用 Tab 聚焦新增按钮，确认按钮显现且动作不触发折叠。
3. 确认搜索控件、Tag / Remote section 右键菜单继续生效。
4. 运行 `npx vue-tsc --noEmit`、`npm run test`、`cd src-tauri && cargo check`、`cd src-tauri && cargo test`。
