# Remote / Submodule 添加与删除

## Context

用户希望在左侧栏直接管理 Remote 和 Submodule：
- Remote 支持添加（目前只能在 push/fetch 对话框里看到 remote 名，无添加入口）
- Submodule 支持添加（目前只有 init/update/edit/delete 四项操作）
- 两者的"删除"操作均升级为自定义 ConfirmDialog，替换原有的 `window.confirm()`

预期结果：REMOTE 和 SUBMODULES section header 出现 `+` 按钮；删除操作有统一样式的确认弹窗。

## 进度总览

| 阶段 | 内容 | 状态 |
|---|---|---|
| P1 | Rust 后端：add_remote / remove_remote / add_submodule | ✅ |
| P2 | 前端 IPC 封装 + 新建三个 Vue 组件 | ✅ |
| P3 | Sidebar 接入 + BranchTreeNode 改造 | ✅ |

## 子任务

- [x] `engine.rs`：`add_remote`, `remove_remote`, `add_submodule`
- [x] `commands/remote.rs`：`add_remote`, `remove_remote`
- [x] `commands/submodule.rs`：`add_submodule`
- [x] `lib.rs`：注册三个新命令
- [x] `useGitCommands.ts`：三个新 invoke 封装
- [x] `ConfirmDialog.vue`：可复用危险操作确认弹窗
- [x] `AddRemoteDialog.vue`：添加 remote（Name + URL）
- [x] `AddSubmoduleDialog.vue`：添加 submodule（URL + Path，SSH fallback）
- [x] `BranchTreeNode.vue`：`isRemoteRoot` prop + hover 删除按钮
- [x] `AppSidebar.vue`：section 加 `+` 按钮、ConfirmDialog 替换 `window.confirm()`
- [x] `docs/11-ipc.md`：补充三条新命令

## 关键决策

**add_submodule 做完整 clone**：与 `git submodule add` 等价，SSH URL fallback 到 `run_git`（与 `update_submodule` 保持一致）。只注册不 clone 会导致 submodule 处于 `not_cloned` 状态，用户体验差。

**deinit_submodule 不改名**：后端已实现完整的 5 步删除（不只是 deinit），前端菜单项由 "Delete" 改为更准确的措辞，但命令名保持向后兼容。

**ConfirmDialog 复用**：remote delete 和 submodule delete 共用同一个 ConfirmDialog 组件，props 控制标题/消息/按钮文案。

**REMOTE / SUBMODULES section 恒显示**：只要 `activeRepoId` 存在就显示（移除对 `list.length > 0` 的依赖），确保"添加第一个"的入口始终可见。

**BranchTreeNode 顶层 folder 删除按钮**：只在 `isRemoteRoot=true` 且 `level=0` 且节点是 folder 时显示，hover 展示 `×`，点击 emit `deleteRemote(remoteName)` 给 AppSidebar 处理。

## 验证方式

1. 在一个本地仓库里添加一个新 remote（如 `test https://example.com`），确认 REMOTE section 出现对应 tree 节点（下次 fetch 后会有 remote branches）
2. 删除刚添加的 remote，确认 ConfirmDialog 弹出 → 确认后消失
3. 在一个有网络的仓库里 add submodule（如 `https://github.com/octocat/Hello-World.git sub/hello`），确认 clone 完成后 submodule 出现在列表
4. 删除 submodule，确认 ConfirmDialog 弹出 → 确认后从列表消失、工作区目录被清理
