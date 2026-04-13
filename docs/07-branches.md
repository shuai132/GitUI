# 07. 分支管理

分支相关的能力分两个入口：

- **侧边栏**：日常切换、右键菜单、在侧栏浏览本地 / 远程分支树
- **`/branches` 页面**：独立的分支列表视图（`BranchList.vue`），通过路由进入

## 涉及模块

- 后端：`commands/branch.rs`、`git/engine.rs` 的 branch 系列方法
- 前端：
  - `stores/history.ts`（承载 `branches`）
  - `components/layout/AppSidebar.vue`（本地 + 远程 section）
  - `components/branch/BranchList.vue`、`CheckoutRemoteDialog.vue`
  - `components/commit/CreateBranchDialog.vue`（在提交上创建分支）
  - `components/layout/BranchTreeNode.vue`（远程树节点）
  - `utils/branchTree.ts`（把 `origin/feature/a` 按 `/` 切开成树）
  - `composables/useBranchTreeState.ts`（记忆展开状态）

## BranchInfo

```rust
pub struct BranchInfo {
    pub name: String,
    pub is_remote: bool,
    pub is_head: bool,
    pub upstream: Option<String>,
    pub commit_oid: Option<String>,
    pub ahead: Option<u32>,    // 本地相对上游领先
    pub behind: Option<u32>,   // 本地相对上游落后
}
```

后端的 `list_branches` 遍历 `repo.branches(None)`，对每条本地分支尝试取 `upstream()` 并用 `graph_ahead_behind` 计算 `(ahead, behind)`。没有上游的本地分支 ahead/behind 为 `None`。

## 侧边栏 LOCAL BRANCHES

`AppSidebar.vue` 把 `historyStore.branches.filter(!is_remote)` 渲染为纯列表：

- 当前分支（`is_head`）显示实心点 `dot-solid`
- 其他分支显示空心点
- 点击非当前分支 → `historyStore.switchBranch(name)` → `GitEngine::switch_branch`
- `ahead > 0 || behind > 0` 时右侧显示 `↑N ↓N` 徽章
- 右键菜单：切换 / 复制分支名 / 删除（非当前分支）

删除走 `delete_branch` → `repo.find_branch(name, Local).delete()`。

## 侧边栏 REMOTE 树

`buildBranchTree(remoteBranches)` 把 `"origin/feature/auth"` 按 `/` 切成嵌套结构：

```
origin
  └── feature
       ├── auth
       └── billing
  └── main
```

`BranchTreeNode.vue` 递归渲染，`useBranchTreeState` 用一个 reactive map 记忆每个路径的展开/折叠状态（按仓库 scope）。

- 左键点击远程分支叶子节点暂时不做操作（需要走"检出"流程）
- 右键 → `ContextMenu` → "检出..." → 打开 `CheckoutRemoteDialog`

### CheckoutRemoteDialog

- 输入本地分支名（默认为远端分支去掉第一段的结果，比如 `origin/feature/a` → `feature/a`）
- 勾选 "设置上游跟踪"（默认勾选）
- 确定 → `checkoutRemoteBranch(remoteBranch, localName, track)`

后端流程（`GitEngine::checkout_remote_branch`）：

1. `find_branch(remoteBranch, Remote)` 拿到远端 ref 的 commit
2. `repo.branch(localName, commit, false)` 创建本地分支
3. 若 `track` → `set_upstream(Some(remoteBranch))`
4. `checkout_tree` + `set_head("refs/heads/<localName>")`

## `/branches` 视图

`BranchesView.vue` 是个简单外壳，把 `<BranchList />` 放进去。`BranchList.vue` 是一个更完整的分支列表（含远程 + ahead/behind + 操作），和侧边栏侧重点不同：

- 侧边栏：快速切换 + 全局可见
- `/branches`：清单式 + 集中操作入口（批量、筛选）

## 在提交上创建分支

`CreateBranchDialog.vue` 在 `HistoryView` 的右键 "在此创建分支..." 打开：

- 输入分支名
- 确定 → `historyStore.createBranch(name, commit.oid)` → `GitEngine::create_branch(path, name, Some(oid))`
- 成功后 `loadBranches()` 刷新侧边栏

在当前 HEAD 上新建分支也走同一命令（`fromOid` 为 `undefined` 时后端会 peel HEAD）。

## 提交级操作（依赖分支刷新）

`historyStore` 把以下操作封装成会同时刷新 log + branches 的两段并发：

- `switchBranch`
- `checkoutRemoteBranch`
- `checkoutCommit`
- `cherryPickCommit`
- `revertCommit`
- `resetToCommit`

原因：这些操作都可能改变 HEAD 指向或 ahead/behind，log 的高亮和侧栏的分支都要跟上。

## Tags

Tags 通过 `create_tag(path, name, oid, message)` 创建：

- `message = None` 或 `""` → 轻量标签（`tag_lightweight`）
- `message = Some(非空)` → 附注标签（`tag` 带 signature）

UI 入口：

- **创建**：`HistoryView` 的提交右键菜单 "在此创建标签..." / "创建附注标签..."
- **浏览**：侧边栏 `AppSidebar.vue` 的 TAGS section 渲染 `historyStore.tags`（附注标签按 tagger time 倒序、轻量标签排尾按名字字母序），点击跳转到对应 commit，右键菜单可复制名字 / 复制 oid / 删除
- **删除**：走 `delete_tag(path, name)` → `repo.tag_delete(name)`

后端 `list_tags` 通过 `repo.tag_foreach` 遍历 `refs/tags/*`：用 `find_tag(oid)` 区分附注 vs 轻量，附注标签额外 peel 到 commit、读取 `message` / `tagger`。

`historyStore.loadTags()` 在切换仓库、status-changed 事件、创建/删除标签后触发刷新；checkout / switch / reset 等不改变标签集合的操作不额外刷新。
