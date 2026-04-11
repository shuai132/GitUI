<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { useHistoryStore } from '@/stores/history'
import { useRepoStore } from '@/stores/repos'
import { formatTime } from '@/utils/format'
import { LANE_W, ROW_H } from '@/utils/graph'
import CommitGraphRow from '@/components/history/CommitGraphRow.vue'
import SideBySideDiff from '@/components/diff/SideBySideDiff.vue'
import CommitInfoPanel from '@/components/history/CommitInfoPanel.vue'
import type { BranchInfo } from '@/types/git'

const historyStore = useHistoryStore()
const repoStore = useRepoStore()

// ── 键盘导航焦点：最后一次点击过 commits / files 中的哪一个 ────────
type ActivePane = 'commits' | 'files'
const activePane = ref<ActivePane>('commits')

const scrollContainer = ref<HTMLElement | null>(null)

// ── Virtual list ────────────────────────────────────────────────────
const virtualizer = useVirtualizer(
  computed(() => ({
    count: historyStore.commits.length,
    getScrollElement: () => scrollContainer.value,
    estimateSize: () => ROW_H,
    overscan: 10,
  }))
)

// Load more when near the bottom
function onScroll() {
  const el = scrollContainer.value
  if (!el) return
  if (el.scrollHeight - el.scrollTop - el.clientHeight < ROW_H * 5) {
    historyStore.loadMore()
  }
}

// ── Branch tag map (oid → branches pointing to this commit) ─────────
const branchTagMap = computed(() => {
  const map = new Map<string, BranchInfo[]>()
  for (const b of historyStore.branches) {
    if (b.commit_oid) {
      if (!map.has(b.commit_oid)) map.set(b.commit_oid, [])
      map.get(b.commit_oid)!.push(b)
    }
  }
  return map
})

function branchTagColor(b: BranchInfo): string {
  if (b.is_head) return 'var(--accent-blue)'
  if (b.is_remote) return 'var(--accent-orange)'
  return 'var(--accent-green)'
}

// ── Graph column width ───────────────────────────────────────────────
const graphColWidth = computed(() => {
  if (!historyStore.graphRows.length) return LANE_W * 2
  const maxCols = historyStore.graphRows.reduce((m, r) => Math.max(m, r.totalColumns), 1)
  return Math.min(maxCols * LANE_W, 180)
})

// ── Row selection ────────────────────────────────────────────────────
const selectedOid = computed(() => historyStore.selectedCommit?.info.oid ?? null)

const selectedCommitIndex = computed(() =>
  historyStore.commits.findIndex((c) => c.oid === selectedOid.value)
)

function selectRow(idx: number) {
  const commit = historyStore.commits[idx]
  if (commit) historyStore.selectCommit(commit.oid)
  activePane.value = 'commits'
}

function isSelected(idx: number): boolean {
  return historyStore.commits[idx]?.oid === selectedOid.value
}

function onSelectFile(idx: number) {
  historyStore.selectFileDiff(idx)
  activePane.value = 'files'
}

// ── Current diff ─────────────────────────────────────────────────────
const currentDiff = computed(() => {
  const commit = historyStore.selectedCommit
  if (!commit) return null
  return commit.diffs[historyStore.selectedFileDiffIndex] ?? null
})

// ── Search / filter ──────────────────────────────────────────────────
const searchQuery = ref('')

// ── Persisted sizes (layout + pane splits + column widths) ───────────
const SIZES_KEY = 'gitui.history.sizes'
interface SavedSizes {
  layoutMode: 'horizontal' | 'vertical'
  commitPanePct: number     // horizontal: commit-panel 宽度百分比
  infoPanePct: number       // vertical: info-pane 宽度百分比
  diffRowPct: number        // horizontal: diff-area 高度百分比（上下分隔）
  commitRowPct: number      // vertical: commit-panel 高度百分比（上下分隔）
  hashColW: number
  authorColW: number
  dateColW: number
}
function loadSizes(): Partial<SavedSizes> {
  try { return JSON.parse(localStorage.getItem(SIZES_KEY) ?? '{}') } catch { return {} }
}
const saved = loadSizes()

