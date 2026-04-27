# DiffView 重构方案

## Context

`src/components/diff/DiffView.vue` 当前 600 多行，作为 diff 主入口承担模式切换、搜索、hunk 跳转、hunk revert、图片 / SVG 分流和 toolbar 渲染。文件尚未失控，但它是 WIP diff 和提交 diff 的共享入口，继续增长会影响两个路径的维护。

本次重构目标是在保持 diff 展示模式和用户操作不变的前提下，把 toolbar、搜索状态和 hunk revert 逻辑拆出，使主组件更像渲染调度器。

预期结果：

- `DiffView.vue` 聚焦选择渲染器：inline / side-by-side / by-hunk / image。
- 搜索逻辑独立为 composable，继续响应全局 diff search signal。
- toolbar 独立组件化，减少主模板复杂度。
- 不修改 `FileDiff` 数据结构、diff IPC 或子渲染组件行为。

## 进度总览

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| 1 | 提取 diff 搜索 composable | 待办 |
| 2 | 提取 hunk revert 逻辑 | 待办 |
| 3 | 拆分 `DiffToolbar.vue` | 待办 |
| 4 | 重组 `DiffView.vue` | 待办 |
| 5 | 类型检查、测试和 diff 手动验证 | 待办 |

## 子任务清单

- [ ] 创建 `src/composables/diff/useDiffSearch.ts`
  - [ ] 管理搜索展开、输入聚焦、查询变更、next / previous。
  - [ ] 保留 `uiStore.openDiffSearchSignal` 行为。
- [ ] 创建 `src/composables/diff/useRevertHunk.ts`
  - [ ] 管理提交 diff 的 hunk revert 操作。
  - [ ] 保留 patch apply 后刷新历史 / diff 的现有语义。
- [ ] 创建 `src/components/diff/DiffToolbar.vue`
  - [ ] 承载模式切换、语法高亮、搜索、hunk 跳转、revert 操作入口。
  - [ ] 通过 props / emits 与 `DiffView` 交互。
- [ ] 重组 `DiffView.vue`
  - [ ] 保留图片 / SVG / 文本 diff 分流。
  - [ ] 保留对 `InlineDiff`、`SideBySideDiff`、`ImageDiff` 的接线。
- [ ] 验证
  - [ ] `npx vue-tsc --noEmit`
  - [ ] `npm run test`
  - [ ] 手动验证三种文本模式、图片预览、SVG 文本模式、搜索和 hunk 跳转。

## 关键决策

1. **不动底层渲染组件**：`InlineDiff`、`SideBySideDiff` 和 `ImageDiff` 已有明确职责，本轮只整理入口组件。
2. **搜索保留 store 信号机制**：diff 搜索由全局快捷键触发，继续依赖 `uiStore`，不新增事件总线。
3. **hunk revert 保守移动**：只抽取逻辑，不改变可用条件、错误处理和刷新顺序。

## 验证方式

1. 自动验证：
   - `npx vue-tsc --noEmit`
   - `npm run test`
2. 手动验证：
   - WIP diff 和提交 diff 均能打开。
   - side-by-side、inline、by-hunk 切换正常并能持久化。
   - 搜索框展开、输入、上下跳转、清空正常。
   - 提交 diff 的 hunk revert 正常。
   - 图片、SVG 预览和 SVG 文本模式正常。
