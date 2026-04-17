# ConflictView 增强：A/B/OUTPUT 三栏行号、语法高亮、按行勾选

## Context

当前 `src/components/diff/ConflictView.vue`（三路合并编辑器）有几个和用户期望不符的地方：

1. **OUTPUT 没有行号**：OUTPUT 是 `<textarea>`（第 569-577 行），原生不支持行号 gutter，而 A/B 栏有行号列（第 497、539 行）。三栏视觉/滚动对齐不齐。
2. **三栏都没有语法高亮**：A/B 栏模板用 `<span class="code">{{ ... }}</span>` 原样渲染纯文本（第 498、540 行），OUTPUT 是 textarea。项目已有 `src/lib/highlight.ts::highlightLine(content, lang)`，`SideBySideDiff.vue` / `InlineDiff.vue` 都在用，`EXT_TO_LANG` 映射覆盖 30+ 语言，直接复用即可。
3. **只能整块接纳 ours 或 theirs**：`hunkChoices` 按 hunk 存 `{ ours: boolean; theirs: boolean }`（第 164、169 行），checkbox 只在 hunk 起始行渲染（`v-if="rows[vRow.index].isStart"`，第 490、532 行）。用户需要像 VSCode 冲突编辑器一样：**多行冲突块里每一行单独决定是否进入 OUTPUT**。

用户确认的方向：

- OUTPUT 从 textarea 改为**只读逐行渲染**，和 A/B 三栏统一（逐行 `<div>` + 行号 + 高亮 + 虚拟化 + 同步滚动）。放弃 textarea 的手动编辑能力——per-line 勾选已足以表达最终结果；若需手动微调，用户可在工作区直接编辑文件后「标记为已解决」。
- Per-line 勾选**默认都不勾**，由用户从零挑选。顶部「Use all ours / Use all theirs」快捷按钮仍保留。顺序：同一 hunk 内 ours 行先、theirs 行后（保留当前 `synthesized()` 的拼接顺序）。
- 纯前端改动，IPC 契约不动。

## 关键文件

- `src/components/diff/ConflictView.vue`（唯一主改文件，983 行，单组件全量改造）
- `src/lib/highlight.ts`：复用 `highlightLine`、`EXT_TO_LANG`
- `src/i18n/locales/zh-CN.ts` + `src/i18n/locales/en.ts`：新增几条 per-line / 只读 OUTPUT 相关的文案 key
- `docs/15-merge-rebase.md`：在「三路合并编辑器」行为段落补上「per-line 勾选 + OUTPUT 只读」这两条契约

## 实现清单

### 一、数据结构：hunk 级勾选 → line 级勾选

- [x] `hunkChoices` 从 `{ ours, theirs }[]` 改为 **per-row 的 Set**：
  - 新增 `type LineKey = 'a' | 'b'`（a=ours 侧某行，b=theirs 侧某行）
  - 新增 `const selectedRows = ref(new Set<number>())`，key 为 `rows[].` 的 row idx；一个 row 最多代表一行 ours 内容或一行 theirs 内容（changed 行同时带两侧，需拆成两个 key → 用 `'a:'+idx` / `'b:'+idx` 作为字符串 key）
  - `alignment` 不变；切换到 Set 后「哪一行参与 output」由 `selectedRows.has('a:'+idx)` 决定
- [x] 初始化策略：`watch(hunks, …)` 里 `selectedRows.value = new Set()` —— 全部不勾
- [x] `useAllOurs()` / `useAllTheirs()`：遍历 `rows.value`，把所有 hunk 行里的 `a:idx` 或 `b:idx` 一次性塞入 Set；同时清掉另一侧
- [x] 新增 `toggleRow(idx, side)`：往 Set 里 add/delete `${side}:${idx}`，用不可变赋值触发响应式（`selectedRows.value = new Set(prev)`）

### 二、synthesized / outputHunkRanges / rowIdxToOutputLine 重写

- [x] `synthesized`（第 175 行）：改为按 row idx 逐行判断，`equal` 行直接 push，hunk 行看 Set：
  ```
  for row idx in rows:
    if equal: push left
    else:
      if selected a:idx: push row.left
      if selected b:idx: push row.right
  ```
  注意 `changed` 状态的 row 自带 left + right，两边都可独立勾选
- [x] 删掉 `watch(synthesized, …)` 覆盖 `merged` 的那段（第 197-200 行）和 `mergedEditedByUser`（第 25、59、199、575 行）—— OUTPUT 不再可编辑
- [x] `outputHunkRanges`（第 203 行）：逐行计算时同样从 Set 取值
- [x] `rowIdxToOutputLine` / `outputLineToRowIdx`（第 265、288 行）：把「hunk 起始一次性推进 N 行」改成「每个参与行各推进 1 行」——这两个映射现在是逐行对齐

