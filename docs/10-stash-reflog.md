# 10. Stash / Reflog / GC

三个围绕"临时状态管理 + 仓库维护"的小功能，放在一起。

## Stash

### 涉及模块

- 后端：`commands/stash.rs`、`GitEngine::stash_push / stash_pop / stash_apply / stash_drop / stash_list`
- 前端：
  - `stores/stash.ts`
  - `components/layout/AppToolbar.vue`（Stash / Pop 按钮）
  - `components/layout/AppSidebar.vue`（STASH section）
- 可选显示在历史图里：`uiStore.showStashCommits`

### 后端

`GitEngine::stash_push / stash_pop / stash_apply / stash_drop / stash_list`（见 `git/engine.rs`）。数据结构 `StashEntry` 见 `git/types.rs`。行为要点：

- `stash_push` 使用 `StashFlags::INCLUDE_UNTRACKED`，新文件会一起被 stash
- `stash_pop / stash_apply / stash_drop` 接收 `index` 参数（UI 侧按 `StashEntry.index` 传入）：
  - `pop` = apply + drop，工具栏 "Pop" 按钮传 0（最新一条）
  - `apply` 只应用不移除；`drop` 只移除不应用
  - drop 之后其他 stash 的 index 会顺位前移，前端 `stashStore` 在操作后统一 `refresh()` 重新拉取
- `stash_list` 通过 `stash_foreach` 只读遍历，不触发写操作
- 没有 branch（`git stash branch`）等操作

### UI

**工具栏**：

- `Stash` 按钮：仓库存在即可用。message 优先取 WipPanel 提交信息输入框里当前的内容（`workspaceStore.commitDraft`），用作 stash 描述；输入框为空则回退到 libgit2 默认的 "WIP on \<branch\>: ..."。stash 成功后清空草稿（变更和 message 都已转移到 stash 里）
- `Pop` 按钮：有至少一条 stash 才启用

**侧边栏 STASH section**：

- 总数显示在 section title 上
- 每条显示 `{index}` + message
- 点击 stash 行 → `historyStore.selectCommit(stash.commit_oid)` 把该 stash commit 当普通 commit 展开到详情面板
- 右键菜单（侧边栏 STASH 行 / 历史图里 `is_stash === true` 的提交共用同一组语义）：
  - `Apply Stash` —— 应用但保留条目
  - `Pop Stash` —— 应用并移除
  - `Delete Stash` —— 仅移除（带二次确认；不使用 danger 红色样式，和其他 stash 项保持同等视觉权重）

### 历史图里的 stash

`uiStore.showStashCommits`（默认 **开**）控制是否把 stash 推入 `get_log` 的 revwalk。当开启时：

- stash 的根 commit 会出现在提交图里
- 标记为 `is_stash = true`，message 用斜体 + 次要色
- 选中后显示详情和 diff，支持查看 stash 的内容

**DAG 里把 stash 当普通 commit 处理**。git 内部的 stash 对象是一个特殊的 3-parent commit：

- `parent[0]` = HEAD（stash 创建时的基准提交）
- `parent[1]` = `index on <branch>: ...` 的快照 commit（暂存区内容）
- `parent[2]` = `untracked files on <branch>` 的快照 commit（仅当 `INCLUDE_UNTRACKED` 时存在）

如果把这三个 parent 原样交给前端 lane 算法，`index on...` 和 `untracked files on...` 会作为两行独立的孤儿 commit 出现在图里，从 stash 斜拉出两条 lane，视觉上和真正的 merge 分叉混在一起。对用户而言这是 git 存储细节的泄漏。

因此 `get_log` 在构造 `CommitInfo` 时对 stash 做两步裁剪：

1. 收集所有 stash 的 `parent[1]` / `parent[2]` 进一个 `stash_aux_set`，主 revwalk 遍历时跳过 `stash_aux_set` 里的 oid（不作为独立行输出）
2. 对 `is_stash == true` 的 commit，`parent_oids` 只保留 `parent[0]`，即 HEAD

这样 stash 在 DAG 里就是一个挂在 HEAD 上的 1-parent 普通 commit，lane 算法一视同仁。**唯一的区别是渲染图标**：`CommitGraphRow.vue` 在 `isStash` 时把圆点画成"空心 + 分支色描边"，和实心的普通 commit 区分开（见 [05-commit-graph.md](./05-commit-graph.md)）。

## Reflog

### 涉及模块

- 后端：`commands/system.rs::get_reflog`、`GitEngine::get_reflog`
- 前端：
  - `components/common/ReflogDialog.vue`
  - `components/layout/AppToolbar.vue` 的 Actions 菜单 → "显示 Reflog..."
- 数据结构：`ReflogEntry`（见 `git/types.rs`）

### 后端

`GitEngine::get_reflog(path, limit)` 读取 `HEAD` 的 reflog 并转成 `Vec<ReflogEntry>`（最新在前）。调用点 `commands/system.rs::get_reflog` 固定 `limit = 500`，由前端 `ReflogDialog.vue` 触发。

### 作用

- 展示 HEAD 最近的操作记录：commit、reset、checkout、merge、pull 等
- 每条带动作描述（"commit: fix bug" / "reset: moving to HEAD~1"）和 committer + 时间
- 点击条目可以复制 oid 或跳转到该提交（具体交互参考 `ReflogDialog.vue`）

### 与 "显示丢失引用" 的关系

`uiStore.showUnreachableCommits` 开启时，`get_log` 会额外把 HEAD reflog 里那些既不在任何 ref 也不在 stash 集合里的 oid 推进 revwalk 展示。Reflog 对话框是纯查看工具，不改变历史图；丢失引用开关则是把 reflog 里的"孤儿 commit"画到图上。两者互补。

## git gc

### 入口

Actions 菜单 → "清理仓库 (git gc)"，按钮变成 `清理中...`。成功/失败通过工具栏 toast 提示。

### 实现

GitUI 不用 git2 做 gc（libgit2 的 gc 支持有限），而是直接 **fork 系统的 git CLI**：`GitEngine::run_gc` 用 `std::process::Command` 调 `git -C <path> gc --quiet`，按退出码返回成功消息或错误。这是整个后端唯一一个 fork 外部 git 的地方。原因：

- 真实 gc 需要跑 pack / prune / repack，libgit2 不是为此优化
- gc 属于"偶尔手动触发"的维护操作，依赖系统 git 是合理代价
- 输出直接返回给前端当成功消息展示

### 副作用注意

`git gc` 可能会清理 unreachable objects（包括 stash 和 reflog 的一部分）。若用户开了"显示丢失引用"正在依赖这些 commit，gc 后它们会从 reflog 里消失。**目前没有专门的警告**——仅依赖 git gc 的默认行为（默认保留 30 天 reflog）。
