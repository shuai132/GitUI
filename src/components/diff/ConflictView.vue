<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useVirtualizer } from '@tanstack/vue-virtual'
import type { ConflictFile } from '@/types/git'
import { useMergeRebaseStore } from '@/stores/mergeRebase'
import { highlightLine, detectLangByPath } from '@/lib/highlight'

const { t } = useI18n()

const props = defineProps<{
  filePath: string | null
}>()

const emit = defineEmits<{ close: [] }>()

const mr = useMergeRebaseStore()

const conflict = ref<ConflictFile | null>(null)
const loading = ref(false)
const saving = ref(false)
const errorMsg = ref<string | null>(null)
const currentHunkIdx = ref(0)

type AlignRow = {
  left: string | null
  leftNo: number | null
  right: string | null
  rightNo: number | null
  status: 'equal' | 'left-only' | 'right-only' | 'changed' | 'hunk-header'
  hunkId: number | null
  baseCls: string
}

type Hunk = {
  id: number
  /** 组头行在 rows 中的 idx（虚拟占位，仅用于放 master checkbox） */
  headerIdx: number
  /** 该 hunk 第一条数据行的 idx（= headerIdx + 1） */
  startIdx: number
  endIdx: number
  /** 该 hunk 内所有 left 非空的 row idx（按顺序） */
  leftRowIdx: number[]
  /** 该 hunk 内所有 right 非空的 row idx（按顺序） */
  rightRowIdx: number[]
}

async function load() {
  if (!props.filePath) {
    conflict.value = null
    return
  }
  loading.value = true
  errorMsg.value = null
  try {
    const file = await mr.loadConflictFile(props.filePath)
    conflict.value = file
    currentHunkIdx.value = 0
  } catch (e) {
    errorMsg.value = String(e)
  } finally {
    loading.value = false
  }
}

watch(() => props.filePath, load, { immediate: true })

