<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useVirtualizer } from '@tanstack/vue-virtual'
import type { ConflictFile } from '@/types/git'
import { useMergeRebaseStore } from '@/stores/mergeRebase'

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
// 当前合成 / 编辑中的 Output 文本
const merged = ref('')
// 是否由用户手工编辑过 textarea（手工改动后勾选仍会覆盖，但提示一下）
const mergedEditedByUser = ref(false)
const currentHunkIdx = ref(0)

type AlignRow = {
  left: string | null
  leftNo: number | null
  right: string | null
  rightNo: number | null
  status: 'equal' | 'left-only' | 'right-only' | 'changed'
  hunkId: number | null
  /** 预计算好的 "row + row-*" 静态 class（勾选相关的动态 class 在模板再拼） */
  baseCls: string
  /** 是否该 hunk 的第一行（模板用来决定是否渲染 checkbox） */
  isStart: boolean
}

type Hunk = {
  id: number
  startIdx: number
  endIdx: number
  leftLines: string[]
  rightLines: string[]
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
    mergedEditedByUser.value = false
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
    left, leftNo, right, rightNo, status, hunkId: null, baseCls: '', isStart: false,
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

  // 阶段 2：把相邻的 left-only + right-only 成对合并成 changed
  const rows: AlignRow[] = []
  let k = 0
  while (k < raw.length) {
    const r = raw[k]
    if (r.status === 'left-only' && raw[k + 1] && raw[k + 1].status === 'right-only') {
      const pr = raw[k + 1]
      rows.push(mk(r.left, r.leftNo, pr.right, pr.rightNo, 'changed'))
      k += 2
      continue
    }
    rows.push(r)
    k++
  }

  // 阶段 3：扫出 hunks + 预计算 baseCls / isStart
  const hunks: Hunk[] = []
  let curHunk: Hunk | null = null
  for (let idx = 0; idx < rows.length; idx++) {
    const r = rows[idx]
    if (r.status === 'equal') {
      curHunk = null
      r.baseCls = 'row'
    } else {
      const start = !curHunk
      if (!curHunk) {
        curHunk = { id: hunks.length, startIdx: idx, endIdx: idx, leftLines: [], rightLines: [] }
        hunks.push(curHunk)
      }
      r.hunkId = curHunk.id
      r.isStart = start
      curHunk.endIdx = idx
      if (r.left !== null) curHunk.leftLines.push(r.left)
      if (r.right !== null) curHunk.rightLines.push(r.right)
      r.baseCls = 'row row-diff row-' + r.status + (start ? ' row-hunk-start' : '')
    }
  }
  return { rows, hunks }
})

const rows = computed(() => alignment.value.rows)
const hunks = computed(() => alignment.value.hunks)
const conflictCount = computed(() => hunks.value.length)

// 每个 hunk 的勾选状态：默认勾 A（ours），不勾 B（theirs）
const hunkChoices = ref<Array<{ ours: boolean; theirs: boolean }>>([])

watch(
  hunks,
  (hs) => {
    hunkChoices.value = hs.map(() => ({ ours: true, theirs: false }))
    currentHunkIdx.value = 0
  },
)

// 根据勾选 + 非冲突行合成 Output 文本
const synthesized = computed(() => {
  const out: string[] = []
  const rs = rows.value
  const hs = hunks.value
  const cs = hunkChoices.value
  for (let idx = 0; idx < rs.length; idx++) {
    const r = rs[idx]
    if (r.status === 'equal') {
      out.push(r.left ?? '')
    } else if (r.hunkId !== null) {
      const h = hs[r.hunkId]
      if (idx === h.startIdx) {
        const c = cs[r.hunkId]
        if (c?.ours) out.push(...h.leftLines)
        if (c?.theirs) out.push(...h.rightLines)
      }
    }
  }
  return out.join('\n')
})

// 勾选变化或冲突数据变化时，用合成结果覆盖 textarea
watch(synthesized, (v) => {
  merged.value = v
  mergedEditedByUser.value = false
})

// Output 中每个 hunk 对应的行范围（用于高亮当前 hunk + 跳转）
const outputHunkRanges = computed<Array<{ start: number; end: number }>>(() => {
  const ranges: Array<{ start: number; end: number }> = []
  const rs = rows.value
  const hs = hunks.value
  const cs = hunkChoices.value
  let line = 0
  for (let idx = 0; idx < rs.length; idx++) {
    const r = rs[idx]
    if (r.status === 'equal') {
      line++
    } else if (r.hunkId !== null) {
      const h = hs[r.hunkId]
      if (idx === h.startIdx) {
        const c = cs[r.hunkId]
        const used = (c?.ours ? h.leftLines.length : 0) + (c?.theirs ? h.rightLines.length : 0)
        ranges.push({ start: line + 1, end: line + Math.max(used, 1) })
        line += used
      }
    }
  }
  return ranges
})

