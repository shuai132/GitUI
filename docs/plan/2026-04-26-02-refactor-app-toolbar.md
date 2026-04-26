# AppToolbar Refactoring Plan

## Context
`AppToolbar.vue` 已经有 1300+ 行代码，目前承担了过多的职责，包括：
1. Git 核心操作按钮（Pull, Push, Stash, Pop, Fetch）及其关联的多种下拉菜单逻辑。
2. 视图与全局控制（搜索框、主题切换、终端显示、布局切换、设置入口）。
3. "Actions" 更多操作菜单及其关联的弹窗触发逻辑。
4. 全局 Toast 提示（成功提示与 IPC 错误监听拦截）。
5. 窗口系统事件（拖拽移动窗口、双击最大化）。

这使得它维护起来比较臃肿。我们希望将它拆分，提取出独立的职责模块，使得主组件只保留组装框架、顶层事件分发以及各类全局弹窗（如 ReflogDialog, SettingsModal）的挂载。

**预期结果**：
将 `AppToolbar.vue` 拆分为高内聚的子组件（如 Toast、左侧 Git 操作区、右侧视图控制区），并提取公用的 Toast 逻辑至 composable。主组件变得清爽，核心功能、样式交互保持不变，不产生性能回退。

## 进度总览

| 阶段 | 状态 | 目标 |
| --- | --- | --- |
| 1 | 完成 | 抽取全局 Toast 状态管理与 `ToolbarToast.vue` 组件 |
| 2 | 完成 | 抽取左侧 Git 操作按钮与下拉菜单为 `ToolbarGitActions.vue` |
| 3 | 完成 | 抽取右侧视图控制与操作菜单为 `ToolbarRightControls.vue` |
| 4 | 完成 | 在 `AppToolbar.vue` 中进行组装并验证所有功能 |

## 子任务清单

- [x] 创建 `src/components/toolbar/` 目录。
- [x] **Phase 1: 提取 Toast 模块**
  - [x] 创建单例 composable `src/composables/useGlobalToast.ts`，导出全局的 `toast` state 与 `showToast`, `showError` 方法。
  - [x] 创建 `src/components/toolbar/ToolbarToast.vue`，提取 Toast 相关的 DOM 渲染、CSS 动画及 `errorsStore` 的 IPC 错误自动监听逻辑。
- [x] **Phase 2: 提取 Git 操作区 (Left)**
  - [x] 创建 `ToolbarGitActions.vue`。
  - [x] 将 Open、Pull、Push、Stash、Pop、Fetch、Terminal 等按钮及对应的 loading 状态（`repoOpsStore.getBusy`）移入。
  - [x] 将关联的右键 / 下拉菜单（`remoteMenu`, `pullModeMenu`, `pushModeMenu`）及相关逻辑移入。
- [x] **Phase 3: 提取视图控制区 (Right)**
  - [x] 创建 `ToolbarRightControls.vue`。
  - [x] 将 Search Box、主题切换、终端切换、布局切换、设置入口按钮移入。
  - [x] 将右侧的 "Actions" 菜单（`actionsMenu`，包含 Reflog/GC/About 等）及菜单项逻辑移入。
  - [x] 通过 `emit` 将需要打开的全局弹窗（如 `@show-reflog`, `@show-settings`, `@show-about` 等）传递给父级 `AppToolbar.vue` 进行统一弹窗。
- [x] **Phase 4: 组装与清理**
  - [x] 重构 `AppToolbar.vue`，引入 `ToolbarGitActions`, `ToolbarRightControls`, `ToolbarToast`。
  - [x] 确保 `data-tauri-drag-region` 与原生窗口拖拽事件保留在最外层容器。
  - [x] 确保全局弹窗（`ReflogDialog`, `ErrorHistoryDialog`, `SettingsModal`, `AboutInfo`）依然在顶层挂载。
  - [x] 运行 `npx vue-tsc --noEmit` 与构建检查。

## 关键决策
1. **Toast 状态分离**：原来的 `toast` 是 `AppToolbar` 里的本地 `ref`，但各拆分组件都需要调用 `showToast` 发送成功通知。不新增 pinia store，而是提供一个轻量的单例 composable（`useGlobalToast.ts`）来共享响应式状态。
2. **弹窗挂载层级**：如 `ReflogDialog`, `SettingsModal` 等弹窗虽然由子组件触发，但它们属于全局层级（具有覆盖全屏的 mask），因此继续保留在 `AppToolbar.vue` 或 `App.vue` 级别，通过组件间事件（`emit`）来触发显示，避免嵌套过深。
3. **拆分粒度**：不为每个单独的按钮创建独立的 vue 文件（例如不拆 `PullButton.vue`），因为它们之间的上下文依赖（例如 `hasRepo`, `currentBranch`, `pickRemote` 菜单复用）十分紧密，统一放入 `ToolbarGitActions.vue` 是一个甜点粒度。

## 验证方式
1. 启动应用，检查顶部工具栏 UI 是否完美还原，CSS 排版无异样。
2. 测试各项 Git 操作（Pull / Push 及其下拉框），观察 Spinner 状态及操作成功的 Toast 提示是否正常弹出。
3. 产生一项错误（如强行 Pull 冲突），验证 `ToolbarToast.vue` 拦截 IPC Error 弹出错误 Toast 是否正常。
4. 测试 Search 输入框行为、主题切换及右侧 Actions 菜单各项点击是否正常展开对应的弹窗。
5. 测试窗口空白处拖拽和双击最大化是否仍然生效。
6. 全程无任何 Vue Console 报错和 TS 类型错误。