### 三、OUTPUT 从 textarea 改为逐行虚拟化渲染

- [x] 删 `outputTextareaRef` 和 `<textarea>`（第 226、569-577 行）
- [x] 新增 `paneOutputRowsRef` 和 `virtualizerO`（第三个 useVirtualizer），count 为 `synthesized.value.split('\n').length`（用 `computed outputLines = synthesized.split('\n')`）
- [x] 模板新增 `.pane.pane-o` 包在 `.panes` 里或单独一栏（见「布局」一节），内部结构与 A/B 对称：
  ```html
  <div class="rows" ref="paneOutputRowsRef" @scroll="onOutputScroll">
    <div class="rows-inner" :style="{ height: virtualizerO.getTotalSize() + 'px', ... }">
      <div v-for="vRow in virtualizerO.getVirtualItems()" class="row" ...>
        <span class="check-col" /> <!-- 留空占位保持三栏对齐 -->
        <span class="lineno">{{ vRow.index + 1 }}</span>
        <span class="code" v-html="highlightedOutputLines[vRow.index]" />
      </div>
    </div>
  </div>
  ```
- [x] `onOutputScroll` 改为基于行 idx：`topRow = floor(scrollTop / ROW_H)` → 同步 A/B 的 `scrollTop = rowIdxToOutputLine.inverse(topRow) * ROW_H`（其实直接用 `outputLineToRowIdx[topRow+1] * ROW_H` 即可）。`scrollLock` 三态保留
- [x] `scrollToHunk`（第 355 行）：去掉 textarea focus/selection 相关的代码（第 368-371 行），改为 `virtualizerO.value.scrollToIndex(range.start - 1, { align: 'center' })`

### 四、Per-line checkbox 渲染

- [x] A 栏模板的 `<input v-if="rows[vRow.index].isStart">`（第 490 行）去掉 `v-if`，改为「只要该 row 的 `left !== null` 且 `status !== 'equal'` 就渲染」：
  ```html
  <input
    v-if="rows[vRow.index].hunkId !== null && rows[vRow.index].left !== null"
    type="checkbox"
    :checked="selectedRows.has('a:' + vRow.index)"
    @click.stop
    @change="toggleRow(vRow.index, 'a')"
  />
  ```
- [x] B 栏同理，条件 `rows[vRow.index].right !== null`，`side = 'b'`
- [x] 整行点击改为 `toggleRow(vRow.index, 'a' | 'b')` 而非 `toggleSide(hunkId, ...)`；保留「点击某行 code 区域切换该侧勾选」的便捷交互
- [x] `row-selected` class 判据改为：A 栏看 `selectedRows.has('a:' + idx)`，B 栏看 `'b:' + idx`
- [x] 保留 `row-current` 对当前 hunk 的 outline 高亮（prev/next hunk 导航仍然按 hunk 粒度）

### 五、语法高亮接入（A / B / OUTPUT 三栏）

- [x] 在 `<script setup>` 顶部 import `highlightLine, EXT_TO_LANG` from `@/lib/highlight`
- [x] 新增 `const syntaxLang = computed(() => { const ext = filePath?.split('.').pop()?.toLowerCase(); return ext && EXT_TO_LANG[ext] ? EXT_TO_LANG[ext] : null })`
- [x] 新增 `highlightedLeft[idx]` / `highlightedRight[idx]`：按 row 预算高亮好的 HTML 字符串（computed），`null` 时返回 escape 后纯文本。注意 rows 数组长度可能几万级 —— 用 Map 缓存按行内容，或直接 computed 整表（highlightLine 对单行很快，几万行下也在几十 ms 级别，可接受）
- [x] 模板把 `{{ rows[i].left ?? '' }}` 改为 `<span class="code" v-html="highlightedLeft[i]" />`
- [x] 同样给 OUTPUT 的每行做高亮：`highlightedOutputLines[i]`
- [x] 确保 `highlightLine` 在 `syntaxLang === null` 时回退到 escape（已有）—— 不做高亮但也不破坏 XSS 防御
- [x] 把 `src/assets/main.css` 里 highlight.js 的 Catppuccin 主题变量确认已加载（`SideBySideDiff` 用了说明没问题，无需改动）

### 六、布局：三栏还是两栏 + OUTPUT？

**保留当前「上下两层」结构**（A|B 左右并排 + OUTPUT 在下）。理由：

