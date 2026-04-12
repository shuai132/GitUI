<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted, watch } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { useHistoryStore } from '@/stores/history'
import { useRepoStore } from '@/stores/repos'
import { useWorkspaceStore } from '@/stores/workspace'
import { useDiffStore } from '@/stores/diff'
import { useUiStore } from '@/stores/ui'
import { formatTime } from '@/utils/format'
import { LANE_W, ROW_H } from '@/utils/graph'
import CommitGraphRow from '@/components/history/CommitGraphRow.vue'
import WipRow from '@/components/history/WipRow.vue'
import DiffView from '@/components/diff/DiffView.vue'
import CommitInfoPanel from '@/components/history/CommitInfoPanel.vue'
import WipPanel from '@/components/workspace/WipPanel.vue'
import ContextMenu, { type ContextMenuItem } from '@/components/common/ContextMenu.vue'
import CreateBranchDialog from '@/components/commit/CreateBranchDialog.vue'
import CreateTagDialog from '@/components/commit/CreateTagDialog.vue'
import { usePanelDock } from '@/composables/usePanelDock'
import type { PanelId } from '@/stores/ui'
import type { BranchInfo, CommitInfo } from '@/types/git'

const historyStore = useHistoryStore()
const repoStore = useRepoStore()
const workspaceStore = useWorkspaceStore()
const diffStore = useDiffStore()
const uiStore = useUiStore()

// ── 键盘导航焦点：最后一次点击过 commits / files 中的哪一个 ────────
type ActivePane = 'commits' | 'files'
const activePane = ref<ActivePane>('commits')

// ── 详情区（info + diff）显示状态（默认隐藏，点击提交后显示）────────
const showDetail = ref(false)

// ── Search / filter ─────────────────────────────────────────────────
const filteredCommits = computed(() => {
  const q = uiStore.historySearchQuery.trim().toLowerCase()
  if (!q) return historyStore.commits
  return historyStore.commits.filter(c =>
    c.summary.toLowerCase().includes(q) ||
    c.author_name.toLowerCase().includes(q) ||
    c.short_oid.toLowerCase().startsWith(q) ||
    c.oid.toLowerCase().startsWith(q)
  )
})

// ── 虚拟 WIP 行：工作副本有变更时显示在列表顶部 ────────────────────
const showWipRow = computed(() => {
  const s = workspaceStore.status
  if (!s) return false
  return s.staged.length + s.unstaged.length + s.untracked.length > 0
})

// 当前是否选中的是 WIP 行（而不是某条 commit）
const selectedWip = ref(false)

// 虚拟行数 = 过滤后 commits + (WIP 行占 1 个，搜索时隐藏)
const virtualRowCount = computed(() =>
  filteredCommits.value.length + (!uiStore.historySearchQuery.trim() && showWipRow.value ? 1 : 0),
)

// 真实 commit 索引 → 虚拟行索引
function toVirtualIdx(realIdx: number): number {
  return showWipRow.value ? realIdx + 1 : realIdx
}

// 虚拟行索引 → 真实 commit 索引（WIP 行返回 -1）
function toRealIdx(virtualIdx: number): number {
  if (showWipRow.value) {
    return virtualIdx === 0 ? -1 : virtualIdx - 1
  }
  return virtualIdx
}

const scrollContainer = ref<HTMLElement | null>(null)

