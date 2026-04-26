# AppSidebar Refactoring Plan

## Context
`AppSidebar.vue` 已经膨胀到 1800+ 行，内部塞满了所有的侧边栏实体的展示逻辑、右键菜单逻辑（本地分支、标签、储藏区、子模块、远程分支）以及底部的多仓库拖拽排序逻辑。
这不仅降低了可读性，也增加了后续功能迭代的维护成本（例如容易出现命名冲突、上下文过长）。

**预期结果**：
将 `AppSidebar.vue` 拆分为多个高内聚的子组件，每个子组件管理自身的视图渲染、右键菜单和简单的交互事件。`AppSidebar.vue` 只保留外层框架和必要的顶层状态，总行数大幅减少，核心交互功能保持不变。

## 进度总览

| 阶段 | 状态 | 目标 |
| --- | --- | --- |
| 1 | 待办 | 提取各个区块（分支、标签、储藏、子模块、远程）为独立组件 |
| 2 | 待办 | 提取底部的仓库列表及拖拽排序功能为独立组件 |
| 3 | 待办 | 组装重构后的 `AppSidebar.vue` 并清理无用代码 |
| 4 | 待办 | 验证测试所有右键菜单及交互正常 |

## 子任务清单

- [x] 创建 `src/components/sidebar` 目录。
- [x] **Phase 1: 拆分实体区块**
  - [x] 提取 `SidebarLocalBranches.vue`（处理本地分支列表、切换、右键菜单、删除）。
  - [x] 提取 `SidebarTags.vue`（处理标签列表、拉取、推送、删除、右键菜单）。
  - [x] 提取 `SidebarStash.vue`（处理储藏列表、Apply/Pop/Drop、右键菜单）。
  - [x] 提取 `SidebarSubmodules.vue`（处理子模块列表、初始化/更新/删除、右键菜单）。
  - [x] 提取 `SidebarRemote.vue`（处理远程分支树、Fetch、右键菜单）。
- [x] **Phase 2: 拆分仓库列表**
  - [x] 提取 `SidebarAllRepos.vue`（处理高度调整逻辑、基于 Pointer Events 的拖拽排序、仓库右键菜单）。
- [x] **Phase 3: 组装与清理**
  - [x] 重写 `AppSidebar.vue`，引入上述组件。
  - [x] 将公用的弹窗（如 `ConfirmDialog`, `AddRemoteDialog`, `AddSubmoduleDialog` 等）适当地保留在顶层，或下放到具体使用的地方。
  - [x] 保证全局样式兼容。
- [x] **Phase 4: 验证**
  - [x] 运行 `npx vue-tsc --noEmit`。
  - [x] 验证界面效果不变。

## 关键决策
1. **组件粒度**：按原有的 `<div class="section">` 划分。每个组件维护自己的 ContextMenu 响应式状态（`visible`, `x`, `y`, `target`），避免把所有菜单状态堆在顶层。
2. **全局方法抽取**：如果多个模块都会用到类似 `jumpToBranchCommit` 或通用的确认弹窗，可以考虑把通用弹窗保留在 `AppSidebar` 并通过 provide/inject 或者 pinia store 暴露调用方法，但由于我们不希望增加额外的 store，最简单的方式是将 `ConfirmDialog` 保留在父级，通过 Event Emit 或直接在子组件内部独立引入 `ConfirmDialog`。为了高内聚，倾向于让**每个涉及危险操作的组件内部引入自己的 `ConfirmDialog`**，反正 `ConfirmDialog` 自身很轻量。
3. **样式处理**：为了避免每个文件里重复写相同的 CSS 类名，可以保留 `.section-title`, `.branch-item` 等基础样式在全局或一个共用的 CSS 中，但既然现在都有 scoped，最好把通用 CSS 提取到 `src/assets/sidebar.css` 或者直接在各个组件里拷贝对应的部分，如果是 Tailwind，则无此问题（项目确实在使用 `@tailwindcss/vite`，有些样式写在 CSS 里，我们可以提取这些 sidebar 专有的共享 class，或者在每个子组件里拷贝 scoped CSS 仅保留相关的）。
4. **性能底线**：不能引入新的性能瓶颈，不能修改现有的防抖/重刷逻辑。

## 验证方式
1. 打开界面，确保侧边栏所有折叠区块正常显示。
2. 依次测试：本地分支切换/右键、标签右键推送、Stash 右键、Submodule 右键。
3. 测试底部的多个仓库的拖动条（调整高度）以及内部项的拖拽排序。
4. 无任何 Vue console 报错。
