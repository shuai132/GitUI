<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { useHistoryStore } from '@/stores/history'
import { useRepoStore } from '@/stores/repos'
import { useWorkspaceStore } from '@/stores/workspace'
import { useDiffStore } from '@/stores/diff'
import { useStashStore } from '@/stores/stash'
import { useUiStore } from '@/stores/ui'
import { useSettingsStore } from '@/stores/settings'
import { formatAbsoluteTime, formatAuthor, formatHistoryTime } from '@/utils/format'
import { LANE_W } from '@/utils/graph'
import CommitGraphRow from '@/components/history/CommitGraphRow.vue'
import WipRow from '@/components/history/WipRow.vue'
import DiffView from '@/components/diff/DiffView.vue'
import CommitInfoPanel from '@/components/history/CommitInfoPanel.vue'
import WipPanel from '@/components/workspace/WipPanel.vue'
import ContextMenu, { type ContextMenuItem } from '@/components/common/ContextMenu.vue'
import FileHistoryModal from '@/components/file-history/FileHistoryModal.vue'
import CreateBranchDialog from '@/components/commit/CreateBranchDialog.vue'
import CreateTagDialog from '@/components/commit/CreateTagDialog.vue'
import Modal from '@/components/common/Modal.vue'
import OngoingOpBanner from '@/components/common/OngoingOpBanner.vue'
import MergeDialog from '@/components/merge/MergeDialog.vue'
import RebasePlanDialog from '@/components/rebase/RebasePlanDialog.vue'
import DragActionDialog from '@/components/history/DragActionDialog.vue'
import { useMergeRebaseStore } from '@/stores/mergeRebase'
import { usePanelDock } from '@/composables/usePanelDock'
import type { PanelId } from '@/stores/ui'
import type { BranchInfo, CommitInfo, TagInfo } from '@/types/git'

import { useHistoryPanes } from '@/composables/history/useHistoryPanes'
import { useCommitContextMenu } from '@/composables/history/useCommitContextMenu'
import { useCommitDragDrop } from '@/composables/history/useCommitDragDrop'
import { useCommitTags } from '@/composables/history/useCommitTags'
import CommitListHeader from '@/components/history/CommitListHeader.vue'

const { t } = useI18n()
const historyStore = useHistoryStore()
const repoStore = useRepoStore()
const workspaceStore = useWorkspaceStore()
const diffStore = useDiffStore()
const stashStore = useStashStore()
const uiStore = useUiStore()
const settingsStore = useSettingsStore()
const mergeRebaseStore = useMergeRebaseStore()

// 历史列表每行高度（响应式，随设置变化）。
// 行 `div.height` 走 CSS 变量 var(--history-row-height)（滚动热路径 0 开销），
// 这里的 computed 仅给虚拟化器 `estimateSize` / 加载阈值用。
const rowH = computed(() => settingsStore.historyRowHeight)

// ── 键盘导航焦点：最后一次点击过 commits / files 中的哪一个 ────────
type ActivePane = 'commits' | 'files'
const activePane = ref<ActivePane>('commits')

// ── 详情区（info + diff）显示状态（默认隐藏，点击提交后显示）────────
const { selectedWip, showDetail } = storeToRefs(historyStore)

const contentAreaRef = ref<HTMLElement | null>(null)
const {
  sizes,
  contentGridStyle,
  mainResizeStyle,
  secondaryResizeStyle,
  panelBorders,
  startMainResize,
  startSecondaryResize,
  startColResize,
} = useHistoryPanes(contentAreaRef, showDetail)

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

// ── 虚拟 WIP 行：工作副本有变更时显示在列表顶部（merge/rebase 进行中时也强制显示）────
const showWipRow = computed(() => {
  const s = workspaceStore.status
  if (!s) return false
  if (mergeRebaseStore.isOngoing) return true
  return s.staged.length + s.unstaged.length + s.untracked.length > 0
})

// 工作区还在加载中（切仓库后还没拿到 status）
const showWipLoading = computed(() =>
  !uiStore.historySearchQuery.trim() && workspaceStore.loading && !workspaceStore.status,
)

// 是否在列表中渲染 WIP / Loading 占位行（搜索时隐藏）
const isWipVisible = computed(() =>
  !uiStore.historySearchQuery.trim() && (showWipRow.value || showWipLoading.value)
)

// 当前是否选中的是 WIP 行（而不是某条 commit）
// WIP 文件统计（用于详情面板标题栏）
const wipStats = computed(() => {
  const s = workspaceStore.status
  if (!s) return { modified: 0, deleted: 0, added: 0 }

  let modified = 0
  let deleted = 0
  let added = 0

  const allFiles = [...s.staged, ...s.unstaged, ...s.untracked]

  for (const f of allFiles) {
    if (f.status === 'deleted') {
      deleted++
    } else if (f.status === 'added' || f.status === 'untracked') {
      added++
    } else {
      modified++
    }
  }

  return { modified, deleted, added }
})

// Commit 文件统计
const commitStats = computed(() => {
  const diffs = historyStore.selectedCommit?.diffs ?? []
  let modified = 0
  let deleted = 0
  let added = 0

  for (const d of diffs) {
    if (!d.new_path || d.new_path === '/dev/null') {
      deleted++
    } else if (!d.old_path || d.old_path === '/dev/null') {
      added++
    } else {
      modified++
    }
  }

  return { modified, deleted, added }
})

// 虚拟行数 = 过滤后 commits + (WIP 行或 WIP 加载占位各占 1 个，搜索时隐藏)
const virtualRowCount = computed(() =>
  filteredCommits.value.length + (isWipVisible.value ? 1 : 0),
)