// ── Virtual list ────────────────────────────────────────────────────
const virtualizer = useVirtualizer(
  computed(() => ({
    count: virtualRowCount.value,
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
  filteredCommits.value.findIndex((c) => c.oid === selectedOid.value)
)

// 虚拟行层面的"选中行"索引：
// - 选中 WIP 行 → 0（且 showWipRow）
// - 选中真实 commit → toVirtualIdx(realIdx)
// - 没选中 → -1
const selectedVirtualIndex = computed(() => {
  if (selectedWip.value && showWipRow.value) return 0
  if (selectedCommitIndex.value >= 0) return toVirtualIdx(selectedCommitIndex.value)
  return -1
})

function selectWipRow() {
  if (selectedWip.value) {
    // 再次点击 WIP 行 → 折叠详情
    showDetail.value = !showDetail.value
    return
  }
  selectedWip.value = true
  historyStore.selectedCommit = null
  showDetail.value = true
  activePane.value = 'commits'
}

function selectRow(virtualIdx: number) {
  if (showWipRow.value && virtualIdx === 0) {
    selectWipRow()
    return
  }
  const realIdx = toRealIdx(virtualIdx)
  const commit = historyStore.commits[realIdx]
  if (!commit) return
  // 切换到普通 commit：清除 WIP 选中
  selectedWip.value = false
  if (commit.oid === selectedOid.value) {
    showDetail.value = !showDetail.value
  } else {
    historyStore.selectCommit(commit.oid)
    showDetail.value = true
  }
  activePane.value = 'commits'
}

function isSelected(virtualIdx: number): boolean {
  if (showWipRow.value && virtualIdx === 0) return selectedWip.value
  const realIdx = toRealIdx(virtualIdx)
  return historyStore.commits[realIdx]?.oid === selectedOid.value
}

function onSelectFile(idx: number) {
  historyStore.selectFileDiff(idx)
  activePane.value = 'files'
}

// ── Current diff ─────────────────────────────────────────────────────
// 选中 WIP 时显示工作区 diff（diffStore.currentDiff）；
// 选中普通 commit 时显示 commit 内的文件 diff。
const currentDiff = computed(() => {
  if (selectedWip.value) return diffStore.currentDiff
  const commit = historyStore.selectedCommit
  if (!commit) return null
  return commit.diffs[historyStore.selectedFileDiffIndex] ?? null
})

// 工作副本从"有变更"变回"无变更"时自动取消 WIP 选中 + 隐藏面板
watch(showWipRow, (has) => {
  if (!has && selectedWip.value) {
    selectedWip.value = false
    showDetail.value = false
  }
})

// ── Pane sizes：响应式绑定到 uiStore.historyPaneSizes ────────────────
// 拖动时直接改 store 对象，pointerup 调 persistHistoryPaneSizes() 写 localStorage
const sizes = uiStore.historyPaneSizes

// ── Content area grid style ──────────────────────────────────────────
const contentAreaRef = ref<HTMLElement | null>(null)

// ── Panel dock（拖拽停靠）────────────────────────────────────────────
const {
  isDragging,
  draggedPanel,
  hoveredEdge,
  hoveredSwapTarget,
  onDragHandlePointerDown,
} = usePanelDock({
  containerRef: contentAreaRef,
  currentLayout: computed(() => uiStore.dockLayout),
  onLayoutChange: (layout) => uiStore.setDockLayout(layout),
})
const contentGridStyle = computed(() => {
  if (!showDetail.value) {
    return {
      gridTemplateColumns: '1fr',
      gridTemplateRows: '1fr',
      gridTemplateAreas: '"commits"',
    }
  }
  const { spanning, edge, first, second } = uiStore.dockLayout
  const isH = edge === 'left' || edge === 'right'
  const mainPct = isH ? sizes.commitPanePct : sizes.commitRowPct
  const secPct = isH ? sizes.diffRowPct : sizes.infoPanePct

  let areas: string, rows: string, cols: string
  switch (edge) {
    case 'top':
      areas = `"${spanning} ${spanning}" "${first} ${second}"`
      rows = `${mainPct}% ${100 - mainPct}%`
      cols = `${secPct}% 1fr`
      break
    case 'bottom':
      areas = `"${first} ${second}" "${spanning} ${spanning}"`
      rows = `${100 - mainPct}% ${mainPct}%`
      cols = `${secPct}% 1fr`
      break
    case 'left':
      areas = `"${spanning} ${first}" "${spanning} ${second}"`
      cols = `${mainPct}% 1fr`
      rows = `${secPct}% ${100 - secPct}%`
      break
    case 'right':
      areas = `"${first} ${spanning}" "${second} ${spanning}"`
      cols = `${100 - mainPct}% ${mainPct}%`
      rows = `${secPct}% ${100 - secPct}%`
      break
  }
  return { gridTemplateAreas: areas, gridTemplateRows: rows, gridTemplateColumns: cols }
})

// ── Main resize：spanning 面板与 pair 区之间的分割 ──────────────────
// edge=top/bottom → 水平分割线（上下拖）→ 改 commitRowPct
// edge=left/right → 垂直分割线（左右拖）→ 改 commitPanePct
function startMainResize(e: PointerEvent) {
  e.preventDefault()
  const container = contentAreaRef.value
  if (!container) return
  const rect = container.getBoundingClientRect()
  const edge = uiStore.dockLayout.edge
  const isH = edge === 'left' || edge === 'right'
  const cursor = isH ? 'col-resize' : 'row-resize'

  const onMove = (ev: PointerEvent) => {
    let pct: number
    if (isH) {
      pct = ((ev.clientX - rect.left) / rect.width) * 100
      if (edge === 'right') pct = 100 - pct
      sizes.commitPanePct = Math.max(20, Math.min(80, pct))
    } else {
      pct = ((ev.clientY - rect.top) / rect.height) * 100
      if (edge === 'bottom') pct = 100 - pct
      sizes.commitRowPct = Math.max(20, Math.min(85, pct))
    }
  }
  const onUp = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    uiStore.persistHistoryPaneSizes()
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  document.body.style.cursor = cursor
  document.body.style.userSelect = 'none'
}

// ── Secondary resize：pair 区内两个面板之间的分割 ──────────────────────
// edge=top/bottom → pair 横向排列 → 垂直分割线（左右拖）→ 改 infoPanePct
// edge=left/right → pair 纵向排列 → 水平分割线（上下拖）→ 改 diffRowPct
function startSecondaryResize(e: PointerEvent) {
  e.preventDefault()
  const container = contentAreaRef.value
  if (!container) return
  const rect = container.getBoundingClientRect()
  const edge = uiStore.dockLayout.edge
  const isH = edge === 'left' || edge === 'right'
  const cursor = isH ? 'row-resize' : 'col-resize'

  const onMove = (ev: PointerEvent) => {
    if (isH) {
      // pair 纵向排列，拖动改行高比例
      const pct = ((ev.clientY - rect.top) / rect.height) * 100
      sizes.diffRowPct = Math.max(20, Math.min(85, pct))
    } else {
      // pair 横向排列，拖动改列宽比例
      const pct = ((ev.clientX - rect.left) / rect.width) * 100
      sizes.infoPanePct = Math.max(20, Math.min(80, pct))
    }
  }
  const onUp = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    uiStore.persistHistoryPaneSizes()
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  document.body.style.cursor = cursor
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
const COL_KEY_MAP: Record<ColKey, 'hashColW' | 'authorColW' | 'dateColW'> = {
  hash: 'hashColW',
  author: 'authorColW',
  date: 'dateColW',
}
function startColResize(e: PointerEvent, col: ColKey) {
  e.preventDefault()
  e.stopPropagation()
  const startX = e.clientX
  const sizeKey = COL_KEY_MAP[col]
  const startW = sizes[sizeKey]
  const [min, max] = COL_LIMITS[col]
  const onMove = (ev: PointerEvent) => {
    // handle 在列左边缘：向右拖 → 本列缩小（delta 取反）
    const delta = startX - ev.clientX
    sizes[sizeKey] = Math.max(min, Math.min(max, startW + delta))
  }
  const onUp = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    uiStore.persistHistoryPaneSizes()
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
}

// ── 键盘 ↑↓ 在当前激活的 pane 中切换条目 ─────────────────────────────
// 把 WIP 行视为虚拟索引 0。real commits 占虚拟索引 (showWipRow ? 1 : 0)...count-1。
function moveCommitSelection(delta: number) {
  const total = virtualRowCount.value
  if (total === 0) return
  const cur = selectedVirtualIndex.value
  const next = cur < 0 ? 0 : Math.max(0, Math.min(total - 1, cur + delta))
  if (next === cur) return
  selectRow(next)
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

// ── 提交右键菜单 ─────────────────────────────────────────────────────
const commitMenu = reactive({
  visible: false,
  x: 0,
  y: 0,
  commit: null as CommitInfo | null,
})

const showCreateBranchDialog = ref(false)
const showCreateTagDialog = ref(false)
const createTagAnnotated = ref(false)
const dialogCommit = ref<CommitInfo | null>(null)

const currentBranchName = computed(
  () =>
    historyStore.branches.find((b) => b.is_head && !b.is_remote)?.name ?? 'HEAD',
)

const commitMenuItems = computed<ContextMenuItem[]>(() => {
  if (!commitMenu.commit) return []
  return [
    { label: '检出此提交', action: 'checkout' },
    { separator: true },
    { label: '在此创建分支...', action: 'create-branch' },
    { label: 'Cherry pick 此提交', action: 'cherry-pick' },
    {
      label: `将 ${currentBranchName.value} 重置到此提交`,
      children: [
        { label: 'Soft（保留工作区与暂存区）', action: 'reset-soft' },
        { label: 'Mixed（保留工作区，清空暂存区）', action: 'reset-mixed' },
        { label: 'Hard（丢弃所有变更）', action: 'reset-hard', danger: true },
      ],
    },
    { label: 'Revert 此提交', action: 'revert' },
    { separator: true },
    { label: '复制提交 SHA', action: 'copy-sha' },
    { separator: true },
    { label: '在此创建标签...', action: 'create-tag' },
    { label: '创建附注标签...', action: 'create-annotated-tag' },
  ]
})

function onCommitContextMenu(e: MouseEvent, commit: CommitInfo | undefined) {
  if (!commit) return
  e.preventDefault()
  commitMenu.commit = commit
  commitMenu.x = e.clientX
  commitMenu.y = e.clientY
  commitMenu.visible = true
  // 右键同时选中此提交（符合直觉）
  selectedWip.value = false
  historyStore.selectCommit(commit.oid)
}

function closeCommitMenu() {
  commitMenu.visible = false
}

async function onCommitMenuAction(action: string) {
  const c = commitMenu.commit
  if (!c) return
  try {
    switch (action) {
      case 'checkout':
        if (
          confirm(
            `检出到提交 ${c.short_oid} 将进入 detached HEAD 状态，确认？`,
          )
        ) {
          await historyStore.checkoutCommit(c.oid)
        }
        break
      case 'create-branch':
        dialogCommit.value = c
        showCreateBranchDialog.value = true
        break
      case 'cherry-pick':
        if (confirm(`Cherry pick 提交 "${c.summary}"？`)) {
          await historyStore.cherryPickCommit(c.oid)
        }
        break
      case 'revert':
        if (
          confirm(
            `Revert 提交 "${c.summary}"？将创建一条新提交撤销该改动`,
          )
        ) {
          await historyStore.revertCommit(c.oid)
        }
        break
      case 'reset-soft':
      case 'reset-mixed':
      case 'reset-hard': {
        const mode = action.slice(6) as 'soft' | 'mixed' | 'hard'
        const warn =
          mode === 'hard'
            ? `Hard reset 将丢弃所有未提交变更，确认把 ${currentBranchName.value} 重置到 ${c.short_oid}？`
            : `将 ${currentBranchName.value} ${mode} reset 到 ${c.short_oid}？`
        if (confirm(warn)) await historyStore.resetToCommit(c.oid, mode)
        break
      }
      case 'copy-sha':
        await navigator.clipboard.writeText(c.oid)
        break
      case 'create-tag':
        dialogCommit.value = c
        createTagAnnotated.value = false
        showCreateTagDialog.value = true
        break
      case 'create-annotated-tag':
        dialogCommit.value = c
        createTagAnnotated.value = true
        showCreateTagDialog.value = true
        break
    }
  } catch (err) {
    alert(String(err))
  }
}

// ── WIP 行文件 diff：离开 WIP 模式时清掉 diff store 里的工作区 diff ───
watch(selectedWip, (v) => {
  if (!v) diffStore.clear()
})

// ── 开关「显示丢失引用 / 显示贮藏」时重新加载历史 ─────────────────
watch(
  () => [uiStore.showUnreachableCommits, uiStore.showStashCommits],
  () => {
    if (repoStore.activeRepoId) historyStore.loadLog()
  },
)

// ── 侧边栏点击分支/stash 跳转到对应 commit ──────────────────────────
watch(
  () => historyStore.pendingJumpOid,
  (oid) => {
    if (!oid) return
    historyStore.pendingJumpOid = null
    const idx = filteredCommits.value.findIndex((c) => c.oid === oid)
    if (idx < 0) return
    selectedWip.value = false
    historyStore.selectCommit(oid)
    showDetail.value = true
    activePane.value = 'commits'
    const vIdx = toVirtualIdx(idx)
    virtualizer.value.scrollToIndex(vIdx, { align: 'center' })
  },
  { immediate: true },
)

// ── Resize handle 位置 computed ──────────────────────────────────────
// mainResizeStyle: spanning 与 pair 之间的分割条
const mainResizeStyle = computed(() => {
  const { edge } = uiStore.dockLayout
  const isH = edge === 'left' || edge === 'right'
  if (isH) {
    // 垂直分割线
    const pos = edge === 'left' ? `${sizes.commitPanePct}%` : `${100 - sizes.commitPanePct}%`
    return { left: pos, top: '0', bottom: '0', width: '6px', height: 'auto', transform: 'translateX(-3px)', cursor: 'col-resize' }
  }
  // 水平分割线
  const pos = edge === 'top' ? `${sizes.commitRowPct}%` : `${100 - sizes.commitRowPct}%`
  return { top: pos, left: '0', right: '0', height: '6px', width: 'auto', transform: 'translateY(-3px)', cursor: 'row-resize' }
})

// secondaryResizeStyle: pair 区内两个面板之间的分割条
const secondaryResizeStyle = computed(() => {
  const { edge } = uiStore.dockLayout
  const isH = edge === 'left' || edge === 'right'
  if (isH) {
    // pair 纵向排列 → 水平分割线
    const spanPct = sizes.commitPanePct
    return {
      top: `${sizes.diffRowPct}%`,
      left: edge === 'left' ? `${spanPct}%` : '0',
      right: edge === 'right' ? `${spanPct}%` : '0',
      height: '6px', width: 'auto', transform: 'translateY(-3px)', cursor: 'row-resize',
    }
  }
  // pair 横向排列 → 垂直分割线
  const spanPct = sizes.commitRowPct
  return {
    left: `${sizes.infoPanePct}%`,
    top: edge === 'top' ? `${spanPct}%` : '0',
    bottom: edge === 'bottom' ? `${spanPct}%` : '0',
    width: '6px', height: 'auto', transform: 'translateX(-3px)', cursor: 'col-resize',
  }
})

// ── 面板边框 computed ────────────────────────────────────────────────
const panelBorders = computed(() => {
  const { edge, spanning, first } = uiStore.dockLayout
  const borderSide: Record<string, string> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }
  const pairBorderSide = (edge === 'top' || edge === 'bottom') ? 'right' : 'bottom'
  const border = '1px solid var(--border)'
  return {
    [spanning]: { [`border-${borderSide[edge]}`]: border } as Record<string, string>,
    [first]: { [`border-${pairBorderSide}`]: border } as Record<string, string>,
  }
})

onMounted(() => {
  window.addEventListener('keydown', onKeyDown)
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown)
})
</script>

<template>
  <div class="history-view" v-if="repoStore.activeRepoId">
    <!-- Content area -->
    <div
      class="content-area"
      :style="contentGridStyle"
      ref="contentAreaRef"
    >
      <!-- Commit graph + list -->
      <div class="commit-panel" :style="panelBorders['commits']" data-panel-id="commits">
        <!-- Column headers -->
        <div class="col-header">
          <div class="dock-handle" @pointerdown="onDragHandlePointerDown('commits', $event)" title="拖拽停靠">
            <svg width="8" height="14" viewBox="0 0 8 14"><circle cx="2" cy="2" r="1" fill="currentColor"/><circle cx="6" cy="2" r="1" fill="currentColor"/><circle cx="2" cy="7" r="1" fill="currentColor"/><circle cx="6" cy="7" r="1" fill="currentColor"/><circle cx="2" cy="12" r="1" fill="currentColor"/><circle cx="6" cy="12" r="1" fill="currentColor"/></svg>
          </div>
          <div class="col-graph" :style="{ width: graphColWidth + 'px' }"></div>
          <div class="col-message">描述</div>
          <div class="col-hash header-col" :style="{ width: sizes.hashColW + 'px' }">
            提交
            <div class="col-resize" @pointerdown="startColResize($event, 'hash')" />
          </div>
          <div class="col-author header-col" :style="{ width: sizes.authorColW + 'px' }">
            作者
            <div class="col-resize" @pointerdown="startColResize($event, 'author')" />
          </div>
          <div class="col-date header-col" :style="{ width: sizes.dateColW + 'px' }">
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
            <template v-for="vRow in virtualizer.getVirtualItems()" :key="vRow.index">
              <!-- Virtual WIP row (index 0 when working copy has changes) -->
              <div
                v-if="showWipRow && vRow.index === 0"
                class="commit-row wip-row"
                :class="{ selected: selectedWip }"
                :style="{
                  position: 'absolute',
                  top: vRow.start + 'px',
                  height: ROW_H + 'px',
                  width: '100%',
                }"
                @click="selectWipRow"
              >
                <WipRow
                  :unstaged-count="workspaceStore.status?.unstaged.length ?? 0"
                  :untracked-count="workspaceStore.status?.untracked.length ?? 0"
                  :staged-count="workspaceStore.status?.staged.length ?? 0"
                  :branch-name="workspaceStore.status?.head_branch ?? 'HEAD'"
                  :is-selected="selectedWip"
                  :graph-col-width="graphColWidth"
                />
                <div class="col-hash" :style="{ width: sizes.hashColW + 'px' }">—</div>
                <div class="col-author" :style="{ width: sizes.authorColW + 'px' }">—</div>
                <div class="col-date" :style="{ width: sizes.dateColW + 'px' }">—</div>
              </div>

              <!-- Regular commit row -->
              <div
                v-else
                class="commit-row"
                :class="{
                  selected: isSelected(vRow.index),
                  'commit-dim': filteredCommits[toRealIdx(vRow.index)]?.is_unreachable,
                  'commit-stash': filteredCommits[toRealIdx(vRow.index)]?.is_stash,
                }"
                :style="{
                  position: 'absolute',
                  top: vRow.start + 'px',
                  height: ROW_H + 'px',
                  width: '100%',
                }"
                @click="selectRow(vRow.index)"
                @contextmenu="onCommitContextMenu($event, filteredCommits[toRealIdx(vRow.index)])"
              >
                <!-- Graph column -->
                <div class="col-graph" :style="{ width: graphColWidth + 'px' }">
                  <CommitGraphRow
                    v-if="!uiStore.historySearchQuery.trim() && historyStore.graphRows[toRealIdx(vRow.index)]"
                    :row="historyStore.graphRows[toRealIdx(vRow.index)]"
                    :is-selected="isSelected(vRow.index)"
                  />
                </div>

                <!-- Message column with branch tags -->
                <div class="col-message">
                  <span
                    v-for="tag in branchTagMap.get(filteredCommits[toRealIdx(vRow.index)]?.oid ?? '')"
                    :key="tag.name"
                    class="branch-tag"
                    :style="{ color: branchTagColor(tag), borderColor: branchTagColor(tag) }"
                  >{{ tag.name }}</span>
                  <span class="commit-msg">{{ filteredCommits[toRealIdx(vRow.index)]?.summary }}</span>
                </div>

                <!-- Hash column -->
                <div class="col-hash" :style="{ width: sizes.hashColW + 'px' }">{{ filteredCommits[toRealIdx(vRow.index)]?.short_oid }}</div>

                <!-- Author column -->
                <div class="col-author" :style="{ width: sizes.authorColW + 'px' }">{{ filteredCommits[toRealIdx(vRow.index)]?.author_name }}</div>

                <!-- Date column -->
                <div class="col-date" :style="{ width: sizes.dateColW + 'px' }">{{ formatTime(filteredCommits[toRealIdx(vRow.index)]?.time ?? 0) }}</div>
              </div>
            </template>
          </div>

          <!-- Load more indicators -->
          <div v-if="historyStore.loadingMore" class="list-hint">加载更多...</div>
          <div v-if="uiStore.historySearchQuery.trim()" class="list-hint dim">
            找到 {{ filteredCommits.length }} 条（已加载 {{ historyStore.commits.length }} 条）
          </div>
          <div v-else-if="!historyStore.hasMore && historyStore.commits.length > 0" class="list-hint dim">
            共 {{ historyStore.commits.length }} 条
          </div>
        </div>
      </div>

      <!-- Diff (三种模式由 DiffView 内部切换) -->
      <div class="diff-area" v-if="showDetail" :style="panelBorders['diff']" data-panel-id="diff">
        <div class="dock-handle dock-handle-float" @pointerdown="onDragHandlePointerDown('diff', $event)" title="拖拽停靠">
          <svg width="8" height="14" viewBox="0 0 8 14"><circle cx="2" cy="2" r="1" fill="currentColor"/><circle cx="6" cy="2" r="1" fill="currentColor"/><circle cx="2" cy="7" r="1" fill="currentColor"/><circle cx="6" cy="7" r="1" fill="currentColor"/><circle cx="2" cy="12" r="1" fill="currentColor"/><circle cx="6" cy="12" r="1" fill="currentColor"/></svg>
        </div>
        <DiffView :diff="currentDiff" @close="showDetail = false" />
      </div>

      <!-- Info panel: WipPanel when WIP row selected, else CommitInfoPanel -->
      <div class="info-pane" v-if="showDetail" :style="panelBorders['info']" data-panel-id="info">
        <div class="pane-header">
          <div class="dock-handle" @pointerdown="onDragHandlePointerDown('info', $event)" title="拖拽停靠">
            <svg width="8" height="14" viewBox="0 0 8 14"><circle cx="2" cy="2" r="1" fill="currentColor"/><circle cx="6" cy="2" r="1" fill="currentColor"/><circle cx="2" cy="7" r="1" fill="currentColor"/><circle cx="6" cy="7" r="1" fill="currentColor"/><circle cx="2" cy="12" r="1" fill="currentColor"/><circle cx="6" cy="12" r="1" fill="currentColor"/></svg>
          </div>
          <span class="pane-header-title">详情</span>
        </div>
        <WipPanel v-if="selectedWip" />
        <CommitInfoPanel
          v-else
          :commit="historyStore.selectedCommit"
          :selected-file-idx="historyStore.selectedFileDiffIndex"
          @select-file="onSelectFile"
        />
      </div>

      <!-- Main resize handle: spanning 面板与 pair 区之间 -->
      <div
        v-if="showDetail"
        class="pane-resize-handle"
        :style="mainResizeStyle"
        @pointerdown="startMainResize"
      />

      <!-- Secondary resize handle: pair 区内两个面板之间 -->
      <div
        v-if="showDetail"
        class="pane-resize-handle"
        :style="secondaryResizeStyle"
        @pointerdown="startSecondaryResize"
      />

      <!-- Dock drop zone overlay -->
      <div v-if="isDragging" class="dock-overlay">
        <div class="dock-zone dock-zone-top" :class="{ active: hoveredEdge === 'top' }">
          <div class="dock-zone-indicator" />
        </div>
        <div class="dock-zone dock-zone-bottom" :class="{ active: hoveredEdge === 'bottom' }">
          <div class="dock-zone-indicator" />
        </div>
        <div class="dock-zone dock-zone-left" :class="{ active: hoveredEdge === 'left' }">
          <div class="dock-zone-indicator" />
        </div>
        <div class="dock-zone dock-zone-right" :class="{ active: hoveredEdge === 'right' }">
          <div class="dock-zone-indicator" />
        </div>
      </div>
    </div>
  </div>

  <div v-else class="no-repo">
    请从左侧打开一个 Git 仓库
  </div>

  <!-- Commit context menu -->
  <ContextMenu
    :visible="commitMenu.visible"
    :x="commitMenu.x"
    :y="commitMenu.y"
    :items="commitMenuItems"
    @close="closeCommitMenu"
    @select="onCommitMenuAction"
  />

  <!-- Create branch at commit dialog -->
  <CreateBranchDialog
    :visible="showCreateBranchDialog"
    :commit="dialogCommit"
    @close="showCreateBranchDialog = false"
  />

  <!-- Create tag dialog -->
  <CreateTagDialog
    :visible="showCreateTagDialog"
    :commit="dialogCommit"
    :annotated="createTagAnnotated"
    @close="showCreateTagDialog = false"
  />
