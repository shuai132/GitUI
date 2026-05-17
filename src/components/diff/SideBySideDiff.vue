<script setup lang="ts">
import { computed, nextTick, ref, watch, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import type { FileDiff, DiffLine } from '@/types/git'
import { highlightLine } from '@/lib/highlight'
import type { DiffSide, SyntaxLangResolver } from '@/lib/highlight'
import { diffLinePairHtml } from '@/lib/diffLineHtml'
import { buildFullSideBySideRows, type FullFileContent } from '@/lib/fullFileDiff'

const { t } = useI18n()

const props = withDefaults(defineProps<{
  diff: FileDiff | null
  loading?: boolean
  /** true 时保持按 hunk 块展示；false 时优先显示完整文件。 */
  groupByHunk?: boolean
  /** 语法高亮语言（null 表示关闭高亮） */
  syntaxLang?: string | null
  /** 按左右侧和文件行号解析语法高亮语言，用于 Vue SFC 这类嵌入语言文件。 */
  syntaxLangForLine?: SyntaxLangResolver | null
  /** 完整旧 / 新文件内容；为空时回退到 hunk-only。 */
  fullFileContent?: FullFileContent | null
  /** 变化时重置当前 diff 滚动位置，用于切换到另一个文件/提交上下文。 */
  scrollResetKey?: string | null
  /** 父级统一维护的当前变更块索引。-1 表示尚未定位。 */
  currentChangeIdx?: number
  /** 按 hunk 分组时展示的 hunk 操作文案；为空则不展示操作入口。 */
  hunkActionLabel?: string | null
  /** 按 hunk 分组时展示的 hunk 放弃操作文案；为空则不展示操作入口。 */
  hunkDiscardLabel?: string | null
}>(), {
  currentChangeIdx: -1,
})

const emit = defineEmits<{
  'hunk-action': [hunkIndex: number]
  'hunk-discard': [hunkIndex: number]
  'update-current-change': [index: number]
  'change-count': [count: number]
}>()

const canRunHunkAction = computed(() => props.hunkActionLabel != null && props.groupByHunk === true)
const canDiscardHunk = computed(() => props.hunkDiscardLabel != null && props.groupByHunk === true)

interface AlignedLine {
  lineNo?: number
  content: string
  kind: 'del' | 'add' | 'ctx' | 'empty' | 'header'
  /** 配对 del/add 行的 HTML（语法高亮 + <mark> 变化标注）；null = 用 content */
  wordHtml?: string
  hunkIndex?: number
  isHunkStart?: boolean
}

interface AlignedRow {
  left: AlignedLine
  right: AlignedLine
}

interface DiffScrollAnchor {
  oldLineNo?: number
  newLineNo?: number
}

const alignedRows = computed((): AlignedRow[] => {
  if (!props.diff) return []
  if (!props.groupByHunk && props.fullFileContent) {
    return addSideBySideWordDiff(buildFullSideBySideRows(props.diff, props.fullFileContent))
  }

  const rows: AlignedRow[] = []

  for (let hi = 0; hi < props.diff.hunks.length; hi++) {
    const hunk = props.diff.hunks[hi]
    // Hunk header row
    rows.push({
      left: { content: (hunk.header ?? '').trimEnd(), kind: 'header', hunkIndex: hi },
      right: { content: '', kind: 'header' },
    })

    // Process lines within this hunk using a state machine
    let delBuf: DiffLine[] = []
    let addBuf: DiffLine[] = []

    function flushBuffers() {
      const maxLen = Math.max(delBuf.length, addBuf.length)
      for (let i = 0; i < maxLen; i++) {
        const dl = delBuf[i]
        const al = addBuf[i]
        const dlContent = (dl && dl.content) ? dl.content.replace(/\n$/, '') : ''
        const alContent = (al && al.content) ? al.content.replace(/\n$/, '') : ''

        let leftWordHtml: string | undefined
        let rightWordHtml: string | undefined
        if (dl && al) {
          const { leftHtml, rightHtml } = diffLinePairHtml(
            dlContent,
            alContent,
            langForDiffLine('old', dl.old_lineno),
            langForDiffLine('new', al.new_lineno),
          )
          leftWordHtml = leftHtml
          rightWordHtml = rightHtml
        }

        rows.push({
          left: dl
            ? { lineNo: dl.old_lineno, content: dlContent, kind: 'del', wordHtml: leftWordHtml }
            : { content: '', kind: 'empty' },
          right: al
            ? { lineNo: al.new_lineno, content: alContent, kind: 'add', wordHtml: rightWordHtml }
            : { content: '', kind: 'empty' },
        })
      }
      delBuf = []
      addBuf = []
    }

    for (const line of hunk.lines) {
      if (line.origin === '-') {
        delBuf.push(line)
      } else if (line.origin === '+') {
        addBuf.push(line)
      } else {
        // Context line — flush pending del/add first
        flushBuffers()
        const content = (line.content ?? '').replace(/\n$/, '')
        rows.push({
          left: { lineNo: line.old_lineno, content, kind: 'ctx' },
          right: { lineNo: line.new_lineno, content, kind: 'ctx' },
        })
      }
    }
    flushBuffers()
  }

  return rows
})

function addSideBySideWordDiff(sourceRows: AlignedRow[]): AlignedRow[] {
  return sourceRows.map((row) => {
    if (row.left.kind !== 'del' || row.right.kind !== 'add') return row

    const { leftHtml, rightHtml } = diffLinePairHtml(
      row.left.content,
      row.right.content,
      langForDiffLine('old', row.left.lineNo),
      langForDiffLine('new', row.right.lineNo),
    )
    return {
      left: {
        ...row.left,
        wordHtml: leftHtml,
      },
      right: {
        ...row.right,
        wordHtml: rightHtml,
      },
    }
  })
}

function langForDiffLine(side: DiffSide, lineNo: number | null | undefined): string | null {
  if (props.syntaxLang) return props.syntaxLang
  if (!props.syntaxLangForLine) return null
  return props.syntaxLangForLine(side, lineNo)
}

// ── 滚动架构 ────────────────────────────────────────────────────────
// 垂直滚动：bodyRef 是唯一的 overflow-y:auto 容器，左右天然同步。
// 水平滚动：每个 pane 的 .pane-scroll 独立 overflow-x:auto，JS 同步 scrollLeft。
// 行号列（.pane-gutter）在 .pane-scroll 外面，不参与水平滚动，天然固定。
// .pane-scroll 是 scroll container 会拦截垂直 wheel，
// 通过 @wheel 把 deltaY 转发到 bodyRef。
const bodyRef = ref<HTMLElement | null>(null)
const leftScrollRef = ref<HTMLElement | null>(null)
const rightScrollRef = ref<HTMLElement | null>(null)

// ── wheel 转发：把 pane-scroll 拦截的垂直 wheel 转发到 bodyRef ──────
function onWheel(e: WheelEvent) {
  const body = bodyRef.value
  if (!body) return
  if (e.deltaY !== 0) body.scrollTop += e.deltaY
  if (e.deltaX !== 0) (e.currentTarget as HTMLElement).scrollLeft += e.deltaX
  e.preventDefault()
}

// ── 水平滚动同步（rAF 轮询） ───────────────────────────────────────
let hSyncSrc: 'left' | 'right' | null = null
let hRaf = 0
let hIdle = 0

function hSyncFrame() {
  const src = hSyncSrc === 'left' ? leftScrollRef.value : rightScrollRef.value
  const dst = hSyncSrc === 'left' ? rightScrollRef.value : leftScrollRef.value
  if (src && dst && dst.scrollLeft !== src.scrollLeft) {
    dst.scrollLeft = src.scrollLeft
  }
  hIdle++
  if (hIdle < 10) {
    hRaf = requestAnimationFrame(hSyncFrame)
  } else {
    hSyncSrc = null
    hRaf = 0
  }
}

function onHScroll(source: 'left' | 'right') {
  if (hSyncSrc && hSyncSrc !== source) return
  hSyncSrc = source
  hIdle = 0
  if (!hRaf) hRaf = requestAnimationFrame(hSyncFrame)
}

onUnmounted(() => {
  if (hRaf) { cancelAnimationFrame(hRaf); hRaf = 0 }
})

// ── 变更跳转 ────────────────────────────────────────────────────────
// 连续 del/add 行组的起始行索引列表；ctx/header 行充当分隔
const changeStarts = computed<number[]>(() => {
  const rows = alignedRows.value
  const starts: number[] = []
  let inGroup = false
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const isChange = r.left.kind === 'del' || r.right.kind === 'add'
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

const currentChangeRange = computed<{ start: number; end: number } | null>(() => {
  const start = changeStarts.value[props.currentChangeIdx]
  if (start == null) return null

  const rows = alignedRows.value
  let end = start
  while (end + 1 < rows.length && isChangeRow(rows[end + 1])) {
    end++
  }
  return { start, end }
})

watch(changeStarts, (starts) => {
  emit('change-count', starts.length)
  if (props.currentChangeIdx >= starts.length) emit('update-current-change', -1)
}, { immediate: true })

watch(
  () => props.scrollResetKey,
  async (next, prev) => {
    if (next === prev) return
    await nextTick()
    scrollToTop()
  },
  { flush: 'post' },
)

function langForLine(side: DiffSide, line: AlignedLine): string | null {
  return langForDiffLine(side, line.lineNo)
}

function isChangeRow(row: AlignedRow): boolean {
  return row.left.kind === 'del' || row.right.kind === 'add'
}

function changeCurrentClasses(rowIndex: number): Record<string, boolean> {
  const range = currentChangeRange.value
  const isCurrent = range != null && rowIndex >= range.start && rowIndex <= range.end
  return {
    'change-current': isCurrent,
    'change-current-start': isCurrent && rowIndex === range?.start,
    'change-current-end': isCurrent && rowIndex === range?.end,
  }
}

function scrollToRow(rowIndex: number) {
  const body = bodyRef.value
  const scroll = leftScrollRef.value
  if (!body || !scroll) return
  const el = scroll.querySelector(
    `[data-row="${rowIndex}"]`,
  ) as HTMLElement | null
  if (!el) return
  // 用 getBoundingClientRect 计算精确位置，不依赖 offsetParent
  const bodyRect = body.getBoundingClientRect()
  const elRect = el.getBoundingClientRect()
  const elTopInBody = elRect.top - bodyRect.top + body.scrollTop
  const targetY = elTopInBody - body.clientHeight / 2 + el.offsetHeight / 2
  body.scrollTo({ top: Math.max(0, targetY), behavior: 'smooth' })
}

function scrollToRowStart(rowIndex: number) {
  const body = bodyRef.value
  const scroll = leftScrollRef.value
  if (!body || !scroll) return
  const el = scroll.querySelector(
    `[data-row="${rowIndex}"]`,
  ) as HTMLElement | null
  if (!el) return
  const bodyRect = body.getBoundingClientRect()
  const elRect = el.getBoundingClientRect()
  const elTopInBody = elRect.top - bodyRect.top + body.scrollTop
  body.scrollTo({ top: Math.max(0, elTopInBody), behavior: 'auto' })
}

function getScrollAnchor(): DiffScrollAnchor | null {
  const body = bodyRef.value
  const scroll = leftScrollRef.value
  if (!body || !scroll) return null
  const bodyTop = body.getBoundingClientRect().top
  const lineEls = Array.from(scroll.querySelectorAll<HTMLElement>('[data-row]'))
  for (const el of lineEls) {
    if (el.getBoundingClientRect().bottom <= bodyTop + 0.5) continue
    const index = Number(el.dataset.row)
    const row = alignedRows.value[index]
    if (!row) continue
    const oldLineNo = row.left.lineNo
    const newLineNo = row.right.lineNo
    if (oldLineNo == null && newLineNo == null) continue
    return { oldLineNo, newLineNo }
  }
  return null
}

function scrollToLine(anchor: DiffScrollAnchor) {
  const targetIndex = findBestRowIndex(anchor)
  if (targetIndex == null) return
  scrollToRowStart(targetIndex)
}

function scrollToTop() {
  const body = bodyRef.value
  if (body) body.scrollTop = 0
  const left = leftScrollRef.value
  const right = rightScrollRef.value
  if (left) left.scrollLeft = 0
  if (right) right.scrollLeft = 0
}

function findBestRowIndex(anchor: DiffScrollAnchor): number | null {
  let fallbackIndex: number | null = null
  let fallbackDistance = Number.POSITIVE_INFINITY

  for (let i = 0; i < alignedRows.value.length; i++) {
    const row = alignedRows.value[i]
    if (row.right.lineNo != null && row.right.lineNo === anchor.newLineNo) return i
    if (row.left.lineNo != null && row.left.lineNo === anchor.oldLineNo) return i

    const distance = rowDistance(row, anchor)
    if (distance < fallbackDistance) {
      fallbackDistance = distance
      fallbackIndex = i
    }
  }

  return fallbackIndex
}

function rowDistance(row: AlignedRow, anchor: DiffScrollAnchor): number {
  const distances: number[] = []
  if (row.right.lineNo != null && anchor.newLineNo != null) {
    distances.push(Math.abs(row.right.lineNo - anchor.newLineNo))
  }
  if (row.left.lineNo != null && anchor.oldLineNo != null) {
    distances.push(Math.abs(row.left.lineNo - anchor.oldLineNo))
  }
  return distances.length > 0 ? Math.min(...distances) : Number.POSITIVE_INFINITY
}

function goNextChange() {
  const starts = changeStarts.value
  if (starts.length === 0) return
  const nextIndex = (props.currentChangeIdx + 1) % starts.length
  emit('update-current-change', nextIndex)
  scrollToRow(starts[nextIndex])
}

function goPrevChange() {
  const starts = changeStarts.value
  if (starts.length === 0) return
  const nextIndex =
    props.currentChangeIdx <= 0
      ? starts.length - 1
      : props.currentChangeIdx - 1
  emit('update-current-change', nextIndex)
  scrollToRow(starts[nextIndex])
}

function hasChangeTargets(): boolean {
  return changeStarts.value.length > 0
}

defineExpose({ goNextChange, goPrevChange, hasChangeTargets, getScrollAnchor, scrollToLine })
</script>

<template>
  <div class="sbs-diff">
    <!-- Loading / empty states -->
    <div v-if="loading" class="sbs-state">{{ t('diff.empty.loading') }}</div>
    <div v-else-if="!diff" class="sbs-state">{{ t('diff.empty.selectCommit') }}</div>
    <div v-else-if="diff.is_binary" class="sbs-state">{{ t('diff.empty.binaryFile') }}</div>
    <div v-else-if="diff.hunks.length === 0" class="sbs-state">{{ t('diff.empty.noChanges') }}</div>

    <!-- Side-by-side content：
         bodyRef 统一垂直滚动；
         每个 pane 分为 gutter（固定行号）+ scroll（水平滚动代码）-->
    <template v-else>
      <div class="sbs-body" ref="bodyRef">
        <div class="sbs-inner">
          <!-- ─── 左侧 pane ─── -->
          <div class="sbs-pane">
            <div class="pane-gutter">
              <div
                v-for="(row, i) in alignedRows"
                :key="'gl' + i"
                class="gutter-row"
                :class="['line-' + row.left.kind, changeCurrentClasses(i)]"
              >
                <span class="ln">{{ row.left.lineNo ?? '' }}</span>
                <span class="sign">{{ row.left.kind === 'del' ? '-' : row.left.kind === 'ctx' ? ' ' : '' }}</span>
              </div>
            </div>
            <div
              class="pane-scroll"
              ref="leftScrollRef"
              @scroll="onHScroll('left')"
              @wheel="onWheel"
            >
              <div class="sbs-lines">
                   <div
                   v-for="(row, i) in alignedRows"
                   :key="'l' + i"
                   class="sbs-line"
                   :class="['line-' + row.left.kind, changeCurrentClasses(i)]"
                   :data-row="i"
                 >
                   <span v-if="row.left.wordHtml" class="code" v-html="row.left.wordHtml" />
                   <span v-else-if="langForLine('old', row.left)" class="code" v-html="highlightLine(row.left.content, langForLine('old', row.left))" />
                   <span v-else class="code">{{ row.left.content }}</span>
                   
                     <span
                       v-if="row.left.hunkIndex != null && (row.left.kind === 'header' || row.left.isHunkStart) && (canRunHunkAction || canDiscardHunk)"
                       class="hunk-actions"
                     >
                       <button
                         v-if="canRunHunkAction"
                         class="hunk-action-btn"
                         @click.stop="emit('hunk-action', row.left.hunkIndex)"
                       >
                         {{ hunkActionLabel }}
                       </button>
                       <button
                         v-if="canDiscardHunk"
                         class="hunk-action-btn hunk-action-btn--danger"
                         @click.stop="emit('hunk-discard', row.left.hunkIndex)"
                       >
                         {{ hunkDiscardLabel }}
                       </button>
                     </span>
                 </div>
              </div>
            </div>
          </div>

          <div class="sbs-divider" />

          <!-- ─── 右侧 pane ─── -->
          <div class="sbs-pane">
            <div class="pane-gutter">
              <div
                v-for="(row, i) in alignedRows"
                :key="'gr' + i"
                class="gutter-row"
                :class="['line-' + row.right.kind, changeCurrentClasses(i)]"
              >
                <span class="ln">{{ row.right.lineNo ?? '' }}</span>
                <span class="sign">{{ row.right.kind === 'add' ? '+' : row.right.kind === 'ctx' ? ' ' : '' }}</span>
              </div>
            </div>
            <div
              class="pane-scroll"
              ref="rightScrollRef"
              @scroll="onHScroll('right')"
              @wheel="onWheel"
            >
              <div class="sbs-lines">
                   <div
                   v-for="(row, i) in alignedRows"
                   :key="'r' + i"
                   class="sbs-line"
                   :class="['line-' + row.right.kind, changeCurrentClasses(i)]"
                 >
                   <span v-if="row.right.wordHtml" class="code" v-html="row.right.wordHtml" />
                   <span v-else-if="langForLine('new', row.right)" class="code" v-html="highlightLine(row.right.content, langForLine('new', row.right))" />
                   <span v-else class="code">{{ row.right.content }}</span>
                   <span
                     v-if="row.right.hunkIndex != null && row.right.isHunkStart && row.left.kind !== 'del' && (canRunHunkAction || canDiscardHunk)"
                     class="hunk-actions"
                   >
                     <button
                       v-if="canRunHunkAction"
                       class="hunk-action-btn"
                       @click.stop="emit('hunk-action', row.right.hunkIndex)"
                     >
                       {{ hunkActionLabel }}
                     </button>
                     <button
                       v-if="canDiscardHunk"
                       class="hunk-action-btn hunk-action-btn--danger"
                       @click.stop="emit('hunk-discard', row.right.hunkIndex)"
                     >
                       {{ hunkDiscardLabel }}
                     </button>
                   </span>
                 </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.sbs-diff {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: var(--bg-primary);
}

.sbs-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: var(--font-base);
}

/* bodyRef：唯一的垂直滚动容器，左右 pane 同处一个滚动上下文 */
.sbs-body {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  font-family: var(--code-font-family, 'SF Mono', 'Fira Code', 'Cascadia Code', monospace);
  font-size: var(--code-font-size, 12px);
  line-height: 18px;
  --diff-row-height: 18px;
}

/* Diff 正文允许文本选择 */
.sbs-body,
.sbs-body * {
  user-select: text;
  -webkit-user-select: text;
}

.sbs-inner {
  display: flex;
}

/* 每个 pane = gutter（固定）+ scroll（水平滚动） */
.sbs-pane {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
}

/* 行号列：不参与水平滚动，不是 scroll container，
   垂直 wheel 事件自然冒泡到 bodyRef */
.pane-gutter {
  flex-shrink: 0;
}

.gutter-row {
  display: flex;
  height: var(--diff-row-height);
  min-height: var(--diff-row-height);
  line-height: var(--diff-row-height);
}

/* 代码区：独立水平滚动 */
.pane-scroll {
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
}

/* inline-block wrapper 让宽度 = max(最长行, pane 宽度)，
   行背景色铺满整行。
   padding-bottom 避免水平滚动条遮挡最后一行代码 */
.sbs-lines {
  display: inline-block;
  min-width: 100%;
  padding-bottom: 8px;
}

.sbs-line {
  display: flex;
  align-items: center;
  white-space: pre;
  height: var(--diff-row-height);
  min-height: var(--diff-row-height);
  line-height: var(--diff-row-height);
  overflow: hidden;
}

.gutter-row.change-current,
.sbs-line.change-current {
  position: relative;
  z-index: 1;
}

.gutter-row.change-current {
  box-shadow: inset 3px 0 0 var(--accent-blue);
}

.sbs-line.change-current-start {
  box-shadow: inset 0 1px 0 color-mix(in srgb, var(--accent-blue) 64%, transparent);
}

.sbs-line.change-current-end {
  box-shadow: inset 0 -1px 0 color-mix(in srgb, var(--accent-blue) 64%, transparent);
}

.sbs-line.change-current-start.change-current-end {
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, var(--accent-blue) 64%, transparent),
    inset 0 -1px 0 color-mix(in srgb, var(--accent-blue) 64%, transparent);
}

.gutter-row.change-current-start {
  box-shadow:
    inset 3px 0 0 var(--accent-blue),
    inset 0 1px 0 color-mix(in srgb, var(--accent-blue) 64%, transparent);
}

.gutter-row.change-current-end {
  box-shadow:
    inset 3px 0 0 var(--accent-blue),
    inset 0 -1px 0 color-mix(in srgb, var(--accent-blue) 64%, transparent);
}

.gutter-row.change-current-start.change-current-end {
  box-shadow:
    inset 3px 0 0 var(--accent-blue),
    inset 0 1px 0 color-mix(in srgb, var(--accent-blue) 64%, transparent),
    inset 0 -1px 0 color-mix(in srgb, var(--accent-blue) 64%, transparent);
}

.sbs-divider {
  width: 1px;
  background: var(--border);
  flex-shrink: 0;
}

.ln {
  width: 44px;
  text-align: right;
  padding-right: 10px;
  color: var(--text-muted);
  flex-shrink: 0;
  user-select: none;
  font-size: var(--font-sm);
}

.sign {
  width: 16px;
  flex-shrink: 0;
  text-align: center;
  user-select: none;
}

.code {
  flex-shrink: 0;
  padding-right: 8px;
  line-height: inherit;
}

/* Line type backgrounds */
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

.line-empty {
  background: var(--diff-empty-bg);
}

.line-header {
  background: var(--bg-surface);
  color: var(--text-muted);
  font-size: var(--font-sm);
}

.line-ctx {
  color: var(--text-secondary);
}

.hunk-actions {
  position: sticky;
  right: 12px;
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.hunk-action-btn {
  box-sizing: border-box;
  height: 16px;
  padding: 0 8px;
  font-size: 11px;
  line-height: 14px;
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
</style>