const outputTextareaRef = ref<HTMLTextAreaElement | null>(null)
const paneARowsRef = ref<HTMLElement | null>(null)
const paneBRowsRef = ref<HTMLElement | null>(null)
const ROW_H = 20 // 和 .row height / textarea line-height 一致

// 预估最宽行所需字符数，用来给 rows-inner 设置 width 以启用横向滚动条。
// 仅取最宽 300 字符以避免 Git 二进制文件误判。
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

// 虚拟化：只渲染视窗内 ~几十行
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

// row idx → output 首行（1-based）。对 equal 行 output 正好一行；
// 非 equal 行只在 hunk 起始处算一个 block，中间行指向该 block 起点。
const rowIdxToOutputLine = computed<number[]>(() => {
  const arr: number[] = []
  const rs = rows.value
  const hs = hunks.value
  const cs = hunkChoices.value
  let line = 1
  for (let idx = 0; idx < rs.length; idx++) {
    arr.push(line)
    const r = rs[idx]
    if (r.status === 'equal') {
      line += 1
    } else if (r.hunkId !== null) {
      const h = hs[r.hunkId]
      if (idx === h.startIdx) {
        const c = cs[r.hunkId]
        line += (c?.ours ? h.leftLines.length : 0) + (c?.theirs ? h.rightLines.length : 0)
      }
    }
  }
  return arr
})

// output 首行（1-based）→ row idx
const outputLineToRowIdx = computed<number[]>(() => {
  const map: number[] = [0] // index 0 占位，行号从 1 开始
  const rs = rows.value
  const hs = hunks.value
  const cs = hunkChoices.value
  for (let idx = 0; idx < rs.length; idx++) {
    const r = rs[idx]
    if (r.status === 'equal') {
      map.push(idx)
    } else if (r.hunkId !== null) {
      const h = hs[r.hunkId]
      if (idx === h.startIdx) {
        const c = cs[r.hunkId]
        const count = (c?.ours ? h.leftLines.length : 0) + (c?.theirs ? h.rightLines.length : 0)
        for (let k = 0; k < count; k++) map.push(idx)
      }
    }
  }
  return map
})

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
  const ta = outputTextareaRef.value
  if (!ta) return
  const topLine = Math.floor(ta.scrollTop / ROW_H) + 1
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
  const ta = outputTextareaRef.value
  if (ta) {
    const target = (outLine - 1) * ROW_H
    if (Math.abs(ta.scrollTop - target) > 1) ta.scrollTop = target
  }
}