// 左右对齐：LCS 行级 diff + 相邻 left-only/right-only 合并成 changed
const alignment = computed<{ rows: AlignRow[]; hunks: Hunk[] }>(() => {
  if (!conflict.value || conflict.value.is_binary) {
    return { rows: [], hunks: [] }
  }
  const a = (conflict.value.ours ?? '').split('\n')
  const b = (conflict.value.theirs ?? '').split('\n')
  if (a.length > 0 && a[a.length - 1] === '') a.pop()
  if (b.length > 0 && b[b.length - 1] === '') b.pop()

  const m = a.length
  const n = b.length
  const dp: Uint32Array[] = []
  for (let i = 0; i <= m; i++) dp.push(new Uint32Array(n + 1))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1
      else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }
  const raw: AlignRow[] = []
  const mk = (left: string | null, leftNo: number | null, right: string | null, rightNo: number | null, status: AlignRow['status']): AlignRow => ({
    left, leftNo, right, rightNo, status, hunkId: null, baseCls: '',
  })
  let i = m
  let j = n
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      raw.push(mk(a[i - 1], i, b[j - 1], j, 'equal'))
      i--
      j--
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      raw.push(mk(a[i - 1], i, null, null, 'left-only'))
      i--
    } else {
      raw.push(mk(null, null, b[j - 1], j, 'right-only'))
      j--
    }
  }
  while (i > 0) {
    raw.push(mk(a[i - 1], i, null, null, 'left-only'))
    i--
  }
  while (j > 0) {
    raw.push(mk(null, null, b[j - 1], j, 'right-only'))
    j--
  }
  raw.reverse()

  // 阶段 2：把相邻的非 equal 行按 max-len 配对成 changed / left-only / right-only
  // （LCS backtrack 产出的 left-only / right-only 顺序不固定，直接 zip 避免依赖顺序）
  const rows: AlignRow[] = []
  let k = 0
  while (k < raw.length) {
    if (raw[k].status === 'equal') {
      rows.push(raw[k])
      k++
      continue
    }
    let end = k
    while (end < raw.length && raw[end].status !== 'equal') end++
    const leftItems: Array<{ content: string; lineNo: number }> = []
    const rightItems: Array<{ content: string; lineNo: number }> = []
    for (let p = k; p < end; p++) {
      const rp = raw[p]
      if (rp.left !== null && rp.leftNo !== null) leftItems.push({ content: rp.left, lineNo: rp.leftNo })
      if (rp.right !== null && rp.rightNo !== null) rightItems.push({ content: rp.right, lineNo: rp.rightNo })
    }
    const maxLen = Math.max(leftItems.length, rightItems.length)
    for (let i = 0; i < maxLen; i++) {
      const li = leftItems[i]
      const ri = rightItems[i]
      if (li && ri) rows.push(mk(li.content, li.lineNo, ri.content, ri.lineNo, 'changed'))
      else if (li) rows.push(mk(li.content, li.lineNo, null, null, 'left-only'))
      else if (ri) rows.push(mk(null, null, ri.content, ri.lineNo, 'right-only'))
    }
    k = end
  }

  // 阶段 3：扫出 hunks；多行 hunk 开头插一条组头行，单行 hunk 不插
  const finalRows: AlignRow[] = []
  const hunks: Hunk[] = []
  let curHunk: Hunk | null = null
  for (let origIdx = 0; origIdx < rows.length; origIdx++) {
    const r = rows[origIdx]
    if (r.status === 'equal') {
      curHunk = null
      r.baseCls = 'row'
      finalRows.push(r)
      continue
    }
    if (!curHunk) {
      // 预判该 hunk 有多少行，决定是否需要组头
      let end = origIdx
      while (end + 1 < rows.length && rows[end + 1].status !== 'equal') end++
      const isMulti = end > origIdx
      let headerIdx: number
      let startIdx: number
      if (isMulti) {
        headerIdx = finalRows.length
        finalRows.push({
          left: null, leftNo: null, right: null, rightNo: null,
          status: 'hunk-header', hunkId: hunks.length, baseCls: 'row row-hunk-header',
        })
        startIdx = finalRows.length
      } else {
        startIdx = finalRows.length
        headerIdx = startIdx
      }
      curHunk = { id: hunks.length, headerIdx, startIdx, endIdx: startIdx, leftRowIdx: [], rightRowIdx: [] }
      hunks.push(curHunk)
    }
    r.hunkId = curHunk.id
    const newIdx = finalRows.length
    curHunk.endIdx = newIdx
    if (r.left !== null) curHunk.leftRowIdx.push(newIdx)
    if (r.right !== null) curHunk.rightRowIdx.push(newIdx)
    r.baseCls = 'row row-diff row-' + r.status
    finalRows.push(r)
  }
  return { rows: finalRows, hunks }
})

const rows = computed(() => alignment.value.rows)
const hunks = computed(() => alignment.value.hunks)
const conflictCount = computed(() => hunks.value.length)

// 按行勾选：Set key 为 'a:idx' / 'b:idx'
const selectedRows = ref<Set<string>>(new Set())
const aKey = (idx: number) => 'a:' + idx
const bKey = (idx: number) => 'b:' + idx

// 冲突数据重新加载时清空勾选（默认全不勾，用户从零挑选）
watch(hunks, () => {
  selectedRows.value = new Set()
  currentHunkIdx.value = 0
})

function toggleRow(idx: number, side: 'a' | 'b') {
  const r = rows.value[idx]
  if (!r || r.hunkId === null) return
  if (side === 'a' && r.left === null) return
  if (side === 'b' && r.right === null) return
  const next = new Set(selectedRows.value)
  const key = side === 'a' ? aKey(idx) : bKey(idx)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  selectedRows.value = next
  currentHunkIdx.value = r.hunkId
}

function useAllOurs() {
  const next = new Set<string>()
  for (const h of hunks.value) for (const idx of h.leftRowIdx) next.add(aKey(idx))
  selectedRows.value = next
}

function useAllTheirs() {
  const next = new Set<string>()
  for (const h of hunks.value) for (const idx of h.rightRowIdx) next.add(bKey(idx))
  selectedRows.value = next
}

