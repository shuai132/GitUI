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
    pub old_blob_oid: Option<String>,  // 图片预览按需拉取 blob 时用
    pub new_blob_oid: Option<String>,
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

## 图片 / SVG 预览

针对常见位图（PNG/JPG/GIF/WEBP/BMP/ICO）和 SVG，diff 区会切到 `ImageDiff.vue` 组件，旧版在左 / 新版在右并排展示，每侧下方显示 `宽×高 · 大小`。

**按需拉取字节**：`FileDiff` 带 `old_blob_oid / new_blob_oid` 两个字段，前端根据扩展名判定需要预览时，调用 `get_blob_bytes(repoId, oid)` 获取 base64 字节。WIP 未暂存修改的新版 oid 为 None，此时回退到 `read_worktree_file(repoId, relPath)` 直接读磁盘。文件超过 10 MB（`MAX_PREVIEW_BYTES` 常量）不返回字节，UI 显示占位。

**SVG 双视图**：工具栏多一对"图片 / 文本"按钮，默认走图片预览，切到文本时复用现有三种文本 diff 模式。

调用入口：`DiffView` 需要接收 `repoId` 和 `wip: { staged } | null` 两个新 prop。`HistoryView.vue` 一处透传（WIP 行选中时 `wip` 非 null，提交详情时为 null）。

## 行动项（未完成）

- [x] Word-level 高亮（增删行的相似片段对比）
  - 实现：`src/lib/wordDiff.ts`（Myers LCS 字符级 diff）
  - `SideBySideDiff.vue`：配对 del/add 行调用 `diffChars`，用 `<mark class="word-del/add">` 标注
  - `InlineDiff.vue`：连续 del+add 行两两配对做 word-diff
  - 语法高亮开启时禁用 word-diff（两者用 `v-html` 互斥，保持实现简单）
  - CSS 变量：`--diff-word-del-bg` / `--diff-word-add-bg`（全局 `mark.word-del/add`）
- [ ] 大图滚动缩放 / 叠加对比视图