function scrollToHunk(idx: number) {
  if (idx < 0 || idx >= hunks.value.length) return
  currentHunkIdx.value = idx
  const hunk = hunks.value[idx]
  nextTick(() => {
    virtualizerA.value.scrollToIndex(hunk.startIdx, { align: 'center' })
    // 把 textarea 滚到对应行
    const range = outputHunkRanges.value[idx]
    const ta = outputTextareaRef.value
    if (range && ta) {
      const line = range.start
      const targetTop = (line - 1) * ROW_H - ta.clientHeight / 2
      ta.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' })
      const charPos = merged.value.split('\n').slice(0, line - 1).join('\n').length + (line > 1 ? 1 : 0)
      ta.focus({ preventScroll: true })
      ta.setSelectionRange(charPos, charPos)
    }
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

function useAllOurs() {
  hunkChoices.value = hunkChoices.value.map(() => ({ ours: true, theirs: false }))
}

function useAllTheirs() {
  hunkChoices.value = hunkChoices.value.map(() => ({ ours: false, theirs: true }))
}

// 点击整条 hunk 行：切换对应侧的勾选
function toggleSide(hunkId: number, side: 'ours' | 'theirs') {
  const copy = hunkChoices.value.slice()
  const cur = copy[hunkId] ?? { ours: false, theirs: false }
  copy[hunkId] = { ...cur, [side]: !cur[side] }
  hunkChoices.value = copy
}

const hasMarkers = computed(() => /^<<<<<<< /m.test(merged.value))

async function onSave() {
  if (!props.filePath) return
  saving.value = true
  errorMsg.value = null
  try {
    await mr.resolveConflict(props.filePath, merged.value)
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
    <div v-else class="body">
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
                width: `calc(76px + ${maxChars}ch)`,
                minWidth: '100%',
              }"
            >
              <div
                v-for="vRow in virtualizerA.getVirtualItems()"
                :key="'l' + vRow.index"
                :id="'conflict-row-' + vRow.index"
                :class="[
                  rows[vRow.index].baseCls,
                  rows[vRow.index].hunkId === currentHunkIdx ? 'row-current' : '',
                  rows[vRow.index].hunkId !== null && hunkChoices[rows[vRow.index].hunkId!]?.ours ? 'row-selected' : '',
                ]"
                :style="{ position: 'absolute', top: vRow.start + 'px', left: '0', right: '0' }"
                @click="rows[vRow.index].hunkId !== null && toggleSide(rows[vRow.index].hunkId!, 'ours')"
              >
                <span class="check-col">
                  <input
                    v-if="rows[vRow.index].isStart"
                    type="checkbox"
                    :checked="hunkChoices[rows[vRow.index].hunkId!]?.ours ?? false"
                    @click.stop
                    @change="toggleSide(rows[vRow.index].hunkId!, 'ours')"
                  />
                </span>
                <span class="lineno">{{ rows[vRow.index].leftNo ?? '' }}</span>
                <span class="code">{{ rows[vRow.index].left ?? '' }}</span>
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
                width: `calc(76px + ${maxChars}ch)`,
                minWidth: '100%',
              }"
            >
              <div
                v-for="vRow in virtualizerB.getVirtualItems()"
                :key="'r' + vRow.index"
                :class="[
                  rows[vRow.index].baseCls,
                  rows[vRow.index].hunkId === currentHunkIdx ? 'row-current' : '',
                  rows[vRow.index].hunkId !== null && hunkChoices[rows[vRow.index].hunkId!]?.theirs ? 'row-selected' : '',
                ]"
                :style="{ position: 'absolute', top: vRow.start + 'px', left: '0', right: '0' }"
                @click="rows[vRow.index].hunkId !== null && toggleSide(rows[vRow.index].hunkId!, 'theirs')"
              >
                <span class="check-col">
                  <input
                    v-if="rows[vRow.index].isStart"
                    type="checkbox"
                    :checked="hunkChoices[rows[vRow.index].hunkId!]?.theirs ?? false"
                    @click.stop
                    @change="toggleSide(rows[vRow.index].hunkId!, 'theirs')"
                  />
                </span>
                <span class="lineno">{{ rows[vRow.index].rightNo ?? '' }}</span>
                <span class="code">{{ rows[vRow.index].right ?? '' }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Output 区 -->
      <div class="output">
        <div class="output-header">
          <span class="output-title">Output</span>
          <div class="nav-row">
            <span class="nav-label" v-if="conflictCount > 0">
              {{ t('conflict.view.nav', { cur: currentHunkIdx + 1, total: conflictCount }) }}
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
          <span v-else-if="mergedEditedByUser" class="muted">{{ t('conflict.view.edited') }}</span>
        </div>
        <textarea
          ref="outputTextareaRef"
          v-model="merged"
          class="output-text"
          spellcheck="false"
          :title="t('conflict.view.editHint')"
          @input="mergedEditedByUser = true"
          @scroll="onOutputScroll"
        />
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
  gap: 4px;
  padding: 0 8px 0 0;
  height: 20px;
  line-height: 20px;
  white-space: pre;
  cursor: default;
}

.row .check-col {
  width: 24px;
  flex: 0 0 24px;
}

.row .lineno {
  width: 48px;
  flex: 0 0 48px;
}

.row .code {
  flex: 1 0 auto;
  white-space: pre;
  overflow: visible;
}

.row[class*='row-diff'] {
  cursor: pointer;
}

/* 高亮整个 hunk（无论是哪种 diff 类型）*/
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

.row-current {
  outline: 1px solid var(--accent-blue);
  outline-offset: -1px;
}

.check-col {
  display: flex;
  align-items: center;
  justify-content: center;
  padding-left: 4px;
}

.check-col input[type='checkbox'] {
  cursor: pointer;
  accent-color: var(--accent-blue);
  width: 14px;
  height: 14px;
}

.pane-b .check-col input[type='checkbox'] {
  accent-color: var(--accent-orange);
}

.lineno {
  color: var(--text-muted);
  text-align: right;
  padding-left: 4px;
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

.muted {
  color: var(--text-muted);
  font-size: var(--font-xs);
  flex-shrink: 0;
  white-space: nowrap;
}

.output-text {
  flex: 1;
  background: var(--bg-primary);
  border: none;
  outline: none;
  color: var(--text-primary);
  font-family: var(--code-font-family, 'SF Mono', monospace);
  font-size: var(--font-md);
  line-height: 20px;
  padding: 0 12px;
  resize: none;
  white-space: pre;
  min-height: 0;
  overflow: auto;
}

.err {
  padding: 6px 10px;
  color: var(--accent-red);
  font-size: var(--font-sm);
  background: var(--bg-secondary);
  border-top: 1px solid var(--border);
}
</style>
