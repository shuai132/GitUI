<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { FileDiff } from '@/types/git'
import { highlightLine } from '@/lib/highlight'
import type { DiffSide, SyntaxLangResolver } from '@/lib/highlight'
import { diffChars, tokensToHtml } from '@/lib/wordDiff'
import { buildFullInlineRows, type FullFileContent } from '@/lib/fullFileDiff'

const { t } = useI18n()

const props = defineProps<{
  diff: FileDiff | null
  loading?: boolean
  /** true → 每个 hunk 独立成块，块间有空隙；false → 所有 hunk 连续显示 */
  groupByHunk: boolean
  /** 语法高亮语言（null 表示关闭高亮） */
  syntaxLang?: string | null
  /** 按左右侧和文件行号解析语法高亮语言，用于 Vue SFC 这类嵌入语言文件。 */
  syntaxLangForLine?: SyntaxLangResolver | null
  /** inline 连续模式使用的完整旧 / 新文件内容；为空时回退到 hunk-only。 */
  fullFileContent?: FullFileContent | null
  /** 变化时重置当前 diff 滚动位置，用于切换到另一个文件/提交上下文。 */
  scrollResetKey?: string | null
  /** 按 hunk 分组时展示的 hunk 操作文案；为空则不展示操作入口。 */
  hunkActionLabel?: string | null
  /** 按 hunk 分组时展示的 hunk 放弃操作文案；为空则不展示操作入口。 */
  hunkDiscardLabel?: string | null
}>()

const emit = defineEmits<{
  'hunk-action': [hunkIndex: number]
  'hunk-discard': [hunkIndex: number]
}>()

const canRunHunkAction = computed(() => props.hunkActionLabel != null && props.groupByHunk)
const canDiscardHunk = computed(() => props.hunkDiscardLabel != null && props.groupByHunk)

interface InlineRow {
  kind: 'header' | 'del' | 'add' | 'ctx'
  oldLineNo?: number
  newLineNo?: number
  content: string
  hunkIndex?: number
  isHunkStart?: boolean
  /** Word-diff HTML（语法高亮关闭时对配对 del/add 生效）*/
  wordHtml?: string
}

interface DiffScrollAnchor {
  oldLineNo?: number
  newLineNo?: number
}

const rows = computed<InlineRow[]>(() => {
  if (!props.diff) return []
  const baseRows =
    !props.groupByHunk && props.fullFileContent
      ? buildFullInlineRows(props.diff, props.fullFileContent)
      : buildHunkRows(props.diff)

  return addInlineWordDiff(baseRows)
})

/** 扁平化所有 hunk → InlineRow[]，用于 by-hunk 和完整内容不可用时的回退。 */
function buildHunkRows(diff: FileDiff): InlineRow[] {
  const result: InlineRow[] = []
  diff.hunks.forEach((hunk, hi) => {
    result.push({
      kind: 'header',
      content: (hunk.header ?? '').trimEnd(),
      hunkIndex: hi,
    })
    for (const line of hunk.lines) {
      const content = (line.content ?? '').replace(/\n$/, '')
      if (line.origin === '-') {
        result.push({ kind: 'del', oldLineNo: line.old_lineno, content, hunkIndex: hi })
      } else if (line.origin === '+') {
        result.push({ kind: 'add', newLineNo: line.new_lineno, content, hunkIndex: hi })
      } else {
        result.push({ kind: 'ctx', oldLineNo: line.old_lineno, newLineNo: line.new_lineno, content, hunkIndex: hi })
      }
    }
  })
  return result
}

function addInlineWordDiff(sourceRows: InlineRow[]): InlineRow[] {
  if (props.syntaxLang || props.syntaxLangForLine) return sourceRows

  const result: InlineRow[] = []
  for (let i = 0; i < sourceRows.length; i++) {
    const cur = { ...sourceRows[i] }
    const nxt = sourceRows[i + 1]
    if (cur.kind === 'del' && nxt?.kind === 'add') {
      const nextRow = { ...nxt }
      const { leftTokens, rightTokens } = diffChars(cur.content, nextRow.content)
      cur.wordHtml = tokensToHtml(leftTokens)
      nextRow.wordHtml = tokensToHtml(rightTokens)
      result.push(cur, nextRow)
      i++
      continue
    }
    result.push(cur)
  }
  return result
}

