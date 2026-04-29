# 仓库级 Solo 当前分支

## Context

现有 `Solo 当前分支` 是全局 UI 偏好，A 仓库开启后切换到 B 仓库也会继续以 first-parent 主线加载历史。这不符合多仓库切换场景的直觉：Solo 是当前仓库的浏览上下文，应该随仓库路径独立保存。

目标是让 Solo 只作用于 active repo，并按仓库 path 持久化。设置页不再显示 Solo；工具栏 Actions 与当前本地分支右键菜单仍保留切换入口。IPC 参数和后端语义保持不变。

## 进度总览

| 阶段 | 状态 | 内容 |
| --- | --- | --- |
| 1 | 完成 | `ui` store 改为按 repo path 管理 Solo 状态 |
| 2 | 完成 | 历史加载、工具栏和侧边栏接入 active repo Solo 状态 |
| 3 | 完成 | 设置页移除 Solo，测试覆盖仓库隔离 |
| 4 | 完成 | 更新文档并运行检查 |

## 子任务清单

- [x] 新增仓库级 Solo 持久化 key，不再读取旧全局 `gitui.history.branchScope`
- [x] `historyStore.loadLog/loadMore` 根据 active repo path 传入 `branch_scope`
- [x] `ToolbarRightControls.vue` 与 `SidebarLocalBranches.vue` 使用 active repo 的 Solo 状态
- [x] `AdvancedSection.vue` 移除 Solo 设置项和默认值比较
- [x] 缩小侧边栏分支行 `SOLO` 徽标视觉权重
- [x] 更新 `ui` / `history` store 单元测试
- [x] 更新 `docs/04-history.md`、`docs/07-branches.md`、`docs/12-settings.md` 和 `README.md`
- [x] 运行类型检查、前端测试、Rust check 和 Rust 测试

## 关键决策

- 仓库级 key 使用 repo path，而不是 repo id。repo id 由后端内存态分配，重启或重新打开后会变化；path 才能跨会话恢复。
- 旧的全局 `gitui.history.branchScope` 不作为运行时来源，也不迁移到所有仓库，避免继续制造跨仓库继承。
- 关闭仓库不清理该 path 的 Solo 偏好；未来重新打开同一路径时恢复。
- Solo 仍表示当前 HEAD 的 first-parent 主线。切换同一仓库内分支后，Solo 作用于新的当前分支。
- 不修改 IPC 契约；前端仍把 `LogBranchScope` 作为 `get_log` 参数传给后端。

## 验证方式

1. 单元测试覆盖仓库级 Solo 默认值、持久化、无效存储回退和高级视图 reset 不清理仓库级 Solo。
2. 单元测试覆盖两个 active repo path 传入不同 `branch_scope`，确认切仓库不继承另一仓库的 Solo。
3. 手工验证：打开两个仓库，A 开启 Solo、B 保持完整历史；重启后 A 的 Solo 仍保留。
4. 完成后运行 `npx vue-tsc --noEmit`、`npm run test`、`cd src-tauri && cargo check`、`cd src-tauri && cargo test`。