</template>

<style scoped>
.history-view {
  display: grid;
  grid-template-rows: 1fr;
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

/* ── Content area ────────────────────────────────────────────────── */
.content-area {
  display: grid;
  overflow: hidden;
  min-height: 0;
  position: relative;
}

/* 去掉 CommitInfoPanel / WipPanel 自带的 border-top，由外层 panelBorders 控制 */
.info-pane :deep(.commit-info-panel),
.info-pane :deep(.panel-empty) {
  border-top: none;
}

/* Pane resize handle (通用，方向由 inline style 控制) */
.pane-resize-handle {
  position: absolute;
  z-index: 15;
  background: transparent;
  transition: background 0.15s;
}
.pane-resize-handle:hover,
.pane-resize-handle:active {
  background: rgba(138, 173, 244, 0.3);
}

/* ── Dock handle（拖拽手柄）──────────────────────────────────── */
.dock-handle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  flex-shrink: 0;
  cursor: grab;
  color: var(--text-muted);
  opacity: 0;
  transition: opacity 0.15s;
}
.dock-handle:hover {
  opacity: 1;
  color: var(--text-secondary);
}
.dock-handle:active {
  cursor: grabbing;
}
/* 鼠标进入面板时显示手柄 */
.commit-panel:hover > .col-header > .dock-handle,
.info-pane:hover > .pane-header > .dock-handle,
.diff-area:hover > .dock-handle-float {
  opacity: 0.5;
}