function clearAll() {
  selectedRows.value = new Set()
}

const syntaxLang = computed(() => detectLangByPath(props.filePath))

function lineHtml(content: string): string {
  return content === '' ? '' : highlightLine(content, syntaxLang.value)
}

function isRowSelectable(idx: number, side: 'a' | 'b'): boolean {
  const r = rows.value[idx]
  if (!r || r.hunkId === null) return false
  return side === 'a' ? r.left !== null : r.right !== null
}

function isRowChecked(idx: number, side: 'a' | 'b'): boolean {
  if (!isRowSelectable(idx, side)) return false
  return selectedRows.value.has(side === 'a' ? aKey(idx) : bKey(idx))
}

function hunkSideIdxs(hunkId: number, side: 'a' | 'b'): number[] {
  const h = hunks.value[hunkId]
  if (!h) return []
  return side === 'a' ? h.leftRowIdx : h.rightRowIdx
}

function hunkAllChecked(hunkId: number, side: 'a' | 'b'): boolean {
  const idxs = hunkSideIdxs(hunkId, side)
  if (idxs.length === 0) return false
  const keyFn = side === 'a' ? aKey : bKey
  for (const idx of idxs) if (!selectedRows.value.has(keyFn(idx))) return false
  return true
}

function hunkSomeChecked(hunkId: number, side: 'a' | 'b'): boolean {
  const idxs = hunkSideIdxs(hunkId, side)
  if (idxs.length === 0) return false
  const keyFn = side === 'a' ? aKey : bKey
  let n = 0
  for (const idx of idxs) if (selectedRows.value.has(keyFn(idx))) n++
  return n > 0 && n < idxs.length
}

function toggleHunk(hunkId: number, side: 'a' | 'b') {
  const idxs = hunkSideIdxs(hunkId, side)
  if (idxs.length === 0) return
  const keyFn = side === 'a' ? aKey : bKey
  const all = hunkAllChecked(hunkId, side)
  const next = new Set(selectedRows.value)
  for (const idx of idxs) {
    const k = keyFn(idx)
    if (all) next.delete(k)
    else next.add(k)
  }
  selectedRows.value = next
  currentHunkIdx.value = hunkId
}

// 合成 output 时同时产出 row↔line 双向映射（单次扫描）
const outputMap = computed(() => {
  const lines: string[] = []
  const rowToLine: number[] = []
  const lineToRow: number[] = [0] // 1-based：line N 对应 lineToRow[N]
  const rs = rows.value
  const sel = selectedRows.value
  let line = 1
  for (let idx = 0; idx < rs.length; idx++) {
    rowToLine.push(line)
    const r = rs[idx]
    if (r.status === 'equal') {
      lines.push(r.left ?? '')
      lineToRow.push(idx)
      line += 1
    } else if (r.status === 'hunk-header') {
      // 组头行不贡献 output；rowToLine 指向紧随其后的数据行起点
    } else if (r.hunkId !== null) {
      if (r.left !== null && sel.has(aKey(idx))) {
        lines.push(r.left)
        lineToRow.push(idx)
        line += 1
      }
      if (r.right !== null && sel.has(bKey(idx))) {
        lines.push(r.right)
        lineToRow.push(idx)
        line += 1
      }
    }
  }
  return { lines, rowToLine, lineToRow }
})

const outputLines = computed(() => outputMap.value.lines)
const rowIdxToOutputLine = computed(() => outputMap.value.rowToLine)
const outputLineToRowIdx = computed(() => outputMap.value.lineToRow)

const savedText = computed(() => outputLines.value.join('\n'))
const hasMarkers = computed(() => /^<<<<<<< /m.test(savedText.value))

const selectedCount = computed(() => selectedRows.value.size)
const totalSelectable = computed(() => {
  let n = 0
  for (const h of hunks.value) n += h.leftRowIdx.length + h.rightRowIdx.length
  return n
})