const layoutMode = ref<'horizontal' | 'vertical'>(saved.layoutMode ?? 'vertical')
const commitPanePct = ref<number>(saved.commitPanePct ?? 55)
const infoPanePct = ref<number>(saved.infoPanePct ?? 38)
const diffRowPct = ref<number>(saved.diffRowPct ?? 70)
const commitRowPct = ref<number>(saved.commitRowPct ?? 55)
const hashColW = ref<number>(saved.hashColW ?? 64)
const authorColW = ref<number>(saved.authorColW ?? 96)
const dateColW = ref<number>(saved.dateColW ?? 80)

function persistSizes() {
  const data: SavedSizes = {
    layoutMode: layoutMode.value,
    commitPanePct: commitPanePct.value,
    infoPanePct: infoPanePct.value,
    diffRowPct: diffRowPct.value,
    commitRowPct: commitRowPct.value,
    hashColW: hashColW.value,
    authorColW: authorColW.value,
    dateColW: dateColW.value,
  }
  localStorage.setItem(SIZES_KEY, JSON.stringify(data))
}

function toggleLayout() {
  layoutMode.value = layoutMode.value === 'horizontal' ? 'vertical' : 'horizontal'
  persistSizes()
}

// ── Content area grid style ──────────────────────────────────────────
const contentAreaRef = ref<HTMLElement | null>(null)
const contentGridStyle = computed(() => {
  if (layoutMode.value === 'horizontal') {
    return {
      gridTemplateColumns: `${commitPanePct.value}% 1fr`,
      gridTemplateRows: `${diffRowPct.value}% ${100 - diffRowPct.value}%`,
    }
  }
  return {
    gridTemplateColumns: `${infoPanePct.value}% 1fr`,
    gridTemplateRows: `${commitRowPct.value}% ${100 - commitRowPct.value}%`,
  }
})

// ── Pane resize (horizontal: commit|right, vertical: info|diff) ──────
function startPaneResize(e: PointerEvent) {
  e.preventDefault()
  const container = contentAreaRef.value
  if (!container) return
  const rect = container.getBoundingClientRect()
  const onMove = (ev: PointerEvent) => {
    const pct = ((ev.clientX - rect.left) / rect.width) * 100
    const clamped = Math.max(20, Math.min(80, pct))
    if (layoutMode.value === 'horizontal') commitPanePct.value = clamped
    else infoPanePct.value = clamped
  }
  const onUp = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    persistSizes()
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
}

// ── Row resize (horizontal: diff|info, vertical: commit|bottom) ──────
function startRowResize(e: PointerEvent) {
  e.preventDefault()
  const container = contentAreaRef.value
  if (!container) return
  const rect = container.getBoundingClientRect()
  const onMove = (ev: PointerEvent) => {
    const pct = ((ev.clientY - rect.top) / rect.height) * 100
    const clamped = Math.max(20, Math.min(85, pct))
    if (layoutMode.value === 'horizontal') diffRowPct.value = clamped
    else commitRowPct.value = clamped
  }
  const onUp = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    persistSizes()
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  document.body.style.cursor = 'row-resize'
  document.body.style.userSelect = 'none'
}

// ── Column resize (hash / author / date) ─────────────────────────────
// handle 在每列的左边缘：拖 handle 向右 → 本列缩小（分隔线右移，右列被挤）
type ColKey = 'hash' | 'author' | 'date'
const COL_LIMITS: Record<ColKey, [number, number]> = {
  hash: [48, 240],
  author: [60, 240],
  date: [60, 240],
}
function startColResize(e: PointerEvent, col: ColKey) {
  e.preventDefault()
  e.stopPropagation()
  const startX = e.clientX
  const refMap = { hash: hashColW, author: authorColW, date: dateColW }
  const target = refMap[col]
  const startW = target.value
  const [min, max] = COL_LIMITS[col]
  const onMove = (ev: PointerEvent) => {
    // handle 在列左边缘：向右拖 → 本列缩小（delta 取反）
    const delta = startX - ev.clientX
    target.value = Math.max(min, Math.min(max, startW + delta))
  }
  const onUp = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    persistSizes()
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
}

// ── 键盘 ↑↓ 在当前激活的 pane 中切换条目 ─────────────────────────────
function moveCommitSelection(delta: number) {
  const len = historyStore.commits.length
  if (len === 0) return
  const cur = selectedCommitIndex.value
  const next = cur < 0 ? 0 : Math.max(0, Math.min(len - 1, cur + delta))
  if (next === cur) return
  selectRow(next)
  // 让被选中的行滚入视野（tanstack virtualizer 的能力）
  virtualizer.value.scrollToIndex(next, { align: 'auto' })
}