/** 按 hunk 分组，用于 by-hunk 模式 */
const hunkGroups = computed(() => {
  const groups: InlineRow[][] = []
  let cur: InlineRow[] = []
  let curHi: number | undefined
  for (const row of rows.value) {
    if (row.hunkIndex !== curHi) {
      if (cur.length > 0) groups.push(cur)
      cur = []
      curHi = row.hunkIndex
    }
    cur.push(row)
  }
  if (cur.length > 0) groups.push(cur)
  return groups
})

// ── 变更跳转 ─────────────────────────────────────────────────────
const changeStarts = computed<number[]>(() => {
  const rs = rows.value
  const starts: number[] = []
  let inGroup = false
  for (let i = 0; i < rs.length; i++) {
    const r = rs[i]
    const isChange = r.kind === 'del' || r.kind === 'add'
    if (isChange) {
      if (!inGroup) {
        starts.push(i)
        inGroup = true
      }
    } else {
      inGroup = false
    }
  }
  return starts
})

const currentChangeIdx = ref(-1)
const scrollEl = ref<HTMLElement | null>(null)

watch(rows, () => {
  currentChangeIdx.value = -1
})

watch(
  () => props.scrollResetKey,
  async (next, prev) => {
    if (next === prev) return
    await nextTick()
    scrollToTop()
  },
  { flush: 'post' },
)

function langForRow(row: InlineRow): string | null {
  if (props.syntaxLang) return props.syntaxLang
  if (!props.syntaxLangForLine) return null
  const side: DiffSide = row.kind === 'del' ? 'old' : 'new'
  const lineNo = row.kind === 'del' ? row.oldLineNo : row.newLineNo
  return props.syntaxLangForLine(side, lineNo)
}

function scrollToRow(rowIndex: number) {
  const root = scrollEl.value
  if (!root) return
  const el = root.querySelector(
    `[data-row="${rowIndex}"]`,
  ) as HTMLElement | null
  if (!el) return
  const elTopInRoot = elementTopInScroll(root, el)
  const targetY = elTopInRoot - root.clientHeight / 2 + el.offsetHeight / 2
  root.scrollTo({ top: Math.max(0, targetY), behavior: 'smooth' })
}

function scrollToRowStart(rowIndex: number) {
  const root = scrollEl.value
  if (!root) return
  const el = root.querySelector(
    `[data-row="${rowIndex}"]`,
  ) as HTMLElement | null
  if (!el) return
  root.scrollTo({ top: Math.max(0, elementTopInScroll(root, el)), behavior: 'auto' })
}

function getScrollAnchor(): DiffScrollAnchor | null {
  const root = scrollEl.value
  if (!root) return null
  const rootTop = root.getBoundingClientRect().top
  const lineEls = Array.from(root.querySelectorAll<HTMLElement>('[data-row]'))
  for (const el of lineEls) {
    if (el.getBoundingClientRect().bottom <= rootTop + 0.5) continue
    const index = Number(el.dataset.row)
    const row = rows.value[index]
    if (!row || row.kind === 'header') continue
    if (row.oldLineNo == null && row.newLineNo == null) continue
    return { oldLineNo: row.oldLineNo, newLineNo: row.newLineNo }
  }
  return null
}

function elementTopInScroll(root: HTMLElement, el: HTMLElement): number {
  const rootRect = root.getBoundingClientRect()
  const elRect = el.getBoundingClientRect()
  return elRect.top - rootRect.top + root.scrollTop
}

function scrollToLine(anchor: DiffScrollAnchor) {
  const targetIndex = findBestRowIndex(anchor)
  if (targetIndex == null) return
  scrollToRowStart(targetIndex)
}

function scrollToTop() {
  const root = scrollEl.value
  if (!root) return
  root.scrollTop = 0
  root.scrollLeft = 0
}

