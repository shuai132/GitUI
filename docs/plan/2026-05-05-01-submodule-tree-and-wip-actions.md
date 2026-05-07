# 2026-05-05-01-submodule-tree-and-wip-actions

## Context
当前 Submodule 可以在侧边栏独立列表中管理，但“所有仓库”区域仍按仓库平铺展示；当仓库 A 的 submodule B 已作为仓库打开时，B 与 A 没有父子关系提示。工作区暂存 / 未暂存列表中，submodule 也只是普通路径项，右键缺少直接打开子仓库的动作。

## 预期结果
1. “所有仓库”区域根据已打开仓库之间的直接 submodule 关系显示父子层级。
2. 父仓库和子仓库仍保持原有点击激活、拖拽排序和右键操作能力。
3. 工作区暂存 / 未暂存列表中，路径等于当前仓库 direct submodule 的条目标记为 submodule 特殊项。
4. submodule 工作区项右键支持直接打开对应 submodule 仓库；未初始化或工作区不存在时禁用该动作。

## 进度总览

| 阶段 | 状态 | 说明 |
| ---- | ---- | ---- |
| 1. 确认数据来源 | 完成 | 复用 `list_submodules` 和现有仓库名册，不新增 IPC。 |
| 2. 仓库列表树形展示 | 完成 | 在前端按 submodule workdir 绝对路径建立 parent-child 关系。 |
| 3. WIP submodule 特殊项 | 完成 | 使用当前仓库 direct submodule path 标记列表项与菜单动作。 |
| 4. 文档与验证 | 完成 | 首轮文档已更新，类型检查和测试均已通过。 |
| 5. 历史详情右键入口 | 完成 | 提交详情变更文件菜单已支持打开 direct submodule。 |

## 子任务清单

- [x] 为“所有仓库”收集每个已打开仓库的 direct submodule，并按绝对路径匹配已打开子仓库。
- [x] 调整 `SidebarAllRepos.vue` 渲染为拍平树，保留拖拽排序和右键菜单。
- [x] 将当前仓库 submodule paths 传入 `FileChangeList.vue`，渲染专用图标 / 样式。
- [x] 扩展 WIP 右键菜单，submodule 项可打开为仓库。
- [x] 更新 `docs/02-repo-management.md`、`docs/03-workspace.md`、`docs/09-submodules.md` 和 README 用户可见清单。
- [x] 运行 `npx vue-tsc --noEmit`、`npm run test`、`cd src-tauri && cargo check`、`cd src-tauri && cargo test`。
- [x] 扩展历史详情变更文件右键菜单，submodule diff 可打开对应 submodule 仓库。
- [x] 重新运行受影响检查。

## 关键决策
- **不新增 IPC**：子模块关系由现有 `list_submodules` 提供，打开子模块复用 `submodule_workdir` + `openRepo`，避免扩大后端契约。
- **只表达 direct submodule 关系**：与既有子模块模块决策一致，不主动递归扫描未打开或深层子模块；如果深层子模块也被其直接父仓库打开，则会在对应父节点下展示。
- **仓库排序仍以用户名册为准**：树形展示只改变视觉归属，底层 `repos` 顺序和持久化不重写，拖拽继续调整名册顺序。
- **WIP 操作保持 Git 语义**：submodule 项仍可暂存 / 取消暂存父仓库中的 gitlink 变化；“打开”只是额外导航动作。

## 验证方式
1. 打开包含 submodule B 的仓库 A，并将 B 也加入仓库列表，确认“所有仓库”中 B 缩进显示在 A 下方。
2. 点击 A / B 均能正常激活；右键打开新窗口、Finder、终端仍作用于对应仓库。
3. 在 submodule 内制造未提交改动，回到父仓库工作区，确认 submodule 路径以特殊项显示且右键可打开。
4. 暂存 submodule gitlink 变更后确认该项在已暂存区仍显示为特殊项，并可右键打开。