function moveFileSelection(delta: number) {
  const diffs = historyStore.selectedCommit?.diffs
  if (!diffs || diffs.length === 0) return
  const cur = historyStore.selectedFileDiffIndex
  const next = Math.max(0, Math.min(diffs.length - 1, cur + delta))
  if (next !== cur) onSelectFile(next)
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
  // 编辑元素（搜索框等）中按 ↑↓ 不拦截
  const t = e.target as HTMLElement | null
  if (t) {
    const tag = t.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || t.isContentEditable) return
  }
  // 只在 history 路由可见时响应
  if (!repoStore.activeRepoId) return

  const delta = e.key === 'ArrowDown' ? 1 : -1
  if (activePane.value === 'commits') {
    moveCommitSelection(delta)
  } else {
    moveFileSelection(delta)
  }
  e.preventDefault()
}

onMounted(() => {
  window.addEventListener('keydown', onKeyDown)
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown)
})
</script>

<template>
  <div class="history-view" v-if="repoStore.activeRepoId">
    <!-- Top toolbar -->
    <div class="history-toolbar">
      <select class="filter-select">
        <option>所有分支</option>
      </select>
      <select class="filter-select">
        <option>显示远程分支</option>
        <option>隐藏远程分支</option>
      </select>
      <select class="filter-select">
        <option>所有远端</option>
      </select>
      <div class="search-box">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input v-model="searchQuery" class="search-input" placeholder="搜索提交..." />
      </div>

      <!-- Layout toggle -->
      <button
        class="btn-layout"
        @click="toggleLayout"
        :title="layoutMode === 'horizontal' ? '切换为上下布局' : '切换为左右布局'"
      >
        <svg v-if="layoutMode === 'horizontal'" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="2" y="2" width="12" height="12" rx="1"/>
          <line x1="8" y1="2" x2="8" y2="14"/>
        </svg>
        <svg v-else width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="2" y="2" width="12" height="12" rx="1"/>
          <line x1="2" y1="8" x2="14" y2="8"/>
        </svg>
      </button>
    </div>

    <!-- Content area -->
    <div
      class="content-area"
      :class="'layout-' + layoutMode"
      :style="contentGridStyle"
      ref="contentAreaRef"
    >
      <!-- Commit graph + list -->
      <div class="commit-panel">
        <!-- Column headers -->
        <div class="col-header">
          <div class="col-graph" :style="{ width: graphColWidth + 'px' }"></div>
          <div class="col-message">提交信息</div>
          <div class="col-hash header-col" :style="{ width: hashColW + 'px' }">
            哈希
            <div class="col-resize" @pointerdown="startColResize($event, 'hash')" />
          </div>
          <div class="col-author header-col" :style="{ width: authorColW + 'px' }">
            作者
            <div class="col-resize" @pointerdown="startColResize($event, 'author')" />
          </div>
          <div class="col-date header-col" :style="{ width: dateColW + 'px' }">
            日期
            <div class="col-resize" @pointerdown="startColResize($event, 'date')" />
          </div>
        </div>

        <!-- Virtual list body -->
        <div
          class="commit-list-body"
          ref="scrollContainer"
          @scroll="onScroll"
        >
          <div v-if="historyStore.loading" class="list-hint">加载中...</div>
          <div
            v-else
            :style="{ height: virtualizer.getTotalSize() + 'px', position: 'relative' }"
          >
            <div
              v-for="vRow in virtualizer.getVirtualItems()"
              :key="vRow.index"
              class="commit-row"
              :class="{ selected: isSelected(vRow.index) }"
              :style="{
                position: 'absolute',
                top: vRow.start + 'px',
                height: ROW_H + 'px',
                width: '100%',
              }"
              @click="selectRow(vRow.index)"
            >
              <!-- Graph column -->
              <div class="col-graph" :style="{ width: graphColWidth + 'px' }">
                <CommitGraphRow
                  v-if="historyStore.graphRows[vRow.index]"
                  :row="historyStore.graphRows[vRow.index]"
                  :is-selected="isSelected(vRow.index)"
                />
              </div>

              <!-- Message column with branch tags -->
              <div class="col-message">
                <span
                  v-for="tag in branchTagMap.get(historyStore.commits[vRow.index]?.oid ?? '')"
                  :key="tag.name"
                  class="branch-tag"
                  :style="{ color: branchTagColor(tag), borderColor: branchTagColor(tag) }"
                >{{ tag.name }}</span>
                <span class="commit-msg">{{ historyStore.commits[vRow.index]?.summary }}</span>
              </div>

              <!-- Hash column -->
              <div class="col-hash" :style="{ width: hashColW + 'px' }">{{ historyStore.commits[vRow.index]?.short_oid }}</div>

              <!-- Author column -->
              <div class="col-author" :style="{ width: authorColW + 'px' }">{{ historyStore.commits[vRow.index]?.author_name }}</div>

              <!-- Date column -->
              <div class="col-date" :style="{ width: dateColW + 'px' }">{{ formatTime(historyStore.commits[vRow.index]?.time ?? 0) }}</div>
            </div>
          </div>

          <!-- Load more indicators -->
          <div v-if="historyStore.loadingMore" class="list-hint">加载更多...</div>
          <div v-if="!historyStore.hasMore && historyStore.commits.length > 0" class="list-hint dim">
            共 {{ historyStore.commits.length }} 条
          </div>
        </div>
      </div>

      <!-- Side-by-side diff -->
      <div class="diff-area">
        <!-- File path header -->
        <div class="diff-file-header" v-if="currentDiff">
          <span class="diff-file-path">{{ currentDiff.new_path ?? currentDiff.old_path }}</span>
          <span class="diff-file-stats">
            <span class="add">+{{ currentDiff.additions }}</span>
            <span class="del">-{{ currentDiff.deletions }}</span>
          </span>
        </div>
        <SideBySideDiff :diff="currentDiff" />
      </div>

      <!-- Commit info panel -->
      <div class="info-pane">
        <CommitInfoPanel
          :commit="historyStore.selectedCommit"
          :selected-file-idx="historyStore.selectedFileDiffIndex"
          @select-file="onSelectFile"
        />
      </div>

      <!-- Vertical resize handle (左右拖动) -->
      <div
        class="pane-resize"
        :style="layoutMode === 'horizontal'
          ? { left: commitPanePct + '%', top: 0, bottom: 0 }
          : { left: infoPanePct + '%', top: commitRowPct + '%', bottom: 0 }"
        @pointerdown="startPaneResize"
      />

      <!-- Horizontal resize handle (上下拖动) -->
      <div
        class="pane-resize-h"
        :style="layoutMode === 'horizontal'
          ? { top: diffRowPct + '%', left: commitPanePct + '%', right: 0 }
          : { top: commitRowPct + '%', left: 0, right: 0 }"
        @pointerdown="startRowResize"
      />
    </div>
  </div>

  <div v-else class="no-repo">
    请从左侧打开一个 Git 仓库
  </div>