// 真实 commit 索引 → 虚拟行索引
function toVirtualIdx(realIdx: number): number {
  return isWipVisible.value ? realIdx + 1 : realIdx
}

// 虚拟行索引 → 真实 commit 索引（WIP 行/加载行返回 -1）
function toRealIdx(virtualIdx: number): number {
  if (isWipVisible.value) {
    return virtualIdx === 0 ? -1 : virtualIdx - 1
  }
  return virtualIdx
}

// Unix 秒 → datetime-local 输入框所需的本地时间字符串（YYYY-MM-DDTHH:mm:ss）
function toDatetimeLocal(unixSecs: number): string {
  const d = new Date(unixSecs * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

// datetime-local 字符串 → Unix 秒
function fromDatetimeLocal(s: string): number {
  return Math.floor(new Date(s).getTime() / 1000)
}

const scrollContainer = ref<HTMLElement | null>(null)
// 列头水平滚动偏移：与 commit-list-body 的 scrollLeft 同步，用 transform 平移列头。
// 这样列头不参与 .commit-panel 的水平滚动，body 的垂直滚动条始终贴在面板右缘。
const headerScrollLeft = ref(0)

// ── Virtual list ────────────────────────────────────────────────────
const virtualizer = useVirtualizer(
  computed(() => ({
    count: virtualRowCount.value,
    getScrollElement: () => scrollContainer.value,
    estimateSize: () => rowH.value,
    overscan: 4,
  }))
)

// 行高变化时强制虚拟化器丢弃旧 size 缓存，按新值重排。
watch(rowH, () => {
  virtualizer.value.measure()
})

// Load more when near the bottom; 同步列头水平滚动
function onScroll() {
  const el = scrollContainer.value
  if (!el) return
  if (headerScrollLeft.value !== el.scrollLeft) headerScrollLeft.value = el.scrollLeft
  if (el.scrollHeight - el.scrollTop - el.clientHeight < rowH.value * 5) {
    historyStore.loadMore()
  }
}

// ── 悬停提交行时的自定义 tooltip（配合 app 配色，替代浏览器原生 title） ──
const commitTooltip = reactive({
  visible: false,
  x: 0,
  y: 0,
  text: '',
})
let commitTooltipTimer: number | null = null

function commitPreview(c: CommitInfo | undefined): string {
  if (!c) return ''
  return [
    c.message.trim(),
    '',
    `${t('history.tooltip.author')}: ${c.author_name} <${c.author_email}>`,
    `${t('history.tooltip.date')}: ${formatAbsoluteTime(c.time)}`,
    `${t('history.tooltip.commit')}: ${c.short_oid}`,
  ].join('\n')
}

function showCommitTooltip(e: MouseEvent, commit: CommitInfo | undefined) {
  if (!commit) return
  const text = commitPreview(commit)
  if (commitTooltipTimer !== null) window.clearTimeout(commitTooltipTimer)
  commitTooltipTimer = window.setTimeout(() => {
    commitTooltip.text = text
    commitTooltip.x = e.clientX + 14
    commitTooltip.y = e.clientY + 14
    commitTooltip.visible = true
  }, 400)
}

function moveCommitTooltip(e: MouseEvent) {
  if (!commitTooltip.visible) return
  commitTooltip.x = e.clientX + 14
  commitTooltip.y = e.clientY + 14
}

function hideCommitTooltip() {
  if (commitTooltipTimer !== null) {
    window.clearTimeout(commitTooltipTimer)
    commitTooltipTimer = null
  }
  commitTooltip.visible = false
}

// Windows Chromium/WebView2 中，带 draggable 属性的行元素会阻断 wheel 事件向上
// 冒泡到可滚动父容器，导致垂直滚动失效（macOS WebKit 无此问题）。
// 解决方案：在 scroll container 和列头上统一用 JS 主动接管滚动。
function onListBodyWheel(e: WheelEvent) {
  const el = scrollContainer.value
  if (!el) return

  // 换算 deltaMode → 像素
  // deltaMode 0: pixel（触控板）；1: line（物理鼠标，Windows 默认 deltaY=3）；2: page
  let dy = e.deltaY
  let dx = e.deltaX
  if (e.deltaMode === 1) {
    dy *= rowH.value
    dx *= rowH.value
  } else if (e.deltaMode === 2) {
    dy *= el.clientHeight
    dx *= el.clientWidth
  }

  if (Math.abs(dy) >= Math.abs(dx)) {
    // 纵向滚动：JS 主动写 scrollTop，保证 Windows 下 draggable 行不阻断滚动
    el.scrollTop += dy
  } else {
    // 横向滚动：用于列头区域触发 body 水平滚动
    const before = el.scrollLeft
    el.scrollLeft += dx
    if (el.scrollLeft === before) return // 没消费横向，不 preventDefault
  }
  e.preventDefault()
}

const {
  branchTagMap,
  branchTagColor,
  tagsByCommit,
  tagRemoteStatus,
  tagChipTitle,
} = useCommitTags()

// ── Graph column width ───────────────────────────────────────────────
const graphColWidth = computed(() => {
  if (!historyStore.graphRows.length) return LANE_W * 2
  const maxCols = historyStore.graphRows.reduce((m, r) => Math.max(m, r.totalColumns), 1)
  return maxCols * LANE_W
})

// 提交列表内容的最小宽度：图形 + 描述 + 右三列
// 面板窄于此时会出现横向滚动条，描述优先、右三列通过滑动查看
// descColW 可由用户拖动"提交"列左边缘调整（整体移动右三列组）
const commitListMinWidth = computed(() => {
  return graphColWidth.value + sizes.descColW + sizes.hashColW + sizes.authorColW + sizes.dateColW + sizes.dateCol2W
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
  if (selectedWip.value && isWipVisible.value) return 0
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
  if (isWipVisible.value && virtualIdx === 0) {
    if (showWipRow.value) selectWipRow()
    // WIP 加载中：忽略点击
    return
  }
  const realIdx = toRealIdx(virtualIdx)
  const commit = filteredCommits.value[realIdx]
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
  if (isWipVisible.value && virtualIdx === 0) return selectedWip.value
  const realIdx = toRealIdx(virtualIdx)
  return filteredCommits.value[realIdx]?.oid === selectedOid.value
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

// ── 键盘 ↑↓ 在当前激活的 pane 中切换条目 ─────────────────────────────
// 把 WIP 行/加载占位视为虚拟索引 0。real commits 占虚拟索引 (showWipRow||showWipLoading ? 1 : 0)...count-1。
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


// ── Merge / Rebase 对话框状态 ─────────────────────────────────────
const showMergeDialog = ref(false)
const mergeSourceCandidates = ref<string[]>([])
const showRebaseDialog = ref(false)
const rebaseUpstream = ref('')
const rebaseOnto = ref<string | null>(null)


function openMergeDialog(candidates: string[]) {
  mergeSourceCandidates.value = candidates
  showMergeDialog.value = true
}

function openRebaseDialog(upstream: string, onto: string | null) {
  rebaseUpstream.value = upstream
  rebaseOnto.value = onto
  showRebaseDialog.value = true
}

const {
  showDragDialog,
  dragSourceOid,
  dragTargetOid,
  draggingOid,
  dragOverOid,
  onCommitDragStart,
  onCommitDragOver,
  onCommitDrop,
  onCommitDragEnd,
  onDragDialogMerge,
  onDragDialogRebase,
} = useCommitDragDrop(openMergeDialog, openRebaseDialog)

const currentBranchName = computed(
  () =>
    historyStore.branches.find((b) => b.is_head && !b.is_remote)?.name ?? 'HEAD',
)

const headCommitOid = computed(() => {
  const headBranch = historyStore.branches.find((b) => b.is_head && !b.is_remote)
  return headBranch?.commit_oid ?? historyStore.commits[0]?.oid ?? ''
})

// 目标 commit 是否是 HEAD 的祖先（含 HEAD 本身）。
// 基于已加载的 historyStore.commits 做 BFS：HEAD 起沿 parent_oids 往回走，命中 target 即为祖先。
// 未在已加载 commits 中（超出分页或在其他分支上）的提交保守判定为 false。
function isAncestorOfHead(targetOid: string): boolean {
  const head = headCommitOid.value
  if (!head) return false
  if (head === targetOid) return true
  const oidMap = new Map<string, CommitInfo>()
  for (const c of historyStore.commits) oidMap.set(c.oid, c)
  const visited = new Set<string>()
  const queue: string[] = [head]
  let i = 0
  while (i < queue.length) {
    const oid = queue[i++]
    if (visited.has(oid)) continue
    visited.add(oid)
    if (oid === targetOid) return true
    const c = oidMap.get(oid)
    if (!c) continue
    for (const p of c.parent_oids) queue.push(p)
  }
  return false
}

// 选中的文件是否冲突文件；是则让 DiffView 渲染 ConflictView 代替普通 diff
const currentConflictFilePath = computed<string | null>(() => {
  if (!selectedWip.value) return null
  const path = diffStore.currentPath
  if (!path) return null
  const s = workspaceStore.status
  if (!s) return null
  const all = [...s.staged, ...s.unstaged, ...s.untracked]
  const file = all.find((f) => f.path === path)
  return file?.status === 'conflicted' ? path : null
})

const {
  commitMenu,
  commitMenuItems,
  onCommitContextMenu,
  closeCommitMenu,
  onCommitMenuAction,

  showCreateBranchDialog,
  showCreateTagDialog,
  createTagAnnotated,
  dialogCommit,

  showEditMessageDialog,
  editMessageText,
  editMessageAuthorTime,
  editMessageCommitterTime,
  editMessageAuthorName,
  editMessageAuthorEmail,
  editMessageAutoStash,
  editMessageSubmitting,
  isEditingHeadCommit,
  onEditMessageConfirm,

  dropUnreachableDialog,
  onDropUnreachableConfirm,
  onDropUnreachableCancel,
} = useCommitContextMenu(
  currentBranchName,
  headCommitOid,
  isAncestorOfHead,
  openMergeDialog,
  openRebaseDialog,
)

// ── WIP 行文件 diff：离开 WIP 模式时清掉 diff store 里的工作区 diff ───
watch(selectedWip, (v) => {
  if (!v) diffStore.clear()
})

watch(
  () => historyStore.selectedCommit,
  (commit) => {
    if (commit) {
      selectedWip.value = false
      showDetail.value = true
    }
  },
)

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


// ── 文件历史 / Blame 模态框 ──────────────────────────────────────────
const fileHistoryModal = reactive({
  visible: false,
  filePath: '',
  mode: 'history' as 'history' | 'blame',
})

function openFileHistory(payload: { filePath: string; mode: 'history' | 'blame' }) {
  fileHistoryModal.filePath = payload.filePath
  fileHistoryModal.mode = payload.mode
  fileHistoryModal.visible = true
}

onMounted(() => {
  window.addEventListener('keydown', onKeyDown)
  // 懒加载远程 tag 列表：用于区分本地 / 已同步到远程的 tag chip。
  // loadRemoteTags 内部已吞单个 remote 的失败，这里再兜一层以防意外。
  if (repoStore.activeRepoId) {
    historyStore.loadRemoteTags().catch(() => {})
  }
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
        <!-- Column headers (clip + transform 跟随 body 的水平滚动，让头部不参与外层水平滚动，
             从而 body 的垂直滚动条始终贴在面板右缘可见) -->
        <CommitListHeader
          :commit-list-min-width="commitListMinWidth"
          :header-scroll-left="headerScrollLeft"
          :graph-col-width="graphColWidth"
          :sizes="sizes"
          @list-body-wheel="onListBodyWheel"
          @drag-handle-pointer-down="onDragHandlePointerDown"
          @col-resize-start="startColResize"
        />

        <!-- Virtual list body：水平 + 垂直滚动都收在这里，垂直滚动条永远在 body 右缘 -->
        <!-- @wheel：JS 主动接管滚动，规避 Windows WebView2 中 draggable 行阻断 wheel 冒泡的问题 -->
        <div
          class="commit-list-body"
          ref="scrollContainer"
          @scroll="onScroll"
          @wheel="onListBodyWheel"
        >
          <div
            v-if="historyStore.loading && historyStore.commits.length === 0"
            class="list-hint list-hint-loading"
          >
            <span class="loading-spinner" />
            {{ t('history.loading') }}
          </div>
          <div
            v-else
            :style="{ minWidth: commitListMinWidth + 'px', height: virtualizer.getTotalSize() + 'px', position: 'relative' }"
          >
            <template v-for="vRow in virtualizer.getVirtualItems()" :key="vRow.index">
              <!-- Virtual WIP row (index 0: 工作区有变更时显示，或加载中显示占位) -->
              <div
                v-if="isWipVisible && vRow.index === 0"
                class="commit-row wip-row"
                :class="{ selected: selectedWip, 'wip-ongoing': mergeRebaseStore.isOngoing && !showWipLoading }"
                :style="{
                  position: 'absolute',
                  top: vRow.start + 'px',
                  height: 'var(--history-row-height)',
                  width: '100%',
                }"
                @click="showWipRow ? selectWipRow() : undefined"
              >
                <!-- WIP 加载中占位 -->
                <template v-if="showWipLoading">
                  <div class="wip-loading-row">
                    <span class="loading-spinner" />
                    <span class="wip-loading-text">{{ t('history.loading') }}</span>
                  </div>
                </template>
                <!-- Merge / Rebase 进行中：WIP 行本身作为提示条 -->
                <template v-else-if="mergeRebaseStore.isOngoing">
                  <OngoingOpBanner class="wip-inline-banner" />
                </template>
                <!-- 正常 WIP 行 -->
                <template v-else>
                <WipRow
                  :unstaged-count="workspaceStore.status?.unstaged.length ?? 0"
                  :untracked-count="workspaceStore.status?.untracked.length ?? 0"
                  :staged-count="workspaceStore.status?.staged.length ?? 0"
                  :branch-name="workspaceStore.status?.head_branch ?? 'HEAD'"
                  :is-selected="selectedWip"
                  :graph-col-width="graphColWidth"
                  :desc-col-width="sizes.descColW"
                />
                <div class="col-hash" :style="{ width: sizes.hashColW + 'px' }">—</div>
                <div class="col-author" :style="{ width: sizes.authorColW + 'px' }">—</div>
                <div class="col-date" :style="{ width: sizes.dateColW + 'px' }">—</div>
                <div class="col-date" :style="{ width: sizes.dateCol2W + 'px' }"></div>
                </template>
              </div>

              <!-- Regular commit row -->
              <div
                v-else
                class="commit-row"
                :class="{
                  selected: isSelected(vRow.index),
                  'commit-dim': filteredCommits[toRealIdx(vRow.index)]?.is_unreachable,
                  'commit-stash': filteredCommits[toRealIdx(vRow.index)]?.is_stash,
                  'drag-target': dragOverOid === filteredCommits[toRealIdx(vRow.index)]?.oid,
                  'drag-source': draggingOid === filteredCommits[toRealIdx(vRow.index)]?.oid,
                }"
                :style="{
                  position: 'absolute',
                  top: vRow.start + 'px',
                  height: 'var(--history-row-height)',
                  width: '100%',
                }"
                :draggable="!filteredCommits[toRealIdx(vRow.index)]?.is_stash"
                @click="selectRow(vRow.index)"
                @contextmenu="onCommitContextMenu($event, filteredCommits[toRealIdx(vRow.index)])"
                @dragstart="onCommitDragStart($event, filteredCommits[toRealIdx(vRow.index)])"
                @dragover="onCommitDragOver($event, filteredCommits[toRealIdx(vRow.index)])"
                @drop="onCommitDrop($event, filteredCommits[toRealIdx(vRow.index)])"
                @dragend="onCommitDragEnd"
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
                <div
                  class="col-message"
                  :style="{ width: sizes.descColW + 'px' }"
                  @mouseenter="showCommitTooltip($event, filteredCommits[toRealIdx(vRow.index)])"
                  @mousemove="moveCommitTooltip"
                  @mouseleave="hideCommitTooltip"
                >
                  <span
                    v-for="tagItem in tagsByCommit.get(filteredCommits[toRealIdx(vRow.index)]?.oid ?? '')"
                    :key="'tag:' + tagItem.name"
                    class="tag-chip"
                    :class="'tag-chip--' + tagRemoteStatus(tagItem)"
                    :title="tagChipTitle(tagItem)"
                  >
                    <svg
                      width="9"
                      height="9"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2.5"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
                      <line x1="7" y1="7" x2="7.01" y2="7"/>
                    </svg>
                    {{ tagItem.name }}
                    <span
                      v-if="tagRemoteStatus(tagItem) === 'synced'"
                      class="tag-status-icon tag-status-icon--synced"
                      aria-hidden="true"
                    >✓</span>
                    <span
                      v-else-if="tagRemoteStatus(tagItem) === 'local_only'"
                      class="tag-status-icon tag-status-icon--local"
                      aria-hidden="true"
                    >↑</span>
                  </span>
                  <span
                    v-for="tag in branchTagMap.get(filteredCommits[toRealIdx(vRow.index)]?.oid ?? '')"
                    :key="tag.name"
                    class="branch-tag"
                    :style="{ color: branchTagColor(tag), borderColor: branchTagColor(tag) }"
                  >{{ tag.name }}</span>
                  <span
                    v-if="filteredCommits[toRealIdx(vRow.index)]?.is_reflog_tip"
                    class="reflog-tip-dot"
                    :title="t('history.reflogTip')"
                    aria-hidden="true"
                  >◉ </span>
                  <span class="commit-msg">{{ filteredCommits[toRealIdx(vRow.index)]?.summary }}</span>
                </div>

                <!-- Hash column -->
                <div class="col-hash" :style="{ width: sizes.hashColW + 'px' }">{{ filteredCommits[toRealIdx(vRow.index)]?.short_oid }}</div>

                <!-- Author column -->
                <div class="col-author" :style="{ width: sizes.authorColW + 'px' }">{{ formatAuthor(filteredCommits[toRealIdx(vRow.index)]?.author_name ?? '', filteredCommits[toRealIdx(vRow.index)]?.author_email) }}</div>

                <!-- Date column -->
                <div class="col-date" :style="{ width: sizes.dateColW + 'px' }">{{ formatHistoryTime(filteredCommits[toRealIdx(vRow.index)]?.time ?? 0) }}</div>

                <!-- Date2 column (空白，仅用于承载日期列右侧拖拽 handle) -->
                <div class="col-date" :style="{ width: sizes.dateCol2W + 'px' }"></div>
              </div>
            </template>
          </div>

          <!-- Load more indicators -->
          <div v-if="historyStore.loadingMore" class="list-hint">{{ t('history.loadingMore') }}</div>
          <div v-if="uiStore.historySearchQuery.trim()" class="list-hint dim">
            {{ t('history.search.foundOf', { found: filteredCommits.length, loaded: historyStore.commits.length }) }}
          </div>
          <div v-else-if="!historyStore.hasMore && historyStore.commits.length > 0" class="list-hint dim">
            {{ t('history.totalCount', { count: historyStore.commits.length }) }}
          </div>
        </div>
      </div>

      <!-- Diff (三种模式由 DiffView 内部切换) -->
      <div class="diff-area" v-if="showDetail" :style="panelBorders['diff']" data-panel-id="diff">
        <div class="dock-handle dock-handle-float" @pointerdown="onDragHandlePointerDown('diff', $event)" :title="t('history.dock.dragToMove')">
          <svg width="8" height="14" viewBox="0 0 8 14"><circle cx="2" cy="2" r="1" fill="currentColor"/><circle cx="6" cy="2" r="1" fill="currentColor"/><circle cx="2" cy="7" r="1" fill="currentColor"/><circle cx="6" cy="7" r="1" fill="currentColor"/><circle cx="2" cy="12" r="1" fill="currentColor"/><circle cx="6" cy="12" r="1" fill="currentColor"/></svg>
        </div>
        <DiffView
          :diff="currentDiff"
          :repo-id="repoStore.activeRepoId ?? undefined"
          :wip="selectedWip ? { staged: diffStore.currentStaged } : null"
          :conflict-file-path="currentConflictFilePath"
          @close="showDetail = false"
        />
      </div>

      <!-- Info panel: WipPanel when WIP row selected, else CommitInfoPanel -->
      <div class="info-pane" v-if="showDetail" :style="panelBorders['info']" data-panel-id="info">
        <div class="pane-header">
          <div class="dock-handle" @pointerdown="onDragHandlePointerDown('info', $event)" :title="t('history.dock.dragToMove')">
            <svg width="8" height="14" viewBox="0 0 8 14"><circle cx="2" cy="2" r="1" fill="currentColor"/><circle cx="6" cy="2" r="1" fill="currentColor"/><circle cx="2" cy="7" r="1" fill="currentColor"/><circle cx="6" cy="7" r="1" fill="currentColor"/><circle cx="2" cy="12" r="1" fill="currentColor"/><circle cx="6" cy="12" r="1" fill="currentColor"/></svg>
          </div>
          <span class="pane-header-title" />
          <!-- 文件变更统计 -->
          <span v-if="selectedWip" class="pane-header-stats">
            <span class="ph-stat" title="Modified">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 20h9"/>
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
              </svg>
              <span class="ph-stat-label">modified</span>
              <span class="ph-stat-value">{{ wipStats.modified }}</span>
            </span>
            <span class="ph-stat deleted" title="Deleted">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              <span class="ph-stat-label">deleted</span>
              <span class="ph-stat-value">{{ wipStats.deleted }}</span>
            </span>
            <span class="ph-stat added" title="Added">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="5" x2="12" y2="19"/>
                <line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              <span class="ph-stat-label">added</span>
              <span class="ph-stat-value">{{ wipStats.added }}</span>
            </span>
          </span>
          <!-- Commit 统计信息 -->
          <span v-else-if="historyStore.selectedCommit" class="pane-header-stats">
            <span class="ph-stat" title="Modified">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 20h9"/>
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
              </svg>
              <span class="ph-stat-label">modified</span>
              <span class="ph-stat-value">{{ commitStats.modified }}</span>
            </span>
            <span class="ph-stat deleted" title="Deleted">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              <span class="ph-stat-label">deleted</span>
              <span class="ph-stat-value">{{ commitStats.deleted }}</span>
            </span>
            <span class="ph-stat added" title="Added">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="5" x2="12" y2="19"/>
                <line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              <span class="ph-stat-label">added</span>
              <span class="ph-stat-value">{{ commitStats.added }}</span>
            </span>
          </span>
        </div>
        <WipPanel v-if="selectedWip" @show-file-history="openFileHistory" />
        <CommitInfoPanel
          v-else
          :commit="historyStore.selectedCommit"
          :selected-file-idx="historyStore.selectedFileDiffIndex"
          @select-file="onSelectFile"
          @show-file-history="openFileHistory"
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
    {{ t('history.empty.noActiveRepo') }}
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

  <!-- Merge dialog -->
  <MergeDialog
    :visible="showMergeDialog"
    :source-commit-oid="null"
    :candidate-sources="mergeSourceCandidates"
    @close="showMergeDialog = false"
  />

  <!-- Rebase plan dialog -->
  <RebasePlanDialog
    :visible="showRebaseDialog"
    :upstream="rebaseUpstream"
    :onto="rebaseOnto"
    @close="showRebaseDialog = false"
  />

  <!-- Drag commit → pick merge/rebase dialog -->
  <DragActionDialog
    :visible="showDragDialog"
    :source-oid="dragSourceOid"
    :target-oid="dragTargetOid"
    @close="showDragDialog = false"
    @merge="onDragDialogMerge"
    @rebase="onDragDialogRebase"
  />

  <!-- Edit commit message dialog -->
  <Modal
    v-if="showEditMessageDialog"
    :visible="showEditMessageDialog"
    :title="t('history.dialog.editMessage.title')"
    width="480px"
    @close="showEditMessageDialog = false"
  >
    <div v-if="!isEditingHeadCommit" class="edit-message-hint">
      {{ t('history.dialog.editMessage.rewordHint') }}
    </div>
    <textarea
      v-model="editMessageText"
      class="edit-message-input"
      rows="6"
      spellcheck="false"
      autocomplete="off"
    />
    <div class="edit-message-times">
      <label class="edit-message-time-row">
        <span class="edit-message-time-label">{{ t('history.dialog.editMessage.committerDate') }}</span>
        <input
          v-model="editMessageCommitterTime"
          type="datetime-local"
          step="1"
          class="edit-message-time-input"
        />
      </label>
      <label class="edit-message-time-row">
        <span class="edit-message-time-label">{{ t('history.dialog.editMessage.authorDate') }}</span>
        <input
          v-model="editMessageAuthorTime"
          type="datetime-local"
          step="1"
          class="edit-message-time-input"
        />
      </label>
      <label class="edit-message-time-row">
        <span class="edit-message-time-label">{{ t('history.dialog.editMessage.authorName') }}</span>
        <input
          v-model="editMessageAuthorName"
          type="text"
          class="edit-message-time-input"
          autocomplete="off"
          spellcheck="false"
        />
      </label>
      <label class="edit-message-time-row">
        <span class="edit-message-time-label">{{ t('history.dialog.editMessage.authorEmail') }}</span>
        <input
          v-model="editMessageAuthorEmail"
          type="email"
          class="edit-message-time-input"
          autocomplete="off"
          spellcheck="false"
        />
      </label>
    </div>
    <label v-if="!isEditingHeadCommit" class="edit-message-autostash">
      <input v-model="editMessageAutoStash" type="checkbox" />
      <span>{{ t('history.dialog.editMessage.autoStash') }}</span>
    </label>
    <template #footer>
      <button class="btn btn-secondary" @click="showEditMessageDialog = false">{{ t('common.cancel') }}</button>
      <button
        class="btn btn-primary"
        :disabled="!editMessageText.trim() || editMessageSubmitting"
        @click="onEditMessageConfirm"
      >{{ t('history.dialog.editMessage.confirm') }}</button>
    </template>
  </Modal>

  <!-- Drop unreachable reflog entries dialog（替代原生 confirm/alert） -->
  <Modal
    v-if="dropUnreachableDialog.visible"
    :visible="dropUnreachableDialog.visible"
    :title="t('history.dialog.dropUnreachable.title')"
    width="480px"
    @close="onDropUnreachableCancel"
  >
    <p class="drop-unreachable-body">
      <template v-if="dropUnreachableDialog.count === 0">
        {{ t('history.dialog.dropUnreachable.emptyBody', { shortOid: dropUnreachableDialog.commit?.short_oid ?? '' }) }}
      </template>
      <template v-else>
        {{ t('history.dialog.dropUnreachable.body', {
          shortOid: dropUnreachableDialog.commit?.short_oid ?? '',
          count: dropUnreachableDialog.count,
        }) }}
      </template>
    </p>
    <template #footer>
      <button class="btn btn-secondary" @click="onDropUnreachableCancel">
        {{ dropUnreachableDialog.count === 0 ? t('history.dialog.dropUnreachable.close') : t('common.cancel') }}
      </button>
      <button
        v-if="dropUnreachableDialog.count > 0"
        class="btn btn-primary"
        :disabled="dropUnreachableDialog.submitting"
        @click="onDropUnreachableConfirm"
      >{{ t('history.dialog.dropUnreachable.confirm') }}</button>
    </template>
  </Modal>

  <!-- Commit hover tooltip（自定义样式，跟随鼠标） -->
  <div
    v-if="commitTooltip.visible"
    class="commit-tooltip"
    :style="{ left: commitTooltip.x + 'px', top: commitTooltip.y + 'px' }"
  >{{ commitTooltip.text }}</div>

  <!-- 文件历史 / Blame 模态框 -->
  <FileHistoryModal
    v-if="fileHistoryModal.visible"
    :file-path="fileHistoryModal.filePath"
    :initial-mode="fileHistoryModal.mode"
    @close="fileHistoryModal.visible = false"
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
  font-size: var(--font-base);
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
  width: 10px;
  flex-shrink: 0;
  cursor: grab;
  color: var(--text-muted);
  opacity: 0.5;
  transition: opacity 0.15s;
}
.dock-handle:hover {
  opacity: 1;
  color: var(--text-secondary);
}
.dock-handle:active {
  cursor: grabbing;
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
  font-size: var(--font-sm);
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.pane-header-title {
  padding: 0 1px;
  white-space: nowrap;
  flex-shrink: 0;
}

.pane-header-stats {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-left: 0px;
  text-transform: none;
  letter-spacing: normal;
  font-weight: 500;
}

.ph-stat {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: var(--font-xs);
  color: var(--text-secondary);
}

.ph-stat svg {
  color: var(--accent-orange);
}

.ph-stat.deleted svg {
  color: var(--accent-red);
}

.ph-stat.added svg {
  color: var(--accent-green);
}

.ph-stat-label {
  color: var(--text-muted);
}

.ph-stat-value {
  color: var(--text-primary);
  font-weight: 600;
  min-width: 14px;
  text-align: right;
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
  /* 水平滚动收进 .commit-list-body，让 body 始终撑满 panel 宽度，
     垂直滚动条永远贴在 panel 右缘可见。 */
  overflow: hidden;
  min-width: 0;
  min-height: 0;
}

/* 列头裁剪容器：内部的 .col-header 用 transform 跟随 body.scrollLeft 平移，
   超出 panel 宽度的部分由这层裁掉。 */
.col-header-clip {
  position: relative;
  overflow: hidden;
  flex-shrink: 0;
}

.info-pane {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
  min-height: 0;
}

.col-header {
  position: relative;
  display: flex;
  align-items: center;
  height: 26px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  font-size: var(--font-sm);
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

/* dock-handle 在 col-header 里绝对定位，避免占 flex 流导致列头整体右移（与数据行 .commit-row 错位）。 */
.col-header > .dock-handle {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  height: auto;
  z-index: 3;
}

.commit-list-body {
  flex: 1;
  /* overflow-y: scroll → 始终保留垂直滚动条 gutter，避免 macOS 默认"按需显示"导致跳动。
     overflow-x: auto → 水平滚动收在 body 内部，列头通过 onScroll 同步偏移；
     这样垂直滚动条永远贴在 body 右缘（= panel 右缘），不会被外层水平溢出推走。 */
  overflow-x: auto;
  overflow-y: scroll;
}

.commit-row {
  display: flex;
  align-items: center;
  cursor: pointer;
  border-bottom: 1px var(--row-separator-style) rgba(var(--row-separator-rgb), var(--row-separator-alpha));
  transition: background 0.08s;
}

.commit-row:hover {
  background: var(--bg-overlay);
}

.commit-row.selected {
  background: var(--row-selected-bg);
}

/* 拖拽视觉反馈：目标行浅绿高亮 + 绿色 outline，源行变淡 */
.commit-row.drag-target {
  background: var(--staged-accent-bg);
  outline: 1px solid var(--accent-green);
  outline-offset: -1px;
}
.commit-row.drag-source {
  opacity: 0.45;
}
/* drop target 语义压过 selected 蓝底，避免拖到选中行看不出瞄准 */
.commit-row.selected.drag-target {
  background: var(--staged-accent-bg);
}

.commit-row.selected .commit-msg,
.commit-row.selected .col-hash,
.commit-row.selected .col-author,
.commit-row.selected .col-date {
  color: var(--row-selected-fg);
}

/* 选中行里 chip 统一变为前景色：tag-chip 用 CSS 变量覆盖；
   branch-tag 的 color/border-color 是内联 style，必须用 !important */
.commit-row.selected .tag-chip {
  color: var(--row-selected-fg);
  border-color: var(--row-selected-fg);
}
.commit-row.selected .branch-tag {
  color: var(--row-selected-fg) !important;
  border-color: var(--row-selected-fg) !important;
}

.commit-row.wip-row {
  background: rgba(139, 213, 202, 0.05);
}

/* 选中时用 Catppuccin Teal（半透明底），与普通 commit 的实心蓝区分，
   暗示"这是进行中的工作副本"而非已落盘的提交 */
.commit-row.wip-row.selected {
  background: rgba(139, 213, 202, 0.2);
}

/* Merge / Rebase 进行中的 WIP 行：让 banner 撑满整行 */
.commit-row.wip-ongoing {
  background: transparent;
  cursor: default;
}

.commit-row.wip-ongoing .wip-inline-banner {
  width: 100%;
  height: 100%;
}

/* ── Columns ─────────────────────────────────────────────────────── */
.col-graph {
  flex-shrink: 0;
  overflow: hidden;
  display: flex;
  align-items: center;
}

.col-message {
  flex-shrink: 0;
  padding: 0 8px;
  display: flex;
  align-items: center;
  gap: 4px;
  overflow: hidden;
}

.col-hash {
  flex-shrink: 0;
  font-family: Menlo, 'SF Mono', monospace;
  font-size: var(--font-sm);
  color: var(--accent-blue);
  padding: 0 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.col-author {
  flex-shrink: 0;
  font-size: var(--font-sm);
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 0 6px;
}

.col-date {
  flex-shrink: 0;
  font-size: var(--font-sm);
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

/* 列头之间的垂直分隔线（每个列头左侧）。col-resize 拖拽手柄浮在 border 之上，不影响操作。 */
.col-header > .col-message,
.col-header > .header-col {
  border-left: 1px solid var(--border);
}

/* Header 单元格：不继承数据行列的字体/颜色（如 hash 的蓝 monospace），
   而是延用 .col-header 的灰色大写粗体样式，且明确左对齐。 */
.col-header > .col-hash,
.col-header > .col-author,
.col-header > .col-date,
.col-header > .col-message {
  color: inherit;
  font-family: inherit;
  text-align: left;
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
  font-size: var(--font-md);
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── 提交悬停 tooltip（自定义，适配 Catppuccin 色彩） ─────────────── */
.commit-tooltip {
  position: fixed;
  z-index: 9999;
  max-width: 560px;
  padding: 8px 12px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: var(--font-sm);
  line-height: 1.5;
  white-space: pre-wrap;
  pointer-events: none;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45);
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

/* reflog tip 标识：未引用链路的入口提交，显示橙色小圆点 */
.reflog-tip-dot {
  color: var(--accent-yellow, #f5a97f);
  font-size: 9px;
  vertical-align: middle;
  user-select: none;
  -webkit-user-select: none;
  flex-shrink: 0;
}

.commit-row.commit-stash .commit-msg {
  color: var(--text-secondary);
  font-style: italic;
}

/* 选中时覆盖 dim / stash 的淡化规则：文字统一变白（保留斜体视觉标识） */
.commit-row.selected.commit-dim .commit-msg,
.commit-row.selected.commit-dim .col-hash,
.commit-row.selected.commit-dim .col-author,
.commit-row.selected.commit-dim .col-date,
.commit-row.selected.commit-stash .commit-msg {
  color: var(--row-selected-fg);
  opacity: 1;
}

.branch-tag {
  display: inline-block;
  font-size: var(--font-xs);
  border: 1px solid;
  border-radius: 3px;
  padding: 0 4px;
  line-height: 14px;
  flex-shrink: 0;
  white-space: nowrap;
  opacity: 0.9;
}

.tag-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: var(--font-xs);
  border: 1px solid var(--accent-yellow);
  color: var(--accent-yellow);
  border-radius: 3px;
  padding: 0 4px;
  line-height: 14px;
  flex-shrink: 0;
  white-space: nowrap;
  opacity: 0.9;
}

/* 远程同步状态图标：直接跟在 tag 名后面 */
.tag-status-icon {
  font-size: 10px;
  line-height: 1;
  font-weight: 700;
  margin-left: 1px;
}
.tag-status-icon--synced {
  color: var(--accent-green);
}
.tag-status-icon--local {
  color: var(--accent-orange);
}
/* 选中行里图标也随前景色 */
.commit-row.selected .tag-status-icon {
  color: inherit !important;
}

/* ── Hints ───────────────────────────────────────────────────────── */
.list-hint {
  text-align: center;
  padding: 10px;
  font-size: var(--font-sm);
  color: var(--text-muted);
}

.list-hint.dim {
  opacity: 0.6;
}

.list-hint-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
}

/* ── 旋转加载指示器 ──────────────────────────────────────────────── */
@keyframes spin {
  to { transform: rotate(360deg); }
}

.loading-spinner {
  display: inline-block;
  flex-shrink: 0;
  width: 13px;
  height: 13px;
  border: 2px solid var(--border);
  border-top-color: var(--accent-blue);
  border-radius: 50%;
  animation: spin 0.65s linear infinite;
}

.wip-loading-row {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 12px;
  height: 100%;
  font-size: var(--font-sm);
  color: var(--text-muted);
}

.wip-loading-text {
  opacity: 0.8;
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

.edit-message-input {
  width: 100%;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-primary);
  font-family: inherit;
  font-size: var(--font-md);
  padding: 8px;
  resize: vertical;
  outline: none;
  box-sizing: border-box;
}

.edit-message-input:focus {
  border-color: var(--accent-blue);
}

.edit-message-hint {
  font-size: var(--font-sm);
  color: var(--text-secondary);
  margin-bottom: 8px;
  padding: 6px 10px;
  background: var(--bg-overlay);
  border-radius: 4px;
}

.edit-message-autostash {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
  font-size: var(--font-md);
  color: var(--text-secondary);
  cursor: pointer;
}

.edit-message-autostash input[type='checkbox'] {
  cursor: pointer;
  accent-color: var(--accent-blue);
}

.edit-message-times {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 10px;
}

.edit-message-time-row {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: default;
}

.edit-message-time-label {
  font-size: var(--font-sm);
  color: var(--text-secondary);
  min-width: 120px;
  flex-shrink: 0;
}

.edit-message-time-input {
  flex: 1;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-primary);
  font-family: inherit;
  font-size: var(--font-sm);
  padding: 4px 6px;
  outline: none;
  box-sizing: border-box;
}

.edit-message-time-input:focus {
  border-color: var(--accent-blue);
}

.drop-unreachable-body {
  margin: 0;
  color: var(--text-primary);
  font-size: var(--font-md);
  line-height: 1.55;
}

</style>