function findBestRowIndex(anchor: DiffScrollAnchor): number | null {
  let fallbackIndex: number | null = null
  let fallbackDistance = Number.POSITIVE_INFINITY

  for (let i = 0; i < rows.value.length; i++) {
    const row = rows.value[i]
    if (row.kind === 'header') continue
    if (row.newLineNo != null && row.newLineNo === anchor.newLineNo) return i
    if (row.oldLineNo != null && row.oldLineNo === anchor.oldLineNo) return i

    const distance = lineDistance(row, anchor)
    if (distance < fallbackDistance) {
      fallbackDistance = distance
      fallbackIndex = i
    }
  }

  return fallbackIndex
}

function lineDistance(row: InlineRow, anchor: DiffScrollAnchor): number {
  const distances: number[] = []
  if (row.newLineNo != null && anchor.newLineNo != null) {
    distances.push(Math.abs(row.newLineNo - anchor.newLineNo))
  }
  if (row.oldLineNo != null && anchor.oldLineNo != null) {
    distances.push(Math.abs(row.oldLineNo - anchor.oldLineNo))
  }
  return distances.length > 0 ? Math.min(...distances) : Number.POSITIVE_INFINITY
}

function goNextChange() {
  const starts = changeStarts.value
  if (starts.length === 0) return
  currentChangeIdx.value = (currentChangeIdx.value + 1) % starts.length
  scrollToRow(starts[currentChangeIdx.value])
}

function goPrevChange() {
  const starts = changeStarts.value
  if (starts.length === 0) return
  currentChangeIdx.value =
    currentChangeIdx.value <= 0
      ? starts.length - 1
      : currentChangeIdx.value - 1
  scrollToRow(starts[currentChangeIdx.value])
}

defineExpose({ goNextChange, goPrevChange, getScrollAnchor, scrollToLine })
</script>

<template>
  <div class="inline-diff">
    <div v-if="loading" class="inline-state">{{ t('diff.empty.loading') }}</div>
    <div v-else-if="!diff" class="inline-state">{{ t('diff.empty.selectFile') }}</div>
    <div v-else-if="diff.is_binary" class="inline-state">{{ t('diff.empty.binaryFile') }}</div>
    <div v-else-if="diff.hunks.length === 0 || rows.length === 0" class="inline-state">{{ t('diff.empty.noChanges') }}</div>

    <!-- 连续模式（所有 hunk 串联）-->
    <div
      v-else-if="!groupByHunk"
      ref="scrollEl"
      class="inline-scroll"
    >
      <div class="inline-lines">
        <div
          v-for="(row, i) in rows"
          :key="i"
          class="inline-line"
          :class="'line-' + row.kind"
          :data-row="i"
        >
          <template v-if="row.kind === 'header'">
            <span class="line-header-content">{{ row.content }}</span>
          </template>
          <template v-else>
            <span class="ln">{{ row.oldLineNo ?? '' }}</span>
            <span class="ln">{{ row.newLineNo ?? '' }}</span>
            <span class="sign">{{
              row.kind === 'del' ? '-' : row.kind === 'add' ? '+' : ' '
            }}</span>
            <span v-if="langForRow(row)" class="code" v-html="highlightLine(row.content, langForRow(row))" />
            <span v-else-if="row.wordHtml" class="code" v-html="row.wordHtml" />
            <span v-else class="code">{{ row.content }}</span>
          </template>
        </div>
      </div>
    </div>

    <!-- 按 hunk 分块模式 -->
    <div
      v-else
      ref="scrollEl"
      class="inline-scroll"
    >
      <div class="inline-lines">
        <div
          v-for="(group, gi) in hunkGroups"
          :key="gi"
          class="hunk-block"
        >
          <template v-for="(row, i) in group" :key="i">
            <div
              v-if="row.kind === 'header'"
              class="hunk-header"
              :data-row="rows.indexOf(row)"
            >
              <span class="hunk-header-title">{{ row.content }}</span>
              <span v-if="row.hunkIndex != null && (canRunHunkAction || canDiscardHunk)" class="hunk-actions">
                <button
                  v-if="canRunHunkAction"
                  class="hunk-action-btn"
                  @click.stop="emit('hunk-action', row.hunkIndex)"
                >
                  {{ hunkActionLabel }}
                </button>
                <button
                  v-if="canDiscardHunk"
                  class="hunk-action-btn hunk-action-btn--danger"
                  @click.stop="emit('hunk-discard', row.hunkIndex)"
                >
                  {{ hunkDiscardLabel }}
                </button>
              </span>
            </div>
            <div
              v-else
              class="inline-line"
              :class="'line-' + row.kind"
              :data-row="rows.indexOf(row)"
            >
              <span class="ln">{{ row.oldLineNo ?? '' }}</span>
              <span class="ln">{{ row.newLineNo ?? '' }}</span>
              <span class="sign">{{
                row.kind === 'del' ? '-' : row.kind === 'add' ? '+' : ' '
              }}</span>
              <span v-if="langForRow(row)" class="code" v-html="highlightLine(row.content, langForRow(row))" />
              <span v-else class="code">{{ row.content }}</span>
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.inline-diff {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: var(--bg-primary);
  font-family: var(--code-font-family, 'SF Mono', 'Fira Code', 'Cascadia Code', monospace);
  font-size: var(--code-font-size, 12px);
  line-height: 18px;
}