// 按实际最大行号计算 lineno 宽度，避免 2 位数行号在 40px 右对齐列中飘远
const linenoWidth = computed(() => {
  let max = 0
  for (const r of rows.value) {
    if (r.leftNo && r.leftNo > max) max = r.leftNo
    if (r.rightNo && r.rightNo > max) max = r.rightNo
  }
  const digits = Math.max(2, String(Math.max(max, outputLines.value.length)).length)
  return digits * 8 + 2
})

const paneARowsRef = ref<HTMLElement | null>(null)
const paneBRowsRef = ref<HTMLElement | null>(null)
const paneOutputRowsRef = ref<HTMLElement | null>(null)
const ROW_H = 20

// 预估最宽行所需字符数，用来给 rows-inner 设置 width 以启用横向滚动条
const maxChars = computed(() => {
  let max = 0
  for (const r of rows.value) {
    const la = r.left?.length ?? 0
    const lb = r.right?.length ?? 0
    if (la > max) max = la
    if (lb > max) max = lb
  }
  return Math.min(max, 300)
})

const maxOutputChars = computed(() => {
  let max = 0
  for (const l of outputLines.value) if (l.length > max) max = l.length
  return Math.min(max, 300)
})

const virtualizerA = useVirtualizer(
  computed(() => ({
    count: rows.value.length,
    getScrollElement: () => paneARowsRef.value,
    estimateSize: () => ROW_H,
    overscan: 10,
  })),
)

const virtualizerB = useVirtualizer(
  computed(() => ({
    count: rows.value.length,
    getScrollElement: () => paneBRowsRef.value,
    estimateSize: () => ROW_H,
    overscan: 10,
  })),
)

const virtualizerO = useVirtualizer(
  computed(() => ({
    count: outputLines.value.length,
    getScrollElement: () => paneOutputRowsRef.value,
    estimateSize: () => ROW_H,
    overscan: 10,
  })),
)

// 防抖锁：任一侧滚动触发时标记，防止互相回调产生震荡
let scrollLock: 'a' | 'b' | 'o' | null = null

function onPaneAScroll() {
  if (scrollLock && scrollLock !== 'a') return
  scrollLock = 'a'
  syncFromRow(paneARowsRef.value?.scrollTop ?? 0)
  requestAnimationFrame(() => (scrollLock = null))
}

function onPaneBScroll() {
  if (scrollLock && scrollLock !== 'b') return
  scrollLock = 'b'
  syncFromRow(paneBRowsRef.value?.scrollTop ?? 0)
  requestAnimationFrame(() => (scrollLock = null))
}

function onOutputScroll() {
  if (scrollLock && scrollLock !== 'o') return
  scrollLock = 'o'
  const el = paneOutputRowsRef.value
  if (!el) {
    requestAnimationFrame(() => (scrollLock = null))
    return
  }
  const topLine = Math.floor(el.scrollTop / ROW_H) + 1
  const rowIdx = outputLineToRowIdx.value[topLine] ?? 0
  const rowTop = rowIdx * ROW_H
  if (paneARowsRef.value) paneARowsRef.value.scrollTop = rowTop
  if (paneBRowsRef.value) paneBRowsRef.value.scrollTop = rowTop
  requestAnimationFrame(() => (scrollLock = null))
}

function syncFromRow(rowScrollTop: number) {
  if (paneARowsRef.value && paneARowsRef.value.scrollTop !== rowScrollTop) {
    paneARowsRef.value.scrollTop = rowScrollTop
  }
  if (paneBRowsRef.value && paneBRowsRef.value.scrollTop !== rowScrollTop) {
    paneBRowsRef.value.scrollTop = rowScrollTop
  }
  const topRow = Math.floor(rowScrollTop / ROW_H)
  const outLine = rowIdxToOutputLine.value[topRow] ?? 1
  const el = paneOutputRowsRef.value
  if (el) {
    const target = (outLine - 1) * ROW_H
    if (Math.abs(el.scrollTop - target) > 1) el.scrollTop = target
  }
}

