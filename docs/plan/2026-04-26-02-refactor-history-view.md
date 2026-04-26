# HistoryView 重构方案

## Context (背景与目标)
`src/views/HistoryView.vue` 目前代码行数超过 2300 行，承担了过多的职责：
- 虚拟列表渲染与滚动控制 (Virtual List)
- 复杂的面板拖拽与大小调整 (Pane Resizing, Dock Layout)
- 提交行的上下文菜单及对应操作 (Context Menu & Actions)
- 拖拽提交行以触发 Merge/Rebase 的逻辑 (Drag & Drop)
- 大量的模态框状态与逻辑 (Modals: Edit Message, Drop Unreachable 等)

过长的文件导致维护困难。目标是在不破坏任何现有功能（尤其是性能敏感的虚拟滚动、复杂的拖拽逻辑和 UI 响应）的前提下，将 `HistoryView.vue` 拆分为更小、职责更单一的组件和组合式函数 (Composables)。

## 进度总览

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| 1 | 梳理并提取逻辑到 Composables (Resize, DragDrop, ContextMenu) | 已完成 |
| 2 | 拆分 UI 组件 (CommitListHeader, 模态框等) | 已完成 |
| 3 | 在 `HistoryView.vue` 中组合使用并进行整体验证 | 已完成 |

## 子任务清单

- [x] **创建 `src/composables/history/useHistoryPanes.ts`**
  - 提取主面板分割线 (`startMainResize`, `mainResizeStyle`)
  - 提取次要分割线 (`startSecondaryResize`, `secondaryResizeStyle`)
  - 提取列宽调整逻辑 (`startColResize`, `COL_LIMITS`, `commitListMinWidth`)
- [x] **创建 `src/composables/history/useCommitContextMenu.ts`**
  - 提取 `commitMenu` 状态与 `commitMenuItems` 计算属性
  - 提取 `onCommitMenuAction` 中针对各个操作的逻辑（checkout, revert, reset 等）
  - 提取 `showEditMessageDialog`, `dropUnreachableDialog` 等关联的响应式状态和处理函数
- [x] **创建 `src/composables/history/useCommitDragDrop.ts`**
  - 提取拖拽合并/变基相关的逻辑 (`onCommitDragStart`, `onCommitDragOver`, `onCommitDrop`, `onCommitDragEnd`)
  - 提取 `showDragDialog` 相关的状态
- [x] **创建 `src/components/history/CommitListHeader.vue`**
  - 将表格头部 (Column headers) 抽离，接收宽度配置并处理调整列宽事件。
- [x] **重构 `HistoryView.vue`**
  - 引入上述 Composables 和子组件。
  - 清理精简原文件中的逻辑，使其成为一个专注于布局的 "Shell"。

## 关键决策

- **逻辑解耦优先于深度嵌套的组件拆分**：由于 `Virtual List` 的行渲染与主容器紧密耦合（涉及虚拟化库的滚动、测量等），强行拆分 `CommitListBody` 可能会带来性能隐患或滚动事件（如处理 Windows WebView2 的 wheel 事件）的破坏。因此决定**主干列表保留在主文件中**，优先抽离业务逻辑（Composables）和独立 UI 块（头部、模态框）。
- **保留所有响应式依赖**：为了降低回归风险，提取的 Composables 会接收必要的 store 或 ref 作为参数，或直接在 composable 内部调用 Pinia hooks。

## 验证方式
1. 编译验证：`npx vue-tsc --noEmit` 通过。
2. 端到端功能验证：
   - 面板拖拽调整大小是否正常。
   - 列宽调整是否正常。
   - 提交列表滚动（鼠标滚轮与拖动）是否正常。
   - 右键菜单弹出及操作（如 Copy SHA, 弹出对话框）是否正常。
   - 拖拽提交行以触发 Merge/Rebase 逻辑是否正常。
