# ToolbarGitActions 重构方案

## Context

`src/components/toolbar/ToolbarGitActions.vue` 是 `AppToolbar` 拆分后的左侧 Git 操作区，目前仍有 500 多行。它集中了承载打开仓库、Pull / Push 模式菜单、远程选择、Stash / Pop、Fetch 和系统终端入口等逻辑。虽然这些操作相关性较强，但继续增长会让 toolbar 子组件再次变成维护瓶颈。

本次重构目标是在不改变 toolbar 外观和操作语义的前提下，把 Pull / Push / Fetch / Stash 等动作逻辑拆到 composable 中，让组件主要负责按钮和菜单渲染。

预期结果：

- 远程选择、Pull / Push 模式菜单和 Git 操作执行逻辑分离。
- `ToolbarGitActions.vue` 保持单一职责：渲染左侧操作区和连接 composable。
- 不修改 repoOps busy 状态、toast 行为、快捷键提示或 Git IPC 契约。

## 进度总览

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| 1 | 提取远程选择和 Pull / Push 菜单逻辑 | 待办 |
| 2 | 提取 Git 操作执行逻辑 | 待办 |
| 3 | 重组 `ToolbarGitActions.vue` | 待办 |
| 4 | 类型检查、测试和 toolbar 手动验证 | 待办 |

## 子任务清单

- [ ] 创建 `src/composables/toolbar/useRemoteActionMenu.ts`
  - [ ] 管理远程选择菜单、Pull 模式菜单、Push 模式菜单。
  - [ ] 保留 fetch all、remote 选择和 anchor rect 行为。
- [ ] 创建 `src/composables/toolbar/useToolbarGitActions.ts`
  - [ ] 管理 pull、push、stash、pop、fetch、系统终端打开。
  - [ ] 保留 busy 状态、toast 成功提示和错误提示。
- [ ] 重组 `ToolbarGitActions.vue`
  - [ ] 保留按钮布局、图标、快捷键 label 和 ContextMenu 挂载。
  - [ ] 保持当前 class 名或等价样式。
- [ ] 验证
  - [ ] `npx vue-tsc --noEmit`
  - [ ] `npm run test`
  - [ ] 手动验证 Pull / Push 多模式、Fetch、Stash、Pop、打开终端和打开仓库菜单。

## 关键决策

1. **不再拆按钮级组件**：Pull / Push / Fetch / Stash 共享 repo、remote、busy 和 toast 上下文，拆到 composable 比拆成多个小按钮组件更合适。
2. **保留当前弹出菜单机制**：继续使用现有 `ContextMenu` 和 anchor rect 计算，不引入新的浮层库。
3. **不改变操作串行化**：继续依赖 `repoOpsStore` 管理 busy 状态，不改变 Git 操作并发语义。

## 验证方式

1. 自动验证：
   - `npx vue-tsc --noEmit`
   - `npm run test`
2. 手动验证：
   - 无仓库、有仓库、游离 HEAD 等状态下按钮 disabled 正常。
   - Pull 默认模式和下拉模式正常。
   - Push 普通、force-with-lease、force 模式正常。
   - Fetch 远程选择和 fetch all 正常。
   - Stash / Pop 和系统终端打开正常。