.inline-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: var(--font-base);
}

.inline-scroll {
  flex: 1;
  overflow: auto;
}

/* ── 连续模式 ─────────────────────────────────────────────────── */
/* padding-bottom 避免水平滚动条遮挡最后一行代码 */
.inline-lines {
  min-width: min-content;
  padding-bottom: 8px;
}

/* ── 分块模式 ─────────────────────────────────────────────────── */
.hunk-block {
  margin-bottom: 14px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-primary);
}
.hunk-block:last-child {
  margin-bottom: 0;
}
/* 用首尾子元素自身圆角替代 overflow:hidden，避免横向裁剪导致无法滚动 */
.hunk-block > :first-child {
  border-top-left-radius: 4px;
  border-top-right-radius: 4px;
}
.hunk-block > :last-child {
  border-bottom-left-radius: 4px;
  border-bottom-right-radius: 4px;
}

.hunk-header {
  padding: 6px 12px;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border);
  color: var(--text-muted);
  font-size: var(--font-sm);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.hunk-header-title {
  white-space: pre;
}

.hunk-actions {
  position: sticky;
  right: 12px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
}

.hunk-action-btn {
  padding: 2px 8px;
  font-size: 11px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s;
  user-select: none;
  white-space: nowrap;
}

.hunk-action-btn:hover {
  background: var(--bg-overlay);
  color: var(--text-primary);
  border-color: var(--text-muted);
}

.hunk-action-btn--danger {
  color: var(--accent-red);
  border-color: color-mix(in srgb, var(--accent-red) 45%, var(--border));
}

.hunk-action-btn--danger:hover {
  color: var(--accent-red);
  border-color: var(--accent-red);
}

/* ── 行结构 ───────────────────────────────────────────────────── */
.inline-line {
  display: flex;
  align-items: flex-start;
  min-height: 18px;
  white-space: pre;
}

.inline-line.line-header {
  background: var(--bg-surface);
  color: var(--text-muted);
  font-size: var(--font-sm);
  padding: 2px 12px;
}

.line-header-content {
  flex: 1;
  padding-left: 10px;
}

.line-del {
  background: var(--diff-del-bg);
}
.line-del .sign {
  color: var(--accent-red);
}

.line-add {
  background: var(--diff-add-bg);
}
.line-add .sign {
  color: var(--accent-green);
}

.ln {
  width: 44px;
  text-align: right;
  padding-right: 10px;
  color: var(--text-muted);
  flex-shrink: 0;
  font-size: var(--font-sm);
  /* 行号不可选（覆盖全局 diff 允许选择规则） */
  user-select: none;
  -webkit-user-select: none;
}

.sign {
  width: 16px;
  flex-shrink: 0;
  text-align: center;
  user-select: none;
  -webkit-user-select: none;
}

.code {
  flex-shrink: 0;
  padding-right: 8px;
}

/* diff 正文可复制 */
.inline-lines,
.inline-lines *,
.hunk-block,
.hunk-block * {
  user-select: text;
  -webkit-user-select: text;
}

/* 行号/符号列覆盖（比 .inline-lines * 特异性高） */
.inline-line .ln,
.inline-line .sign,
.hunk-header {
  user-select: none;
  -webkit-user-select: none;
}
</style>