function scrollToHunk(idx: number) {
  if (idx < 0 || idx >= hunks.value.length) return
  currentHunkIdx.value = idx
  const hunk = hunks.value[idx]
  nextTick(() => {
    virtualizerA.value.scrollToIndex(hunk.headerIdx, { align: 'center' })
    const startLine = rowIdxToOutputLine.value[hunk.startIdx] ?? 1
    virtualizerO.value.scrollToIndex(Math.max(0, startLine - 1), { align: 'center' })
  })
}

function goPrevHunk() {
  if (conflictCount.value === 0) return
  scrollToHunk((currentHunkIdx.value - 1 + conflictCount.value) % conflictCount.value)
}

function goNextHunk() {
  if (conflictCount.value === 0) return
  scrollToHunk((currentHunkIdx.value + 1) % conflictCount.value)
}

async function onSave() {
  if (!props.filePath) return
  saving.value = true
  errorMsg.value = null
  try {
    await mr.resolveConflict(props.filePath, savedText.value)
    emit('close')
  } catch (e) {
    errorMsg.value = String(e)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="conflict-view">
    <!-- Toolbar -->
    <div class="toolbar">
      <span class="file-path" :title="filePath ?? ''">
        <svg class="warn-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        {{ filePath }}
        <span class="hint" v-if="conflictCount > 0">
          ({{ t('conflict.view.conflictCount', { n: conflictCount }) }})
        </span>
      </span>

      <div class="spacer" />

      <button class="btn btn-secondary" @click="useAllOurs">
        {{ t('conflict.view.useAllOurs') }}
      </button>
      <button class="btn btn-secondary" @click="useAllTheirs">
        {{ t('conflict.view.useAllTheirs') }}
      </button>
      <button class="btn btn-secondary" @click="clearAll">
        {{ t('conflict.view.clearAll') }}
      </button>
      <button class="btn btn-primary" :disabled="saving" @click="onSave">
        {{ saving ? t('conflict.view.saving') : t('conflict.view.save') }}
      </button>
      <button class="btn-icon" :title="t('diff.toolbar.close')" @click="emit('close')">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>

    <div v-if="loading" class="state">{{ t('conflict.view.loading') }}</div>
    <div v-else-if="conflict?.is_binary" class="state binary">
      {{ t('conflict.view.binary') }}
    </div>

    <!-- 双栏 + 底部 Output -->
    <div v-else class="body" :style="{ '--lineno-w': linenoWidth + 'px' }">
      <div class="panes">
        <!-- A 栏 -->
        <div class="pane pane-a">
          <div class="pane-header">
            <span class="pane-tag tag-a">A</span>
            <span class="pane-label">{{ t('conflict.view.labelOurs') }}</span>
          </div>
          <div class="rows" ref="paneARowsRef" @scroll="onPaneAScroll">
            <div
              class="rows-inner"
              :style="{
                height: virtualizerA.getTotalSize() + 'px',
                width: `calc(72px + ${maxChars}ch)`,
                minWidth: '100%',
              }"
            >
              <div
                v-for="vRow in virtualizerA.getVirtualItems()"
                :key="'l' + vRow.index"
                :id="'conflict-row-' + vRow.index"
                :class="[
                  rows[vRow.index].baseCls,
                  isRowChecked(vRow.index, 'a') ? 'row-selected' : '',
                ]"
                :style="{ position: 'absolute', top: vRow.start + 'px', left: '0', right: '0' }"
                @click="isRowSelectable(vRow.index, 'a') && toggleRow(vRow.index, 'a')"
              >
                <span class="check-col">
                  <input
                    v-if="rows[vRow.index].status === 'hunk-header' && hunkSideIdxs(rows[vRow.index].hunkId!, 'a').length > 0"
                    type="checkbox"
                    class="hunk-master"
                    :title="t('conflict.view.toggleHunk')"
                    :checked="hunkAllChecked(rows[vRow.index].hunkId!, 'a')"
                    :indeterminate.prop="hunkSomeChecked(rows[vRow.index].hunkId!, 'a')"
                    @click.stop
                    @change="toggleHunk(rows[vRow.index].hunkId!, 'a')"
                  />
                  <input
                    v-else-if="isRowSelectable(vRow.index, 'a')"
                    type="checkbox"
                    :checked="isRowChecked(vRow.index, 'a')"
                    @click.stop
                    @change="toggleRow(vRow.index, 'a')"
                  />
                </span>
                <span class="lineno">{{ rows[vRow.index].leftNo ?? '' }}</span>
                <span class="code" v-html="lineHtml(rows[vRow.index].left ?? '')" />
              </div>
            </div>
          </div>
        </div>

        <!-- B 栏 -->
        <div class="pane pane-b">
          <div class="pane-header">
            <span class="pane-tag tag-b">B</span>
            <span class="pane-label">{{ t('conflict.view.labelTheirs') }}</span>
          </div>
          <div class="rows" ref="paneBRowsRef" @scroll="onPaneBScroll">
            <div
              class="rows-inner"
              :style="{
                height: virtualizerB.getTotalSize() + 'px',
                width: `calc(72px + ${maxChars}ch)`,
                minWidth: '100%',
              }"
            >
              <div
                v-for="vRow in virtualizerB.getVirtualItems()"
                :key="'r' + vRow.index"
                :class="[
                  rows[vRow.index].baseCls,
                  isRowChecked(vRow.index, 'b') ? 'row-selected' : '',
                ]"
                :style="{ position: 'absolute', top: vRow.start + 'px', left: '0', right: '0' }"
                @click="isRowSelectable(vRow.index, 'b') && toggleRow(vRow.index, 'b')"
              >
                <span class="check-col">
                  <input
                    v-if="rows[vRow.index].status === 'hunk-header' && hunkSideIdxs(rows[vRow.index].hunkId!, 'b').length > 0"
                    type="checkbox"
                    class="hunk-master"
                    :title="t('conflict.view.toggleHunk')"
                    :checked="hunkAllChecked(rows[vRow.index].hunkId!, 'b')"
                    :indeterminate.prop="hunkSomeChecked(rows[vRow.index].hunkId!, 'b')"
                    @click.stop
                    @change="toggleHunk(rows[vRow.index].hunkId!, 'b')"
                  />
                  <input
                    v-else-if="isRowSelectable(vRow.index, 'b')"
                    type="checkbox"
                    :checked="isRowChecked(vRow.index, 'b')"
                    @click.stop
                    @change="toggleRow(vRow.index, 'b')"
                  />
                </span>
                <span class="lineno">{{ rows[vRow.index].rightNo ?? '' }}</span>
                <span class="code" v-html="lineHtml(rows[vRow.index].right ?? '')" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Output 区（只读逐行渲染） -->
      <div class="output">
        <div class="output-header">
          <span class="output-title">Output</span>
          <span class="output-hint">{{ t('conflict.view.outputReadonly') }}</span>
          <div class="nav-row">
            <span class="nav-label" v-if="conflictCount > 0">
              {{ t('conflict.view.nav', { cur: currentHunkIdx + 1, total: conflictCount }) }}
            </span>
            <span class="nav-label selected-count" v-if="totalSelectable > 0">
              {{ t('conflict.view.selected', { sel: selectedCount, total: totalSelectable }) }}
            </span>
            <button class="btn-nav" :disabled="conflictCount === 0" @click="goPrevHunk">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="18 15 12 9 6 15" />
              </svg>
            </button>
            <button class="btn-nav" :disabled="conflictCount === 0" @click="goNextHunk">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
          </div>
          <span v-if="hasMarkers" class="warn">{{ t('conflict.view.markersPresent') }}</span>
        </div>
        <div class="rows rows-output" ref="paneOutputRowsRef" @scroll="onOutputScroll">
          <div
            class="rows-inner"
            :style="{
              height: virtualizerO.getTotalSize() + 'px',
              width: `calc(60px + ${maxOutputChars}ch)`,
              minWidth: '100%',
            }"
          >
            <div
              v-for="vRow in virtualizerO.getVirtualItems()"
              :key="'o' + vRow.index"
              class="row row-output"
              :style="{ position: 'absolute', top: vRow.start + 'px', left: '0', right: '0' }"
            >
              <span class="lineno">{{ vRow.index + 1 }}</span>
              <span class="code" v-html="lineHtml(outputLines[vRow.index] ?? '')" />
            </div>
          </div>
        </div>
      </div>

      <div v-if="errorMsg" class="err">{{ errorMsg }}</div>
    </div>
  </div>