/* Diff 面板的浮动手柄 */
.dock-handle-float {
  position: absolute;
  top: 4px;
  left: 4px;
  z-index: 10;
  width: 16px;
  height: 20px;
}

/* Info 面板的轻量级标题栏 */
.pane-header {
  display: flex;
  align-items: center;
  height: 22px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.pane-header-title {
  padding: 0 4px;
}

/* ── Dock overlay（drop zone）────────────────────────────────── */
.dock-overlay {
  position: absolute;
  inset: 0;
  z-index: 100;
  pointer-events: none;
}

.dock-zone {
  position: absolute;
  pointer-events: auto;
}

.dock-zone-indicator {
  width: 100%;
  height: 100%;
  border: 2px dashed transparent;
  border-radius: 4px;
  transition: background 0.12s, border-color 0.12s;
}

.dock-zone.active .dock-zone-indicator {
  background: rgba(138, 173, 244, 0.15);
  border-color: rgba(138, 173, 244, 0.5);
}

.dock-zone-top {
  top: 0;
  left: 0;
  right: 0;
  height: 60px;
}
.dock-zone-bottom {
  bottom: 0;
  left: 0;
  right: 0;
  height: 60px;
}
.dock-zone-left {
  top: 0;
  bottom: 0;
  left: 0;
  width: 60px;
}
.dock-zone-right {
  top: 0;
  bottom: 0;
  right: 0;
  width: 60px;
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
  overflow: hidden;
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
  overflow: hidden;
}

.commit-row:hover {
  background: var(--bg-overlay);
}

.commit-row.selected {
  background: rgba(138, 173, 244, 0.12);
}

.commit-row.wip-row {
  background: rgba(245, 169, 127, 0.04);
}

.commit-row.wip-row.selected {
  background: rgba(245, 169, 127, 0.15);
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
  min-width: 120px;
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

/* ── 丢失引用的提交（unreachable）：整行变灰 ─────────────────── */
.commit-row.commit-dim .commit-msg,
.commit-row.commit-dim .col-hash,
.commit-row.commit-dim .col-author,
.commit-row.commit-dim .col-date {
  color: var(--text-muted);
  opacity: 0.75;
  font-style: italic;
}

/* stash 行：略微淡化 message 颜色，与普通提交区分 */
.commit-row.commit-stash .commit-msg {
  color: var(--text-secondary);
  font-style: italic;
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
  position: relative;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
  min-height: 0;
}
</style>
