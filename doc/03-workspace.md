# 03. 工作区与提交

工作区视图显示未提交的改动并完成提交。**不占独立路由**，而是融合在 `/history` 视图里：虚拟列表顶部放一条 **WIP 行**，点击切换右侧面板到 `WipPanel`。这样改代码、查看 diff、提交、继续看历史都在同一个屏幕里。

## 涉及模块

- 后端：`commands/status.rs`、`commands/commit.rs`、`commands/system.rs`（discard）、`git/engine.rs`
- 前端：
  - `stores/workspace.ts`、`stores/diff.ts`
  - `views/HistoryView.vue`（承载 WIP 行）
  - `components/history/WipRow.vue`
  - `components/workspace/WipPanel.vue`、`FileChangeList.vue`
- 数据类型：`WorkspaceStatus`、`FileEntry`、`FileStatusKind`

## 状态模型

`GitEngine::get_status(path)` 把 `git2::Repository::statuses` 的结果分成三类：

| 字段 | 含义 |
|------|------|
| `staged` | index 中的变更（相对 HEAD） |
| `unstaged` | 工作区中的变更（相对 index，已 tracked） |
| `untracked` | 未追踪文件 |
| `head_branch` | 当前分支名（若 HEAD 指向分支） |
| `head_commit` | HEAD commit OID（unborn 时为 None） |
| `is_detached` | HEAD detached 标志 |

每个 `FileEntry` 带：

```rust
{
  path: String,
  old_path: Option<String>,  // renamed 才有
  status: FileStatusKind,    // added | modified | deleted | renamed | untracked | conflicted
  staged: bool,
}
```

## WIP 行

`WipRow.vue` 在历史列表顶部以"虚拟行"的形式出现：

- 只有当 `staged + unstaged + untracked > 0` 时才显示
- 显示格式：一个变更徽章（绿/蓝/橙三段）+ `on <branch>`
- 点击进入 WIP 模式：`selectedWip.value = true`，右侧面板显示 `WipPanel`，隐藏 `CommitInfoPanel`
- 再次点击折叠详情面板
- 搜索框有内容时不显示（搜索只针对提交）
- 工作区变干净时自动取消 WIP 选中 + 隐藏详情

实现位置：`views/HistoryView.vue` 的虚拟行渲染逻辑（`showWipRow` / `selectWipRow` / `selectRow` / `toVirtualIdx` / `toRealIdx`）。

## WipPanel

`components/workspace/WipPanel.vue` 是右侧面板，结构：

```
┌──────────────────────────────────┐
│ 🗑️  N 个文件变更 on <branch>      │ ← Header（trash 按钮触发丢弃全部）
├──────────────────────────────────┤
│ 未暂存 [全部暂存]                 │
│   M  src/foo.ts                  │
│   ?  new-file.md                 │ ← unstaged + untracked 合并展示
│                                  │
│ 已暂存 [全部取消暂存]             │
│   A  bar.rs                      │
├──────────────────────────────────┤
│ ☐ 修补上次提交 (Amend)           │
│ [ 提交摘要      ]  72 ← 倒数计数  │
│ [                              ] │
│ [  详细描述 (可选)              ] │
│                                  │
│ [ 提交 N 个变更 ]                │
└──────────────────────────────────┘
```

### 文件操作

- 点击文件行 → `diffStore.loadFileDiff(path, staged)` → 左侧（或上方）diff 区展示
- 复选框切换 → `stageFile` / `unstageFile`
- 右键菜单：暂存/取消暂存、丢弃此文件的变更（仅未暂存）
- "全部暂存" / "全部取消暂存" 两个快捷按钮

### 提交表单

- **两行结构**：摘要（最多 72 字符，超出变橙警告）+ 可选详细描述
- `buildMessage()` 把摘要和描述拼成 `summary\n\ndescription`
- **Amend 勾选**：
  - `isUnborn`（HEAD 不存在）时禁用
  - 勾上后即使没有暂存变更也可提交，只改 message
- **Cmd/Ctrl + Enter** 提交
- `canCommit` 逻辑：普通提交要求 staged 非空；amend 要求 HEAD 存在
- 提交成功后清空表单 + `historyStore.loadLog()` + `loadBranches()`

### 丢弃全部

Trash 按钮弹 Modal，列出会影响的三类文件数量。确认后调 `discard_all_changes`，内部用 `CheckoutBuilder::force().remove_untracked(true)` 强制检出 HEAD，同时删除未追踪文件。**不会删 `.gitignore` 里的 ignored 文件**（git2 默认行为）。

外部调用方（如顶部"更多 → 丢弃所有变更"）通过 `uiStore.requestDiscardAll()` 设置一个粘性标志，`WipPanel` 通过 `watch(() => uiStore.shouldOpenDiscardAll)` 响应并弹框。

## 后端命令

| 命令 | 用途 | 备注 |
|------|------|------|
| `get_status` | 取 `WorkspaceStatus` | `include_untracked + recurse_untracked_dirs + update_index` |
| `stage_file` / `unstage_file` | 单文件暂存/撤销 | unstage 通过 `reset_default` 实现，unborn HEAD 时直接 `index.remove_path` |
| `stage_all` / `unstage_all` | 全部暂存/撤销 | `index.add_all(["*"])` / `reset Mixed` |
| `create_commit` | 新建提交 | 使用当前 `repo.signature()`，parent 为 HEAD（unborn 时为空） |
| `amend_commit` | 修补 HEAD | 用 `Commit::amend()`，新 tree 来自 index |
| `discard_all_changes` | 丢弃全部 | `CheckoutBuilder::force().remove_untracked(true)` |
| `discard_file` | 丢弃单文件 | 同上 + `.path(file_path)` |
| `get_file_diff(path, staged)` | 单文件 diff | `staged=true` 时 tree→index，否则 index→workdir（含 untracked 内容） |

## Diff 加载

`WipPanel` 通过 `diffStore.loadFileDiff(path, staged)` 加载当前选中文件的 diff。`HistoryView` 的 `currentDiff` computed 根据 `selectedWip` 决定用 `diffStore.currentDiff`（WIP 时）还是 `historyStore.selectedCommit.diffs[idx]`（查看提交时）。

选择/切换 WIP → 真实 commit 时，`watch(selectedWip)` 会 `diffStore.clear()` 避免残留。
