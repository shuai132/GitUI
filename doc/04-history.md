# 04. 提交历史视图

`/history` 是 GitUI 的主视图：提交图 + 提交列表 + 详情分栏，并在顶部嵌入 WIP 行（见 [03-workspace.md](./03-workspace.md)）。

## 涉及模块

- 后端：`commands/log.rs`、`git/engine.rs::get_log / get_commit_detail`
- 前端：
  - `views/HistoryView.vue`
  - `stores/history.ts`、`stores/ui.ts`
  - `components/history/CommitGraphRow.vue`、`WipRow.vue`、`CommitInfoPanel.vue`
  - `components/diff/DiffView.vue`（详情 diff 面板）
  - `utils/graph.ts`（lane 算法，细节在 [05-commit-graph.md](./05-commit-graph.md)）
  - `@tanstack/vue-virtual` 用于虚拟滚动

## 分页加载

```rust
pub fn get_log(path, offset, limit, include_unreachable, include_stashes) -> LogPage
```

返回：

```rust
pub struct LogPage {
    pub commits: Vec<CommitInfo>,
    pub has_more: bool,
    pub total_loaded: usize,
}
```

- 每页 `PAGE_SIZE = 200`（前端写死）
- `loadLog()` 全量重载，`loadMore()` 从当前长度继续
- 接近底部 5 行高度时触发 `loadMore`
- 切换仓库 / toggle 丢失引用 / toggle 贮藏 时会触发 `loadLog`

### revwalk 构造

`get_log` 的关键逻辑：

1. **Step A**：推所有 refs 到一个临时 revwalk，收集 `reachable: HashSet<Oid>`，用于判断哪些提交是"丢失引用"的
2. **Step B**：遍历 `stash_foreach` 收集 `stash_set`；对每条 stash 读取其 commit 对象，把 `parent[1]`（index 快照）和 `parent[2]`（untracked 快照）收集进 `stash_aux_set`——这些是 git stash 的内部结构，用户视角里不应作为独立提交出现
3. **Step C**：主 revwalk 推 `refs/heads/*` + `refs/remotes/*` + `refs/tags/*` + HEAD，排序 `TOPOLOGICAL | TIME`
4. `include_stashes` 时把每条 stash oid 推进 revwalk
5. `include_unreachable` 时遍历 HEAD reflog，把既不在 reachable 也不在 stash 集合里的 oid 推进 revwalk（即丢失引用的提交）
6. 按 `offset/limit` 分页遍历 revwalk 输出，**跳过 `stash_aux_set` 中的 oid**（index/untracked 辅助 commit 不作为独立行），逐条构造 `CommitInfo`
7. 每条 commit 打上：
   - `is_stash = stash_set.contains(oid)`
   - `is_unreachable = !is_stash && !reachable.contains(oid)`
