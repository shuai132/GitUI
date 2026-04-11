# GitUI 设计文档

本目录按功能域整理了 GitUI 的设计说明。每份文档对应一个功能模块，描述：

- 目标与交互：这一模块想解决什么问题
- UI 结构：涉及到的 Vue 视图 / 组件 / store
- 后端实现：对应的 `GitEngine` 方法与 IPC 命令
- 关键设计取舍：为什么这样做、不做什么

## 索引

| 文档 | 内容 |
|------|------|
| [01-architecture.md](./01-architecture.md) | 整体架构、分层、数据流、事件机制 |
| [02-repo-management.md](./02-repo-management.md) | 多仓库管理、`.git/` 监控、持久化、托盘与窗口行为 |
| [03-workspace.md](./03-workspace.md) | 工作区视图（WIP 行）、暂存、提交、Amend、Discard |
| [04-history.md](./04-history.md) | 提交历史视图、分页、搜索、详情分栏、右键操作 |
| [05-commit-graph.md](./05-commit-graph.md) | 提交图 lane 算法、分支标签、丢失引用/贮藏可视化 |
| [06-diff-viewer.md](./06-diff-viewer.md) | Diff 查看器三种模式、语法高亮、变更跳转 |
| [07-branches.md](./07-branches.md) | 分支管理、本地/远程树形、Ahead/Behind、检出远程分支 |
| [08-remote.md](./08-remote.md) | Fetch / Push / Pull、SSH 凭据回调链 |
| [09-submodules.md](./09-submodules.md) | Submodule 列表、Init / Update / Edit / 完整 Deinit |
| [10-stash-reflog.md](./10-stash-reflog.md) | Stash、Reflog、`git gc` 清理入口 |
| [11-ipc.md](./11-ipc.md) | IPC 命令目录、Rust ↔ TypeScript 类型映射约定 |

## 阅读建议

- 先读 [01-architecture.md](./01-architecture.md)，建立整体骨架
- 调具体功能时再按需翻对应文档
- 要新增 IPC 命令或数据结构，对齐 [11-ipc.md](./11-ipc.md) 的约定

## 其他文档

`todo/` 目录存放尚未落地的设计草稿和改进点，不保证与当前代码同步。
