# 06. Diff 查看器

Diff 查看器同时服务两种场景：**WIP 工作区 diff**（选中未提交文件）和 **提交内 diff**（选中历史 commit 的变更文件）。两种场景共享同一 `FileDiff` 结构和同一套视图组件。

## 涉及模块

- 后端：`commands/diff.rs`、`GitEngine::get_file_diff` / `parse_diff` / `get_commit_detail`
- 前端：
  - `components/diff/DiffView.vue`（工具栏 + 模式切换容器）
  - `components/diff/InlineDiff.vue`（行内 + by-hunk 模式）
  - `components/diff/SideBySideDiff.vue`（左右分栏模式）
  - `lib/highlight.ts`（highlight.js 子集 + 扩展名映射）
- 数据类型：`FileDiff` / `DiffHunk` / `DiffLine`

## FileDiff 结构

```rust
pub struct FileDiff {
    pub old_path: Option<String>,
    pub new_path: Option<String>,
    pub is_binary: bool,
    pub hunks: Vec<DiffHunk>,
    pub additions: usize,
    pub deletions: usize,
}

pub struct DiffHunk {
    pub old_start: u32, pub old_lines: u32,
    pub new_start: u32, pub new_lines: u32,
    pub header: String,   // "@@ -12,7 +12,9 @@ ..."
    pub lines: Vec<DiffLine>,
}

pub struct DiffLine {
    pub origin: char,  // ' ' | '+' | '-'
    pub content: String,
    pub old_lineno: Option<u32>,
    pub new_lineno: Option<u32>,
}
```

`parse_diff` 用 `Diff::print(DiffFormat::Patch)` 的回调累积 hunks，遇到 `FileHeader` 时把上一个文件 flush 到 `file_diffs`，最后统计 `additions / deletions`。

## 工作区 diff 的特殊点

`get_file_diff(path, file_path, staged)`：

- **staged=true**：`diff_tree_to_index(HEAD_tree, index)`，用 `pathspec(file_path)` 限制
- **staged=false**：`diff_index_to_workdir(index)`；关键是打开：
  ```rust
  diff_opts
      .include_untracked(true)
      .show_untracked_content(true)
      .recurse_untracked_dirs(true)
  ```
  否则新增的 untracked 文件会返回空 hunks，UI 看不到内容。

## 三种显示模式

`DiffView` 有一个 `viewMode: 'side-by-side' | 'inline' | 'by-hunk'`，持久化到 `localStorage.gitui.diff.viewMode`。

| 模式 | 组件 | 说明 |
|------|------|------|
| `side-by-side` | `SideBySideDiff.vue` | 左右双栏，旧版本在左，新版本在右；删除行填空行对齐 |
| `inline` | `InlineDiff.vue`（`groupByHunk=false`） | 单列连续流，所有 hunk 之间无间隔 |
| `by-hunk` | `InlineDiff.vue`（`groupByHunk=true`） | 单列但每个 hunk 是一个独立区块，块间有间隙 |

三种模式共享工具栏（文件路径、`+N -N` 统计、上/下变更跳转、高亮开关、模式按钮、关闭按钮）。

## 语法高亮

`lib/highlight.ts` 只注册常用语言（约 15 个）并维护 `EXT_TO_LANG` 映射：

```ts
export const EXT_TO_LANG: Record<string, string> = {
  js/mjs/cjs/jsx → 'javascript',
  ts/tsx → 'typescript',
  py → 'python', rs → 'rust', go → 'go', java → 'java',
  c/h → 'c', cpp/cc/hpp → 'cpp',
  json, css, html/xml, md → 'markdown', yaml, sql, sh/bash, ...
}
```

`DiffView` 的 `syntaxLang` computed：若高亮开关打开且路径扩展名在表里 → 把语言名传给子组件，`highlightLine` 在渲染时按行调用 `hljs.highlight`。高亮状态 `highlightEnabled` 持久化到 `localStorage.gitui.diff.syntax-highlight`。

## 变更跳转

工具栏有上下两个箭头按钮，`DiffView` 通过 `ref` 调用子组件的 `goNextChange()` / `goPrevChange()`（两个 diff 组件都 expose 了这两个方法）。实现思路：收集所有"变更块"的 DOM 位置，按当前滚动位置找到下一个/上一个，`scrollIntoView`。

## 关闭

工具栏最右边的 `×` 按钮触发 `emit('close')`。在 `HistoryView` 中映射到 `showDetail = false`，折叠整个详情区。

## 行动项（未完成）

- [ ] 二进制文件的占位提示（当前只有 `is_binary` 标志，UI 端尚未特殊处理）
- [ ] 图片 diff 预览
- [ ] Word-level 高亮（增删行的相似片段对比）
