# CommitInfoPanel 重构方案

## Context

`src/components/history/CommitInfoPanel.vue` 当前接近 800 行，承担提交元信息展示、文件列表 / 文件树切换、虚拟滚动、文件右键菜单、文件 tab 菜单、上下面板尺寸调整等职责。它位于历史详情区，是 `HistoryView` 后续瘦身的关键依赖。

本次重构目标是在保持提交详情行为不变的前提下，把文件列表和菜单逻辑拆出，降低 `CommitInfoPanel.vue` 的复杂度。

预期结果：

- 提交元信息与文件列表渲染解耦。
- 文件树 / 列表显示、展开状态和虚拟滚动集中到独立组件。
- 文件右键菜单逻辑独立，便于与工作区文件菜单复用思路对齐。
- 不修改提交 diff 数据结构或历史视图数据流。

## 进度总览

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| 1 | 提取提交文件显示数据与展开状态 | 完成 |
| 2 | 提取文件菜单逻辑 | 完成 |
| 3 | 拆分提交文件列表组件 | 完成 |
| 4 | 重组 `CommitInfoPanel.vue` | 完成 |
| 5 | 类型检查、测试和提交详情手动验证 | 自动验证完成，手动待验证 |

## 子任务清单

- [x] 创建 `src/composables/history/useCommitFileItems.ts`
  - [x] 管理 list / tree 视图模式。
  - [x] 管理展开目录、全部展开 / 收起。
  - [x] 生成用于虚拟滚动的 display items。
- [x] 创建 `src/composables/history/useCommitFileMenu.ts`
  - [x] 管理文件行右键菜单和文件 tab 菜单。
  - [x] 保留复制路径、打开文件历史、打开 blame 等动作。
- [x] 创建 `src/components/history/CommitFileList.vue`
  - [x] 承载文件 list / tree 切换、虚拟滚动和行渲染。
  - [x] 通过 emit 通知选择文件、打开上下文菜单。
- [x] 重组 `CommitInfoPanel.vue`
  - [x] 保留提交作者、提交信息、面板尺寸调整和顶层布局。
  - [x] 将文件列表和菜单接线交给新模块。
- [ ] 验证
  - [x] `npx vue-tsc --noEmit`
  - [x] `npm run test`
  - [x] `cd src-tauri && cargo check`
  - [ ] 手动验证提交详情、文件切换、文件树、右键菜单和文件历史入口。

## 关键决策

1. **文件列表组件只负责展示和选择**：打开文件历史、blame、路径操作等仍由 composable 协调，避免列表组件直接耦合太多 store。
2. **保留虚拟滚动实现**：继续使用当前虚拟滚动策略和行高设置，不更换依赖。
3. **不新增 IPC 或 store 契约**：本次只移动前端组织结构，不改变 `CommitWithFiles` / `FileDiff` 等类型。

## 验证方式

1. 自动验证：
   - `npx vue-tsc --noEmit`
   - `npm run test`
2. 手动验证：
   - 选择包含大量文件变更的提交，确认文件列表滚动流畅。
   - 切换 list / tree，展开收起目录正常。
   - 选择文件后右侧 diff 正常刷新。
   - 文件右键菜单和文件 tab 菜单行为正常。
