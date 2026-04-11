<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { FileDiff } from '@/types/git'
import { highlightLine } from '@/lib/highlight'

const props = defineProps<{
  diff: FileDiff | null
  loading?: boolean
  /** true → 每个 hunk 独立成块，块间有空隙；false → 所有 hunk 连续显示 */
  groupByHunk: boolean
  /** 语法高亮语言（null 表示关闭高亮） */
  syntaxLang?: string | null
}>()

interface InlineRow {
  kind: 'header' | 'del' | 'add' | 'ctx'
  oldLineNo?: number
  newLineNo?: number
  content: string
  hunkIndex: number
}

/** 扁平化所有 hunk → InlineRow[] */
const rows = computed<InlineRow[]>(() => {
  if (!props.diff) return []
  const result: InlineRow[] = []
  props.diff.hunks.forEach((hunk, hi) => {
    result.push({
      kind: 'header',
      content: hunk.header.trimEnd(),
      hunkIndex: hi,
    })
    for (const line of hunk.lines) {
      const content = line.content.replace(/\n$/, '')
      if (line.origin === '-') {
        result.push({
          kind: 'del',
          oldLineNo: line.old_lineno,
          content,
          hunkIndex: hi,
        })
      } else if (line.origin === '+') {
        result.push({
          kind: 'add',
          newLineNo: line.new_lineno,
          content,
          hunkIndex: hi,
        })
      } else {
        result.push({
          kind: 'ctx',
          oldLineNo: line.old_lineno,
          newLineNo: line.new_lineno,
          content,
          hunkIndex: hi,
        })
      }
    }
  })
  return result
})

/** 按 hunk 分组，用于 by-hunk 模式 */
const hunkGroups = computed(() => {
  const groups: InlineRow[][] = []
  let cur: InlineRow[] = []
  let curHi = -1
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

function scrollToRow(rowIndex: number) {
  const root = scrollEl.value
  if (!root) return
  const el = root.querySelector(
    `[data-row="${rowIndex}"]`,
  ) as HTMLElement | null
  if (!el) return
  const targetY =
    el.offsetTop - root.clientHeight / 2 + el.offsetHeight / 2
  root.scrollTo({ top: Math.max(0, targetY), behavior: 'smooth' })
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
  <div class="inline-diff">
    <div v-if="loading" class="inline-state">加载中...</div>
    <div v-else-if="!diff" class="inline-state">选择文件查看变更</div>
    <div v-else-if="diff.is_binary" class="inline-state">二进制文件</div>
    <div v-else-if="rows.length === 0" class="inline-state">无内容变更</div>

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
            <span v-if="syntaxLang" class="code" v-html="highlightLine(row.content, syntaxLang)" />
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
            {{ row.content }}
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
            <span v-if="syntaxLang" class="code" v-html="highlightLine(row.content, syntaxLang)" />
            <span v-else class="code">{{ row.content }}</span>
          </div>
        </template>
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
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
  font-size: 12px;
  line-height: 18px;
}

.inline-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: 13px;
}

.inline-scroll {
  flex: 1;
  overflow: auto;
}

/* ── 连续模式 ─────────────────────────────────────────────────── */
.inline-lines {
  min-width: min-content;
}

/* ── 分块模式 ─────────────────────────────────────────────────── */
.hunk-block {
  margin-bottom: 14px;
  border: 1px solid var(--border);
  border-radius: 4px;
  overflow: hidden;
  background: var(--bg-primary);
}
.hunk-block:last-child {
  margin-bottom: 0;
}

.hunk-header {
  padding: 6px 12px;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border);
  color: var(--text-muted);
  font-size: 11px;
  white-space: pre;
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
  font-size: 11px;
  padding: 2px 12px;
}

.line-header-content {
  flex: 1;
  padding-left: 10px;
}

.line-del {
  background: rgba(237, 135, 150, 0.18);
}
.line-del .sign {
  color: var(--accent-red);
}

.line-add {
  background: rgba(166, 218, 149, 0.18);
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
  font-size: 11px;
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