</template>

<style scoped>
.conflict-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  min-width: 0;
  min-height: 0;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px 2px 10px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  font-size: var(--font-xs);
  height: 22px;
  white-space: nowrap;
}

.file-path {
  color: var(--text-secondary);
  font-family: var(--code-font-family, 'SF Mono', monospace);
  display: inline-flex;
  align-items: center;
  gap: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.warn-icon {
  color: var(--accent-orange);
  flex-shrink: 0;
}

.hint {
  color: var(--text-muted);
  font-size: var(--font-xs);
  margin-left: 2px;
}

.spacer {
  flex: 1;
}

.btn {
  padding: 0 8px;
  height: 18px;
  line-height: 16px;
  border-radius: 3px;
  font-size: var(--font-xs);
  font-weight: 500;
  cursor: pointer;
  border: 1px solid transparent;
  flex-shrink: 0;
  white-space: nowrap;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  background: var(--bg-overlay);
  color: var(--text-primary);
  border-color: var(--border);
}

.btn-secondary:hover {
  background: var(--bg-primary);
}

.btn-primary {
  background: var(--accent-blue);
  color: var(--bg-primary);
  font-weight: 600;
}

.btn-primary:hover:not(:disabled) {
  filter: brightness(1.1);
}

.btn-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 16px;
  background: transparent;
  border: none;
  border-radius: 3px;
  color: var(--text-muted);
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
}