</template>

<style scoped>
.history-view {
  display: grid;
  grid-template-rows: 36px 1fr;
  height: 100%;
  overflow: hidden;
}

.no-repo {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-muted);
  font-size: 13px;
}

/* ── Toolbar ─────────────────────────────────────────────────────── */
.history-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.filter-select {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-secondary);
  font-size: 11px;
  font-family: inherit;
  padding: 3px 6px;
  cursor: pointer;
  outline: none;
}

.filter-select:hover {
  border-color: var(--text-muted);
}

.search-box {
  display: flex;
  align-items: center;
  gap: 5px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 3px 8px;
  color: var(--text-muted);
  margin-left: auto;
}

.search-input {
  background: none;
  border: none;
  color: var(--text-primary);
  font-size: 11px;
  font-family: inherit;
  outline: none;
  width: 140px;
}

.search-input::placeholder {
  color: var(--text-muted);
}

.btn-layout {
  background: none;
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-muted);
  cursor: pointer;
  padding: 3px 5px;
  display: flex;
  align-items: center;
  transition: color 0.15s, border-color 0.15s;
}

.btn-layout:hover {
  color: var(--text-primary);
  border-color: var(--text-muted);
}

/* ── Content area (两种布局模式) ──────────────────────────────────── */
.content-area {
  display: grid;
  overflow: hidden;
  min-height: 0;
  position: relative;
}

