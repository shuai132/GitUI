# ContextMenu 键盘导航与语义

## Context

公共 `ContextMenu` 容器声明了 `role="menu"`，但菜单项仍是不可聚焦的普通 `div`，键盘只能用 Escape 关闭，无法用方向键定位或用 Enter 执行动作；子菜单也没有 menu 语义。菜单快速开关时，延迟注册的 document listener 还可能在关闭后残留。

预期结果：对齐 WAI-ARIA Menu Pattern，为根菜单与二级菜单提供 menuitem / separator 语义、初始焦点、方向键循环、Home / End、Enter / Space、左右键子菜单导航和 Escape 关闭，并可靠清理延迟监听。

## 进度总览

| 阶段 | 状态 | 内容 |
| --- | --- | --- |
| 现状与规范 | 已完成 | 核对 ContextMenu 与 WAI-ARIA Menu Pattern |
| 导航与语义 | 已完成 | 增加 roving focus、键盘动作与子菜单语义 |
| 测试与交付 | 已完成 | 覆盖根菜单、disabled、子菜单与监听清理 |

## 子任务清单

- [x] 阅读公共 ContextMenu 与既有测试
- [x] 核对 WAI-ARIA 官方 Menu / Menu Button 键盘约定
- [x] 为根菜单、子菜单、菜单项与分隔线补齐角色和状态
- [x] 打开时聚焦第一个可用项
- [x] 支持方向键、Home / End、Enter / Space 与 Escape
- [x] 支持 ArrowRight 打开子菜单、ArrowLeft 返回父菜单
- [x] 清理快速关闭前尚未执行的 listener timer
- [x] 覆盖键盘与清理回归，更新架构文档并执行完整门禁
- [x] 核对 staged diff，提交并推送 `dev`

## 关键决策

- 保留现有 Teleport、定位与 hover 子菜单机制，不引入浮层依赖。
- 菜单项统一使用程序化焦点（`tabindex=-1`）；Tab 关闭菜单，方向键在菜单内部循环，符合桌面菜单习惯。
- disabled 项保留在可访问树中并暴露 `aria-disabled`，但跳过键盘焦点和执行。
- 行尾辅助动作继续保留原视觉结构；ArrowRight 从主项进入该按钮，ArrowLeft 返回主项。

## 验证方式

1. 打开含 disabled / separator 的菜单，确认首个可用项获得焦点，方向键跳过不可用项并循环。
2. 用 Home / End 定位首尾，Enter / Space 执行动作并关闭。
3. 用 ArrowRight 打开二级菜单并聚焦首项，ArrowLeft 返回父项，Escape 关闭。
4. 在延迟监听注册前关闭菜单，确认后续外部 pointerdown 不重复触发 close。
5. 运行 `npx vue-tsc --noEmit`、`npm run test`、`cd src-tauri && cargo check`、`cd src-tauri && cargo test`。