8. 对 `is_stash == true` 的 commit，`parent_oids` 只保留 `parent[0]`（HEAD），丢弃 `parent[1]`/`parent[2]`——让前端 lane 算法把 stash 当成普通 1-parent commit 挂在 HEAD 上，详见 [10-stash-reflog.md](./10-stash-reflog.md#历史图里的-stash)

前端据此渲染：

- `is_unreachable` → 整行变灰 + 斜体
- `is_stash` → message 颜色淡化 + 斜体；lane 图标使用空心圆 + 分支色描边（[05-commit-graph.md](./05-commit-graph.md)）

## 过滤与搜索

顶栏右上角的搜索框展开后绑定 `uiStore.historySearchQuery`。`HistoryView` 用 computed `filteredCommits` 在前端过滤（不重查后端）：

```ts
const filteredCommits = computed(() => {
  const q = uiStore.historySearchQuery.trim().toLowerCase()
  if (!q) return historyStore.commits
  return historyStore.commits.filter(c =>
    c.summary.toLowerCase().includes(q) ||
    c.author_name.toLowerCase().includes(q) ||
    c.short_oid.toLowerCase().startsWith(q) ||
    c.oid.toLowerCase().startsWith(q),
  )
})
```

搜索生效时 WIP 行隐藏、提交图隐藏（列表变成纯文本过滤结果）。列表末尾展示 `找到 N 条（已加载 M 条）` 提示。

## 布局模式

`uiStore.historyLayoutMode` 支持两种（持久化到 localStorage）：

| 模式 | 结构 |
|------|------|
| `horizontal` (左右) | 左：commit 列表全高；右：上 info 面板 / 下 diff |
| `vertical` (上下) | 上：commit 列表占满宽；下：左 info / 右 diff |

顶栏右上角小图标按钮切换。

### 分割条

- 主分割条（commit 列表 ↔ 详情区）：`pane-resize`，左右拖
- 次分割条（info ↔ diff）：`pane-resize-h`，上下拖
- 四个百分比 + 三个列宽（hash / author / date）都持久化到 `localStorage.gitui.history.sizes`

### 列宽拖动

每个 header 列的左边缘有一条 6px 隐形 handle（`col-resize`），向右拖 → 本列缩小（因为 handle 在左边缘，delta 取反）。

## 右侧详情面板

### CommitInfoPanel

显示：

- 提交 meta：作者、时间、完整 message、OID
- 关联的 refs（本地/远程分支、tags）
- 变更文件列表，点击切换 `selectedFileDiffIndex`

**文本选择与超长内容**：面板头部（summary + body）和 meta-grid 两块显式设 `user-select: text`，盖过全局 `* { user-select: none }`，支持选中复制 commit 标题、message、oid、作者、邮箱等。超长的单行内容（过长的 summary、完整 oid、长邮箱、多 parent 列表）改为水平滚动（`overflow-x: auto + white-space: nowrap`）而非 `text-overflow: ellipsis` 截断，配一条 4px 细滚动条，避免占垂直空间又能提示"右侧还有内容"。

### DiffView

见 [06-diff-viewer.md](./06-diff-viewer.md)，支持三种模式切换。

### 面板切换规则

- 选中 WIP 行 → 右面板是 `WipPanel`，diff 区显示 `diffStore.currentDiff`
- 选中真实 commit → 右面板是 `CommitInfoPanel`，diff 区显示 `selectedCommit.diffs[selectedFileDiffIndex]`
- 未选中或再次点击已选中行 → 切换 `showDetail` 折叠整个详情区

## 键盘导航

- `↑` / `↓` 在"当前 activePane"内移动：
  - `activePane === 'commits'`：上下切换 commit / WIP 行，调 `virtualizer.scrollToIndex`
  - `activePane === 'files'`：上下切换选中文件 diff
- 编辑元素（`<input>` / `<textarea>` / `contentEditable`）内部的方向键不拦截
- 点击 commit 列表切到 `'commits'`；点击文件行切到 `'files'`

## 右键操作

右键 commit 行弹出 `ContextMenu`：

| 菜单项 | 实现 |
|--------|------|
| 检出此提交 | `checkoutCommit`，confirm detached HEAD |
| 在此创建分支... | 打开 `CreateBranchDialog` |
| Cherry pick 此提交 | `cherryPickCommit`，confirm |
| 将 `<branch>` 重置到此提交 | 子菜单 soft / mixed / hard |
| Revert 此提交 | `revertCommit`，confirm |
| 复制提交 SHA | `navigator.clipboard.writeText(oid)` |
| 在此创建标签... | 打开 `CreateTagDialog`（轻量） |
| 创建附注标签... | 同上（传 `annotated=true`，要求填 message） |

其中 `checkoutCommit` 在后端使用 `safe` 模式 checkout：若工作区有未提交变更会失败（保护用户）。

## 分支标签

提交列表的每一行会把 `historyStore.branches` 中指向该 commit 的分支渲染成小 tag（`branchTagMap` computed）。颜色：

- HEAD → `--accent-blue`
- 远程 → `--accent-orange`
- 其他本地 → `--accent-green`

## 分支/远程操作后的刷新

`historyStore` 暴露的 `switchBranch / checkoutRemoteBranch / cherryPickCommit / revertCommit / resetToCommit / checkoutCommit` 全部在 await 后并发 `loadLog() + loadBranches()` 刷新 UI。
