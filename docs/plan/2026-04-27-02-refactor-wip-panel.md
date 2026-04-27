# WipPanel 重构方案

## Context

`src/components/workspace/WipPanel.vue` 当前超过 1000 行，集中了承载工作区文件列表、暂存/取消暂存/丢弃、批量操作、右键菜单、提交表单、Amend 回填、键盘导航和分栏拖拽等职责。该组件属于工作区核心路径，行为多且状态密集，后续继续叠加功能会提高回归风险。

本次重构目标是在不改变工作区用户可见行为和 IPC 契约的前提下，把文件操作、菜单状态、提交表单和布局控制拆成更小的 composable / 子组件，让 `WipPanel.vue` 专注于工作区页面编排。

预期结果：

- 文件操作与批量操作逻辑集中到 composable，减少模板附近的业务分支。
- 提交表单独立成组件，保留提交草稿、Amend 回填和快捷键行为。
- 分栏尺寸调整与列表键盘导航独立管理，降低后续改动影响面。
- 不修改 `WorkspaceStatus`、`FileEntry` 或现有 Git IPC 命令。

## 进度总览

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| 1 | 提取文件操作与批量操作 composable | 完成 |
| 2 | 提取右键菜单和批量菜单 composable | 完成 |
| 3 | 拆分提交表单与文件区子组件 | 部分完成 |
| 4 | 重组 `WipPanel.vue` 并保持交互一致 | 完成 |
| 5 | 类型检查、测试和手动工作区验证 | 自动验证完成，待手动验证 |

## 子任务清单

- [x] 创建 `src/composables/workspace/useWipFileActions.ts`
  - [x] 管理单文件 stage / unstage / discard。
  - [x] 管理 batch stage / unstage / discard。
  - [x] 保留刷新 workspace / history / diff 的现有顺序。
- [x] 创建 `src/composables/workspace/useWipMenus.ts`
  - [x] 管理文件右键菜单状态和菜单项。
  - [x] 管理批量选择菜单状态和菜单项。
  - [x] 保留复制路径、系统打开、编辑器打开、忽略文件等现有动作。
- [x] 创建 `src/components/workspace/WipCommitBox.vue`
  - [x] 承载提交信息输入、Amend、错误提示、提交按钮。
  - [x] 保留自动调整高度和提交快捷键。
- [ ] 创建 `src/components/workspace/WipFileSections.vue`
  - [ ] 承载 unstaged / staged 两段文件列表和 list / tree 切换。
  - [ ] 保留多选、键盘导航、展开/收起和列表 ref 接线。
- [x] 重组 `WipPanel.vue`
  - [x] 保留顶层标题、统计、分栏布局和危险操作确认弹窗。
  - [x] 保持当前 class 名或等价样式，避免视觉回归。
- [ ] 验证
  - [x] `npx vue-tsc --noEmit`
  - [x] `npm run test`
  - [x] `cd src-tauri && cargo check`
  - [ ] 手动验证 stage / unstage / discard / batch / amend / commit / 键盘导航。

## 关键决策

1. **不改变工作区数据流**：继续通过 `workspaceStore`、`historyStore`、`diffStore` 和 `useGitCommands` 驱动现有行为，不新增 store。
2. **先拆逻辑，再拆模板**：文件操作和菜单状态是最容易从组件中移出的部分，先拆这两块可降低后续组件拆分成本。
3. **提交表单单独组件化**：提交表单与文件列表状态耦合较低，独立后有利于维护 Amend、草稿和快捷键逻辑。
4. **保守处理列表热路径**：`FileChangeList` 已承担复杂列表交互，本次不改其内部实现，也不改变 row height / tree 视图行为。
5. **暂缓拆分 `WipFileSections.vue`**：文件列表区同时承载 `FileChangeList` 实例 ref、分栏拖拽、键盘导航滚动定位、展开/收起和多选回调。拆成子组件需要暴露多组 imperative 方法或传递过多 props/emits，短期会增加热路径接线复杂度；本轮保留在 `WipPanel.vue`，只完成逻辑拆分和提交表单组件化。

## 验证方式

1. 自动验证：
   - `npx vue-tsc --noEmit`
   - `npm run test`
2. 手动验证：
   - 修改、删除、新增、重命名文件后确认 unstaged / staged 分类正常。
   - 单文件和多文件 stage / unstage / discard 行为正常。
   - 右键菜单复制路径、打开文件、打开目录、忽略文件正常。
   - Amend 勾选、取消、提交信息回填和普通提交正常。
   - list / tree 切换、展开收起、键盘导航和分栏拖拽正常。