/* 左右布局：commits 占左列满高；右列上 diff 下 info */
.content-area.layout-horizontal {
  grid-template-areas:
    "commits diff"
    "commits info";
}
.content-area.layout-horizontal .commit-panel {
  border-right: 1px solid var(--border);
}

/* 上下布局：上 commits 占满宽；下 左 info 右 diff */
.content-area.layout-vertical {
  grid-template-areas:
    "commits commits"
    "info diff";
}
.content-area.layout-vertical .commit-panel {
  border-bottom: 1px solid var(--border);
}
.content-area.layout-vertical .info-pane {
  border-right: 1px solid var(--border);
}
.content-area.layout-vertical .info-pane :deep(.commit-info-panel),
.content-area.layout-vertical .info-pane :deep(.panel-empty) {
  border-top: none;
}

/* Pane resize handle (左右拖动主分隔条) */
.pane-resize {
  position: absolute;
  width: 6px;
  transform: translateX(-3px);
  cursor: col-resize;
  z-index: 15;
  background: transparent;
  transition: background 0.15s;
}
.pane-resize:hover,
.pane-resize:active {
  background: rgba(138, 173, 244, 0.3);
}

/* Pane resize handle (上下拖动主分隔条) */
.pane-resize-h {
  position: absolute;
  height: 6px;
  transform: translateY(-3px);
  cursor: row-resize;
  z-index: 15;
  background: transparent;
  transition: background 0.15s;
}
.pane-resize-h:hover,
.pane-resize-h:active {
  background: rgba(138, 173, 244, 0.3);
}

/* Grid 区域映射 */
.commit-panel { grid-area: commits; }
.diff-area { grid-area: diff; }
.info-pane { grid-area: info; }

/* ── Commit panel ────────────────────────────────────────────────── */
.commit-panel {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
  min-height: 0;
}

.info-pane {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
  min-height: 0;
}

.col-header {
  display: flex;
  align-items: center;
  height: 26px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.commit-list-body {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}

.commit-row {
  display: flex;
  align-items: center;
  cursor: pointer;
  border-bottom: 1px solid rgba(54, 58, 79, 0.4);
  transition: background 0.08s;
}

.commit-row:hover {
  background: var(--bg-overlay);
}

.commit-row.selected {
  background: rgba(138, 173, 244, 0.12);
}

/* ── Columns ─────────────────────────────────────────────────────── */
.col-graph {
  flex-shrink: 0;
  overflow: hidden;
  display: flex;
  align-items: center;
}

.col-message {
  flex: 1;
  min-width: 0;
  padding: 0 8px;
  display: flex;
  align-items: center;
  gap: 4px;
  overflow: hidden;
}

.col-hash {
  flex-shrink: 0;
  font-family: 'SF Mono', monospace;
  font-size: 11px;
  color: var(--accent-blue);
  padding: 0 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.col-author {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 0 6px;
}

.col-date {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--text-muted);
  padding: 0 8px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Header column wrappers — relative for resize handle, visible for overflow */
.header-col {
  position: relative;
  overflow: visible;
}

/* Column resize handle (列头左边缘) */
.col-resize {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  width: 6px;
  transform: translateX(-3px);
  cursor: col-resize;
  z-index: 5;
  background: transparent;
  transition: background 0.15s;
}
.col-resize:hover,
.col-resize:active {
  background: rgba(138, 173, 244, 0.3);
}

.commit-msg {
  font-size: 12px;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.commit-row.selected .commit-msg {
  color: var(--text-primary);
}

.branch-tag {
  display: inline-block;
  font-size: 10px;
  border: 1px solid;
  border-radius: 3px;
  padding: 0 4px;
  line-height: 14px;
  flex-shrink: 0;
  white-space: nowrap;
  opacity: 0.9;
}

/* ── Hints ───────────────────────────────────────────────────────── */
.list-hint {
  text-align: center;
  padding: 10px;
  font-size: 11px;
  color: var(--text-muted);
}

.list-hint.dim {
  opacity: 0.6;
}

/* ── Diff area ───────────────────────────────────────────────────── */
.diff-area {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
  min-height: 0;
}

.diff-file-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 12px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  font-size: 11px;
}

.diff-file-path {
  color: var(--text-secondary);
  font-family: 'SF Mono', monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.diff-file-stats {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.add { color: var(--accent-green); }
.del { color: var(--accent-red); }
</style>
