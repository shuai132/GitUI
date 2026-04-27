# HistoryView 后续重构方案

## Context

`src/views/HistoryView.vue` 已经完成过一轮重构，抽出了面板尺寸、提交菜单、拖拽操作和列表头部等模块，但文件仍有 1700 多行。当前剩余体量主要来自历史虚拟列表、WIP 入口、提交选择、键盘导航、详情区组合、冲突入口和多个弹窗挂载。

历史视图是性能敏感的核心页面，不能为了瘦身破坏虚拟滚动、分页加载、Windows WebView2 wheel 兼容处理或提交选择语义。本次后续重构只移动边界清晰、风险可控的逻辑。

预期结果：

- `HistoryView.vue` 继续瘦身，主文件聚焦列表容器、布局和数据接线。
- 提交 / WIP 选择、键盘导航、详情区和弹窗挂载分离。
- 保留现有虚拟列表主体和滚动性能策略。
- 不修改历史日志 IPC、提交图算法或 `historyStore` 对外契约。

## 进度总览

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| 1 | 提取选择与 WIP 虚拟索引逻辑 | 待办 |
| 2 | 提取键盘导航逻辑 | 待办 |
| 3 | 提取详情区组合组件 | 待办 |
| 4 | 提取历史视图弹窗挂载组件 | 待办 |
| 5 | 类型检查、测试和历史视图手动验证 | 待办 |

## 子任务清单

- [ ] 创建 `src/composables/history/useHistorySelection.ts`
  - [ ] 管理 `toVirtualIdx` / `toRealIdx`。
  - [ ] 管理 WIP 行选择、提交行选择、当前选中 virtual index。
  - [ ] 保留 showWipRow 变化时的选择修正。
- [ ] 创建 `src/composables/history/useHistoryKeyboard.ts`
  - [ ] 管理 commits / files 活跃面板。
  - [ ] 管理上下移动、左右切换、文件选择快捷键。
  - [ ] 保留现有快捷键语义和 preventDefault 条件。
- [ ] 创建 `src/components/history/HistoryDetailPane.vue`
  - [ ] 组合 `WipPanel`、`CommitInfoPanel`、`DiffView`、`ConflictView`。
  - [ ] 接收当前 diff、当前冲突路径、详情显示状态等必要 props。
- [ ] 创建 `src/components/history/HistoryDialogs.vue`
  - [ ] 承载 merge / rebase / drag action / file history 等弹窗挂载。
  - [ ] 通过 emit 把执行结果交回父级刷新。
- [ ] 重组 `HistoryView.vue`
  - [ ] 保留虚拟列表渲染、滚动容器、分页触发和 wheel 兼容逻辑。
  - [ ] 保留提交行模板在主文件，除非拆分不会增加热路径复杂度。
- [ ] 验证
  - [ ] `npx vue-tsc --noEmit`
  - [ ] `npm run test`
  - [ ] 大仓库下滚动、分页、搜索、选择、详情切换、拖拽 merge / rebase。

## 关键决策

1. **不拆虚拟列表主体**：提交列表是历史页热路径，当前 plan 不强行拆 `CommitListBody`。只有在 props 简洁、无性能疑虑时才考虑后续拆分。
2. **优先拆低风险组合层**：选择、键盘和弹窗逻辑与 DOM 性能关系较弱，适合作为本轮目标。
3. **保留既有 composable 边界**：继续沿用 `useHistoryPanes`、`useCommitContextMenu`、`useCommitDragDrop`，不做大规模重命名。
4. **不改历史领域契约**：不触碰 revwalk、commit graph、分页加载和 IPC 数据结构。

## 验证方式

1. 自动验证：
   - `npx vue-tsc --noEmit`
   - `npm run test`
2. 手动验证：
   - 在几千提交以上仓库中滚动历史，确认不卡顿、不跳行。
   - 搜索提交、选择 WIP、选择普通提交和切换文件详情正常。
   - 键盘上下移动、提交区和文件区切换正常。
   - 右键菜单、拖拽 merge / rebase、文件历史弹窗正常。
   - 横向 / 纵向布局和面板拖拽尺寸持久化正常。