.btn-icon:hover {
  background: var(--bg-overlay);
  color: var(--text-primary);
}

.state {
  padding: 32px;
  text-align: center;
  color: var(--text-secondary);
}

.state.binary {
  color: var(--accent-red);
}

.body {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.panes {
  flex: 1 1 55%;
  min-height: 120px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  overflow: hidden;
}

.pane {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  border-right: 1px solid var(--border);
}

.pane-b {
  border-right: none;
}

.pane-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  height: 20px;
  font-size: var(--font-xs);
  font-family: var(--code-font-family, 'SF Mono', monospace);
  background: var(--bg-overlay);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  white-space: nowrap;
}

.pane-tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  font-weight: 700;
  font-size: 10px;
  border-radius: 3px;
  border: 1.5px solid;
  line-height: 1;
}

.tag-a {
  color: var(--accent-blue);
  border-color: var(--accent-blue);
  background: color-mix(in oklab, var(--accent-blue) 15%, transparent);
}

.tag-b {
  color: var(--accent-orange);
  border-color: var(--accent-orange);
  background: color-mix(in oklab, var(--accent-orange) 15%, transparent);
}

.pane-label {
  color: var(--text-secondary);
}

.rows {
  flex: 1;
  overflow: auto;
  font-family: var(--code-font-family, 'SF Mono', monospace);
  font-size: var(--font-md);
  line-height: 20px;
}

.rows-inner {
  position: relative;
}

.row {
  display: flex;
  align-items: center;
  gap: 1px;
  padding: 0 8px 0 0;
  height: 20px;
  line-height: 20px;
  white-space: pre;
  cursor: default;
}

.row .check-col {
  width: 20px;
  flex: 0 0 20px;
}

.row .lineno {
  width: var(--lineno-w, 40px);
  flex: 0 0 var(--lineno-w, 40px);
}

.row .code {
  flex: 1 0 auto;
  white-space: pre;
  overflow: visible;
  margin-left: 6px;
}

