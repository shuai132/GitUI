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

// ── Persisted sizes (layout + pane splits + column widths) ───────────
const SIZES_KEY = 'gitui.history.sizes'
interface SavedSizes {
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

const commitPanePct = ref<number>(saved.commitPanePct ?? 55)
const infoPanePct = ref<number>(saved.infoPanePct ?? 38)
const diffRowPct = ref<number>(saved.diffRowPct ?? 70)
const commitRowPct = ref<number>(saved.commitRowPct ?? 55)
const hashColW = ref<number>(saved.hashColW ?? 64)
const authorColW = ref<number>(saved.authorColW ?? 96)
const dateColW = ref<number>(saved.dateColW ?? 80)

function persistSizes() {
  const data: SavedSizes = {
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

// ── Content area grid style ──────────────────────────────────────────
const contentAreaRef = ref<HTMLElement | null>(null)
const contentGridStyle = computed(() => {
  if (!showDetail.value) {
    return {
      gridTemplateColumns: '1fr',
      gridTemplateRows: '1fr',
      gridTemplateAreas: '"commits"',
    }
  }
  if (uiStore.historyLayoutMode === 'horizontal') {
    return {
      gridTemplateColumns: `${commitPanePct.value}% 1fr`,
      gridTemplateRows: `${diffRowPct.value}% ${100 - diffRowPct.value}%`,
      gridTemplateAreas: '"commits info" "commits diff"',
    }
  }
  return {
    gridTemplateColumns: `${infoPanePct.value}% 1fr`,
    gridTemplateRows: `${commitRowPct.value}% ${100 - commitRowPct.value}%`,
    gridTemplateAreas: '"commits commits" "info diff"',
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
    if (uiStore.historyLayoutMode === 'horizontal') commitPanePct.value = clamped
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
    if (uiStore.historyLayoutMode === 'horizontal') diffRowPct.value = clamped
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
      :class="'layout-' + uiStore.historyLayoutMode"
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
                <div class="col-hash" :style="{ width: hashColW + 'px' }">—</div>
                <div class="col-author" :style="{ width: authorColW + 'px' }">—</div>
                <div class="col-date" :style="{ width: dateColW + 'px' }">—</div>
              </div>

              <!-- Regular commit row -->
              <div
                v-else
                class="commit-row"
                :class="{ selected: isSelected(vRow.index) }"
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
                <div class="col-hash" :style="{ width: hashColW + 'px' }">{{ filteredCommits[toRealIdx(vRow.index)]?.short_oid }}</div>

                <!-- Author column -->
                <div class="col-author" :style="{ width: authorColW + 'px' }">{{ filteredCommits[toRealIdx(vRow.index)]?.author_name }}</div>

                <!-- Date column -->
                <div class="col-date" :style="{ width: dateColW + 'px' }">{{ formatTime(filteredCommits[toRealIdx(vRow.index)]?.time ?? 0) }}</div>
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
      <div class="diff-area" v-if="showDetail">
        <DiffView :diff="currentDiff" @close="showDetail = false" />
      </div>

      <!-- Right info panel: WipPanel when WIP row selected, else CommitInfoPanel -->
      <div class="info-pane" v-if="showDetail">
        <WipPanel v-if="selectedWip" />
        <CommitInfoPanel
          v-else
          :commit="historyStore.selectedCommit"
          :selected-file-idx="historyStore.selectedFileDiffIndex"
          @select-file="onSelectFile"
        />
      </div>

      <!-- Vertical resize handle (左右拖动) -->
      <div
        v-if="showDetail"
        class="pane-resize"
        :style="uiStore.historyLayoutMode === 'horizontal'
          ? { left: commitPanePct + '%', top: 0, bottom: 0 }
          : { left: infoPanePct + '%', top: commitRowPct + '%', bottom: 0 }"
        @pointerdown="startPaneResize"
      />

      <!-- Horizontal resize handle (上下拖动) -->
      <div
        v-if="showDetail"
        class="pane-resize-h"
        :style="uiStore.historyLayoutMode === 'horizontal'
          ? { top: diffRowPct + '%', left: commitPanePct + '%', right: 0 }
          : { top: commitRowPct + '%', left: 0, right: 0 }"
        @pointerdown="startRowResize"
      />
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

/* ── Content area (两种布局模式) ──────────────────────────────────── */
.content-area {
  display: grid;
  overflow: hidden;
  min-height: 0;
  position: relative;
}

/* 左右布局：commits 占左列满高；右列上 info 下 diff */
.content-area.layout-horizontal {
  grid-template-areas:
    "commits info"
    "commits diff";
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
</style>
