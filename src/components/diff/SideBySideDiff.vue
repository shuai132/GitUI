<script setup lang="ts">
import { computed, ref, watch, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import type { FileDiff, DiffLine } from '@/types/git'
import { highlightLine } from '@/lib/highlight'
import { diffChars, tokensToHtml } from '@/lib/wordDiff'

const { t } = useI18n()

const props = defineProps<{
  diff: FileDiff | null
  loading?: boolean
  /** 语法高亮语言（null 表示关闭高亮） */
  syntaxLang?: string | null
}>()

interface AlignedLine {
  lineNo?: number
  content: string
  kind: 'del' | 'add' | 'ctx' | 'empty' | 'header'
  /** 开启 word-diff 时替代 content 的 HTML（已转义 + <mark> 标注）；null = 用 content */
  wordHtml?: string
}

interface AlignedRow {
  left: AlignedLine
  right: AlignedLine
}

const alignedRows = computed((): AlignedRow[] => {
  if (!props.diff) return []
  const rows: AlignedRow[] = []

  for (const hunk of props.diff.hunks) {
    // Hunk header row
    rows.push({
      left: { content: hunk.header.trimEnd(), kind: 'header' },
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
        const dlContent = dl ? dl.content.replace(/\n$/, '') : ''
        const alContent = al ? al.content.replace(/\n$/, '') : ''

        // Word-diff：仅当左右都有内容时配对计算（语法高亮关闭时生效，避免与 v-html 冲突）
        let leftWordHtml: string | undefined
        let rightWordHtml: string | undefined
        if (dl && al && !props.syntaxLang) {
          const { leftTokens, rightTokens } = diffChars(dlContent, alContent)
          leftWordHtml = tokensToHtml(leftTokens)
          rightWordHtml = tokensToHtml(rightTokens)
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
        const content = line.content.replace(/\n$/, '')
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

const currentChangeIdx = ref(-1)

// 当 diff 变化时重置指针
watch(alignedRows, () => {
  currentChangeIdx.value = -1
})

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

defineExpose({ goNextChange, goPrevChange })
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
                :class="'line-' + row.left.kind"
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
                   :class="'line-' + row.left.kind"
                   :data-row="i"
                 >
                   <span v-if="syntaxLang" class="code" v-html="highlightLine(row.left.content, syntaxLang)" />
                   <span v-else-if="row.left.wordHtml" class="code" v-html="row.left.wordHtml" />
                   <span v-else class="code">{{ row.left.content }}</span>
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
                :class="'line-' + row.right.kind"
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
                   :class="'line-' + row.right.kind"
                 >
                   <span v-if="syntaxLang" class="code" v-html="highlightLine(row.right.content, syntaxLang)" />
                   <span v-else-if="row.right.wordHtml" class="code" v-html="row.right.wordHtml" />
                   <span v-else class="code">{{ row.right.content }}</span>
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
  min-height: 18px;
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
  align-items: flex-start;
  white-space: pre;
  min-height: 18px;
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
</style>