- 用户期望的 per-line 勾选交互主要发生在 A/B 两侧 → 上方横向空间要足
- OUTPUT 改只读后仅作结果预览，放底部够用
- 三栏并排会挤压 code 区横向宽度（尤其单行较长时）

保留 `.panes` grid 两列 + `.output` 独立容器的现有布局；OUTPUT 的 `<textarea>` 换成 `<div class="rows">` 虚拟化块即可，CSS 几乎不变（`.output-text` 规则删掉，`.output` 内 `.rows` 复用 A/B 的 `.rows` 样式）。

### 七、i18n 调整

- [x] `src/i18n/locales/zh-CN.ts` 和 `en.ts` 的 `conflict.view.*`：
  - 删 `editHint` / `edited` / `markersPresent`（markersPresent 如果仍需提示"冲突标记未消除"需要另想一个触发条件——现在的 `merged.value` 不再被编辑，但依然可能在 ours/theirs 原始内容里带 `<<<<<<<`。保守起见保留 `hasMarkers` 检查 synthesized 结果）
  - 考虑新增 `perLineHint`（可选）："每行独立勾选，未勾选的行不会进入 output"——作为 toolbar 小字提示
- [x] 若文案改动仅限删除未用 key，可跳过本节

### 八、性能考量（CLAUDE.md 性能底线）

- 高亮：`highlightLine` 单行，几万行整表一次性算约几十 ms；若大仓库冲突文件很大，改为「按 virtualizer 的 `getVirtualItems` 惰性高亮 + Map 缓存」
- 虚拟化：新增第三个 virtualizer，不影响现有 A/B 两个
- Set 操作：`selectedRows` 切换时每次重建 Set 触发响应式，O(N) —— 可接受
- 不引入新依赖（highlight.js、@tanstack/vue-virtual 都已在）

### 九、文档同步

- [x] `docs/15-merge-rebase.md` 更新两处契约：
  1. 「三路合并编辑器」改为 OUTPUT 只读（描述行为，不贴代码）
  2. 勾选粒度：从「整块接受 ours/theirs」改为「可按行混合」
- [x] 本计划不新增 `docs/plan/` 条目（属于已立项的 merge-rebase 后续优化）；由实施时把本 plan 迁移到 `docs/plan/2026-04-17-03-conflict-per-line.md`

## 关键决策

1. **OUTPUT 只读**：per-line 勾选足够表达结果；手动编辑退路是"工作区打开文件 + 标记已解决"。避免 textarea / CodeMirror 引入的高亮/虚拟化复杂度。
2. **默认不勾**：用户明确选择；避免用户以为已采纳 ours 而错过 theirs 的变更。
3. **按 row idx 为 key 而非 hunk+offset**：row 是一级稳定索引，Set 存 `'a:'+idx` / `'b:'+idx` 简单直接；alignment 重算时 Set 会失效（正好也希望重置）。
4. **保留 hunk 概念用于导航**：prev/next hunk 按钮、`currentHunkIdx` outline 仍按 hunk 粒度，不因下沉到 line 而失去"整块"的视觉单位。
5. **不改 IPC**：`resolveConflict(filePath, content)` 仍接完整字符串；前端 synthesized 组装后一次写回。

## 验证方式

- [x] `npm run tauri dev`，构造一个包含多行冲突的测试仓库，执行 merge 触发冲突
- [x] 打开冲突文件三路编辑器：
  - [ ] A/B 栏每行有行号（48px 右对齐列）和语法高亮（如 `.ts` 文件高亮 `import` / `function` 等 token）
  - [ ] OUTPUT 栏有行号、有高亮，**不可编辑**（点击不进入编辑模式、无光标）
  - [ ] 初始状态：OUTPUT 内容 = 只包含 equal 行（因为默认全不勾）
  - [ ] 点击 A 栏某一行：OUTPUT 新增该行，滚动位置同步；再点 B 栏某一行：OUTPUT 追加该行
  - [ ] 顶部「Use all ours」：OUTPUT 变为所有 equal + ours 行；点「Use all theirs」：切换为 equal + theirs
  - [ ] 混合：勾 ours 某几行 + theirs 某几行，OUTPUT 反映组合
  - [ ] 三栏垂直滚动互相同步
  - [ ] 保存后 `git status` 显示该文件从 conflict 转为已暂存
- [x] 大文件（几千行、几十个冲突块）下滚动流畅、无明显卡顿
- [x] 二进制冲突文件：仍走 `conflict?.is_binary` 分支，不进入三栏视图
- [x] `npx vue-tsc --noEmit` 通过
- [x] `cd src-tauri && cargo check` 通过（无 Rust 改动，预期稳过）
- [x] 中英文 locale 切换：toolbar 按钮、提示文字都正确本地化