.row[class*='row-diff'] {
  cursor: pointer;
}

/* 高亮整个 hunk 底色 */
.row-diff {
  background: rgba(238, 212, 159, 0.05);
}

.row-left-only .code {
  background: rgba(166, 218, 149, 0.15);
}

.row-right-only .code {
  background: rgba(138, 173, 244, 0.15);
}

.row-changed .code {
  background: rgba(238, 212, 159, 0.15);
}

.row-selected {
  background: rgba(138, 173, 244, 0.18);
}

.pane-b .row-selected {
  background: rgba(238, 212, 159, 0.22);
}

.check-col {
  display: flex;
  align-items: center;
  justify-content: flex-end;
}

.check-col input[type='checkbox'] {
  cursor: pointer;
  accent-color: var(--accent-blue);
  width: 13px;
  height: 13px;
}

.pane-b .check-col input[type='checkbox'] {
  accent-color: var(--accent-orange);
}

/* 组头行：圆形 master checkbox，视觉区别于 per-line 方形勾选 */
.row-hunk-header {
  background: rgba(138, 173, 244, 0.04);
  cursor: default;
}

.pane-a .hunk-master { --hunk-accent: var(--accent-blue); }
.pane-b .hunk-master { --hunk-accent: var(--accent-orange); }

.hunk-master {
  appearance: none;
  -webkit-appearance: none;
  width: 14px;
  height: 14px;
  border: 1.5px solid var(--text-muted);
  border-radius: 50%;
  background: transparent;
  cursor: pointer;
  margin: 0;
  padding: 0;
  position: relative;
}

.hunk-master:hover {
  border-color: var(--hunk-accent);
}

.hunk-master:checked,
.hunk-master:indeterminate {
  background: var(--hunk-accent);
  border-color: var(--hunk-accent);
}

.hunk-master:checked::after {
  content: '';
  position: absolute;
  left: 3px;
  top: 0;
  width: 3px;
  height: 7px;
  border: solid var(--bg-primary);
  border-width: 0 1.5px 1.5px 0;
  transform: rotate(45deg);
}

.hunk-master:indeterminate::after {
  content: '';
  position: absolute;
  inset: 3px;
  background: var(--bg-primary);
  border-radius: 50%;
}

.lineno {
  color: var(--text-muted);
  text-align: right;
  user-select: none;
  font-variant-numeric: tabular-nums;
}

.code {
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── Output 区 ────────────────────────────────── */

.output {
  flex: 1 1 45%;
  min-height: 140px;
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--border);
  background: var(--bg-primary);
  min-width: 0;
}

.output-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  height: 20px;
  background: var(--bg-overlay);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  font-size: var(--font-xs);
  white-space: nowrap;
}

.output-title {
  font-weight: 600;
  color: var(--text-primary);
}

.output-hint {
  color: var(--text-muted);
  font-size: var(--font-xs);
}

.nav-row {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
  flex-shrink: 0;
}

.nav-label {
  color: var(--accent-blue);
  font-size: var(--font-xs);
  font-family: var(--code-font-family, 'SF Mono', monospace);
}

.nav-label.selected-count {
  color: var(--text-muted);
  margin-left: 2px;
}

.btn-nav {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 16px;
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: 3px;
  color: var(--text-primary);
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
}

.btn-nav:hover:not(:disabled) {
  background: var(--bg-overlay);
}

.btn-nav:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.warn {
  color: var(--accent-orange);
  font-size: var(--font-xs);
  font-weight: 500;
  flex-shrink: 0;
  white-space: nowrap;
}

.rows-output {
  user-select: text;
}

.row-output {
  cursor: default;
}

.row-output .lineno {
  width: 48px;
  flex: 0 0 48px;
}

.row-output .code {
  flex: 1 0 auto;
  white-space: pre;
}

.err {
  padding: 6px 10px;
  color: var(--accent-red);
  font-size: var(--font-sm);
  background: var(--bg-secondary);
  border-top: 1px solid var(--border);
}
</style>
