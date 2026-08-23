<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useWorkspaceStore } from '@/stores/workspace'
import { useDiffStore } from '@/stores/diff'
import { useUiStore } from '@/stores/ui'
import { useRepoStore } from '@/stores/repos'
import { useSettingsStore } from '@/stores/settings'
import { useSubmodulesStore } from '@/stores/submodules'
import { useGitCommands } from '@/composables/useGitCommands'
import { useGlobalToast } from '@/composables/useGlobalToast'
import { useWipFileActions } from '@/composables/workspace/useWipFileActions'
import { useWipMenus } from '@/composables/workspace/useWipMenus'
import {
  isWorkspaceDiscardContextCurrent,
  type PendingWorkspaceDiscard,
} from '@/composables/workspace/workspaceDiscardConfirmation'
import type { FileEntry, SubmoduleInfo } from '@/types/git'
import { sortByFileOrder, type FileOrderPlacement } from '@/utils/fileOrderPrefs'
import { findSelectedWipIndex, findWipFileBySelection } from '@/utils/wipSelection'
import FileChangeList from '@/components/workspace/FileChangeList.vue'
import WipCommitBox from '@/components/workspace/WipCommitBox.vue'
import WorkspaceDiscardDialog from '@/components/workspace/WorkspaceDiscardDialog.vue'
import Modal from '@/components/common/Modal.vue'
import ContextMenu from '@/components/common/ContextMenu.vue'
import { useMergeRebaseStore } from '@/stores/mergeRebase'
import type { ContextMenuPayload } from '@/components/workspace/FileChangeList.vue'

const { t } = useI18n()

// ── 视图模式 (List / Tree) ──────────────────────────────────────
const WIP_VIEW_MODE_KEY = 'wip-view-mode'
const viewMode = ref<'list' | 'tree'>((localStorage.getItem(WIP_VIEW_MODE_KEY) as 'list' | 'tree') || 'list')

function toggleViewMode() {
  viewMode.value = viewMode.value === 'list' ? 'tree' : 'list'
  localStorage.setItem(WIP_VIEW_MODE_KEY, viewMode.value)
}
const workspaceStore = useWorkspaceStore()
const diffStore = useDiffStore()
const uiStore = useUiStore()
const repoStore = useRepoStore()
const settingsStore = useSettingsStore()
const submodulesStore = useSubmodulesStore()
const git = useGitCommands()
const mergeRebaseStore = useMergeRebaseStore()
const { showError, showActionError } = useGlobalToast()
const activeRepoPath = computed(() => repoStore.activeRepo()?.path)

const emit = defineEmits<{
  showFileHistory: [payload: { filePath: string; mode: 'history' | 'blame' }]
}>()

// ── 头部统计 ──────────────────────────────────────────────────────
const totalCount = computed(() => {
  const s = workspaceStore.status
  if (!s) return 0
  return s.staged.length + s.unstaged.length + s.untracked.length
})

const branchLabel = computed(() => {
  const s = workspaceStore.status
  if (!s) return 'HEAD'
  if (s.head_branch) return s.head_branch
  if (s.is_detached && s.head_commit) return `(detached ${s.head_commit.slice(0, 7)})`
  if (!s.head_commit) return 'initial commit'
  return 'HEAD'
})

const isUnborn = computed(() => {
  const s = workspaceStore.status
  return !!s && !s.head_commit
})

// ── 合并 unstaged + untracked 列表到一个"未暂存"区 ──────────────────
const rawUnstagedAll = computed<FileEntry[]>(() => {
  const s = workspaceStore.status
  if (!s) return []
  return [...s.unstaged, ...s.untracked]
})

const rawStagedAll = computed<FileEntry[]>(() => workspaceStore.status?.staged ?? [])
const fileOrderBucket = computed(() => uiStore.getChangedFileOrder(activeRepoPath.value))
const unstagedAll = computed<FileEntry[]>(() =>
  viewMode.value === 'list'
    ? sortByFileOrder(rawUnstagedAll.value, fileOrderBucket.value, (file) => file.path)
    : rawUnstagedAll.value,
)
const stagedAll = computed<FileEntry[]>(() =>
  viewMode.value === 'list'
    ? sortByFileOrder(rawStagedAll.value, fileOrderBucket.value, (file) => file.path)
    : rawStagedAll.value,
)
const submodulePaths = computed(() => submodulesStore.submodules.map((submodule) => submodule.path))

// ── 文件选择 & diff 加载 ──────────────────────────────────────────
const selectedPath = storeToRefs(workspaceStore).wipSelectedPath
const panelListsRef = ref<HTMLElement | null>(null)
const unstagedListRef = ref<InstanceType<typeof FileChangeList> | null>(null)
const stagedListRef = ref<InstanceType<typeof FileChangeList> | null>(null)

const isAllExpanded = ref(false)
function toggleExpandCollapseAll() {
  isAllExpanded.value = !isAllExpanded.value
  if (isAllExpanded.value) {
    unstagedListRef.value?.expandAll()
    stagedListRef.value?.expandAll()
  } else {
    unstagedListRef.value?.collapseAll()
    stagedListRef.value?.collapseAll()
  }
}

/** 合并的文件列表（未暂存 + 已暂存），与视觉顺序一致 */
const allFiles = computed<FileEntry[]>(() => [...unstagedAll.value, ...stagedAll.value])

function onSelectFile(file: FileEntry) {
  selectedPath.value = file.path
  diffStore.loadFileDiff(file.path, file.staged)
  // 选中文件后聚焦列表容器，使键盘导航可用
  panelListsRef.value?.focus()
}

async function onOpenFileInEditor(file: FileEntry) {
  const repoPath = activeRepoPath.value
  if (!repoPath) return
  try {
    await git.openFileInEditor(`${repoPath}/${file.path}`)
  } catch (caught: unknown) {
    showActionError(caught, t('workspace.fileList.openFailed', { detail: String(caught) }))
  }
}

async function onToggleFile(fileOrPath: FileEntry | string, isDir: boolean) {
  await toggleFile(fileOrPath, isDir)
}

async function onStageAll() {
  await stageAll()
}

// ── 多选状态 ──────────────────────────────────────────────────────
const unstagedMultiPaths = ref<string[]>([])
const stagedMultiPaths = ref<string[]>([])

function onUnstagedMultiSelect(paths: string[]) {
  unstagedMultiPaths.value = paths
}

function onStagedMultiSelect(paths: string[]) {
  stagedMultiPaths.value = paths
}

async function openSubmoduleFromWip(submodule: SubmoduleInfo) {
  const repoId = repoStore.activeRepoId
  if (!repoId) return
  try {
    const absPath = await submodulesStore.workdir(repoId, submodule.name)
    if (repoStore.activeRepoId !== repoId) return
    await repoStore.openRepo(absPath)
  } catch (err) {
    console.error(err)
    showActionError(err, t('sidebar.submodule.openFailed', { detail: String(err) }))
  }
}

async function initSubmoduleFromWip(submodule: SubmoduleInfo) {
  const repoId = repoStore.activeRepoId
  if (!repoId) return
  try {
    await submodulesStore.init(repoId, submodule.name)
    if (repoStore.activeRepoId === repoId) {
      await workspaceStore.refresh(repoId)
    }
  } catch (err) {
    console.error(err)
    showActionError(err, t('common.operationFailed', { detail: String(err) }))
  }
}

async function updateSubmoduleFromWip(submodule: SubmoduleInfo) {
  const repoId = repoStore.activeRepoId
  if (!repoId) return
  try {
    await submodulesStore.update(repoId, submodule.name)
    if (repoStore.activeRepoId === repoId) {
      await workspaceStore.refresh(repoId)
    }
  } catch (err) {
    console.error(err)
    showActionError(err, t('common.operationFailed', { detail: String(err) }))
  }
}

const {
  toggleFile,
  stageAll,
  unstageAll,
  batchStage: stageSelected,
  batchUnstage: unstageSelected,
  discardSelectedPaths,
} = useWipFileActions({
  workspaceStore,
  selectedPath,
  unstagedAll,
  stagedAll,
  unstagedMultiPaths,
  stagedMultiPaths,
  unstagedListRef,
  stagedListRef,
})

const pendingWorkspaceDiscard = ref<PendingWorkspaceDiscard | null>(null)
const workspaceDiscardLoading = ref(false)

function requestWorkspaceDiscard(kind: PendingWorkspaceDiscard['kind'], paths: readonly string[]) {
  const repoId = repoStore.activeRepoId
  if (!repoId || paths.length === 0) return
  pendingWorkspaceDiscard.value = {
    repoId,
    kind,
    paths: [...paths],
  }
}

function requestDiscardFile(filePath: string) {
  requestWorkspaceDiscard('file', [filePath])
}

async function confirmWorkspaceDiscard() {
  const request = pendingWorkspaceDiscard.value
  if (!request || workspaceDiscardLoading.value) return
  if (!isWorkspaceDiscardContextCurrent(request, repoStore.activeRepoId)) {
    cancelWorkspaceDiscard()
    showError(t('workspace.confirmDiscard.contextChanged'))
    return
  }

  workspaceDiscardLoading.value = true
  try {
    if (request.kind === 'file') {
      const filePath = request.paths[0]
      if (!filePath) return
      await workspaceStore.discardFile(filePath)
      if (selectedPath.value === filePath) selectedPath.value = null
    } else {
      await discardSelectedPaths(request.paths)
    }
  } catch {
    // IPC 错误由 errors store 统一映射并通过 ToolbarToast 展示。
  } finally {
    workspaceDiscardLoading.value = false
    pendingWorkspaceDiscard.value = null
  }
}

function cancelWorkspaceDiscard() {
  if (workspaceDiscardLoading.value) return
  pendingWorkspaceDiscard.value = null
}

async function batchStage() {
  await stageSelected()
}

async function batchUnstage() {
  await unstageSelected()
}

function batchDiscard() {
  requestWorkspaceDiscard('selected', orderedBatchPaths('unstaged'))
}

function orderedBatchPaths(source: 'unstaged' | 'staged'): string[] {
  const selected = new Set(source === 'unstaged' ? unstagedMultiPaths.value : stagedMultiPaths.value)
  const files = source === 'unstaged' ? unstagedAll.value : stagedAll.value
  return files.filter((file) => selected.has(file.path)).map((file) => file.path)
}

function moveFileOrder(paths: readonly string[], placement: FileOrderPlacement) {
  uiStore.moveChangedFilesForRepo(activeRepoPath.value, paths, placement)
}

async function onUnstageAll() {
  await unstageAll()
}

const {
  batchMenu,
  batchMenuItems,
  fileMenu,
  fileMenuItems,
  openFileContextMenu,
  handleBatchMenuAction,
  handleFileMenuAction,
} = useWipMenus({
  t,
  git,
  mergeRebaseStore,
  repoStore,
  settingsStore,
  workspaceStore,
  submodules: computed(() => submodulesStore.submodules),
  viewMode,
  selectedPath,
  unstagedMultiPaths,
  stagedMultiPaths,
  toggleFile,
  batchStage,
  batchUnstage,
  batchDiscard,
  orderedBatchPaths,
  moveFileOrder,
  requestDiscardFile,
  openSubmodule: openSubmoduleFromWip,
  initSubmodule: initSubmoduleFromWip,
  updateSubmodule: updateSubmoduleFromWip,
  showFileHistory: (payload) => emit('showFileHistory', payload),
})

function onFileContext(e: MouseEvent, payload: ContextMenuPayload) {
  openFileContextMenu(e, payload)
}

async function onBatchMenuAction(action: string) {
  await handleBatchMenuAction(action)
}

async function onFileMenuAction(action: string) {
  await handleFileMenuAction(action)
}

// ── 丢弃全部变更（trash 按钮） ─────────────────────────────────────
const discardConfirmOpen = ref(false)
const discardAllLoading = ref(false)
const discardAllRepoId = ref<string | null>(null)
const discardAllHead = ref<string | undefined>()
const discardAllPaths = ref<string[]>([])
const discardAllCounts = ref({ staged: 0, unstaged: 0, untracked: 0 })

function openDiscardAllConfirmation() {
  const repoId = repoStore.activeRepoId
  const status = workspaceStore.status
  if (!repoId || !status || totalCount.value === 0) return
  discardAllRepoId.value = repoId
  discardAllHead.value = status.head_commit
  discardAllPaths.value = Array.from(new Set(
    [...status.staged, ...status.unstaged, ...status.untracked].map((file) => file.path),
  ))
  discardAllCounts.value = {
    staged: status.staged.length,
    unstaged: status.unstaged.length,
    untracked: status.untracked.length,
  }
  discardConfirmOpen.value = true
}

function onTrashClick() {
  openDiscardAllConfirmation()
}

async function onConfirmDiscardAll() {
  const repoId = discardAllRepoId.value
  if (!repoId || discardAllLoading.value) return
  if (repoStore.activeRepoId !== repoId) {
    cancelDiscardAll()
    showError(t('workspace.confirmDiscard.contextChanged'))
    return
  }

  discardAllLoading.value = true
  try {
    await workspaceStore.discardAll(repoId, discardAllHead.value, discardAllPaths.value)
    selectedPath.value = null
  } catch {
    // IPC 错误由 errors store 统一映射并通过 ToolbarToast 展示。
  } finally {
    discardAllLoading.value = false
    discardConfirmOpen.value = false
    discardAllRepoId.value = null
    discardAllHead.value = undefined
    discardAllPaths.value = []
    discardAllCounts.value = { staged: 0, unstaged: 0, untracked: 0 }
  }
}

function cancelDiscardAll() {
  if (discardAllLoading.value) return
  discardConfirmOpen.value = false
  discardAllRepoId.value = null
  discardAllHead.value = undefined
  discardAllPaths.value = []
  discardAllCounts.value = { staged: 0, unstaged: 0, untracked: 0 }
}

// 响应外部（AppToolbar Actions / 其他调用方）对"丢弃全部"的粘性请求
function checkDiscardAllRequest() {
  if (uiStore.shouldOpenDiscardAll && totalCount.value > 0) {
    openDiscardAllConfirmation()
    uiStore.consumeDiscardAllRequest()
  } else if (uiStore.shouldOpenDiscardAll) {
    // 没有可丢弃的变更也要消费标志，避免悬空
    uiStore.consumeDiscardAllRequest()
  }
}
onMounted(() => {
  checkDiscardAllRequest()
  // 首次进入 WIP：若尚未选中任何文件，自动选中第一个
  // （顺序：未暂存 + 未跟踪 → 已暂存，与视觉列表一致）
  if (!selectedPath.value && allFiles.value.length > 0) {
    const first = allFiles.value[0]
    selectedPath.value = first.path
    diffStore.loadFileDiff(first.path, first.staged)
  } else if (selectedPath.value) {
    // 切换仓库后恢复：selectedPath 已由 App.vue 恢复，重新加载对应 diff
    const file = findWipFileBySelection(allFiles.value, selectedPath.value, diffStore.currentStaged)
    if (file) diffStore.loadFileDiff(file.path, file.staged)
  }
})
watch(() => uiStore.shouldOpenDiscardAll, checkDiscardAllRequest)

// ── 未暂存/已暂存分割线拖拽 ────────────────────────────────────────
const WIP_SPLIT_KEY = 'wip-split-pct'
const splitPct = ref(parseFloat(localStorage.getItem(WIP_SPLIT_KEY) || '50'))

function startSplitResize(e: PointerEvent) {
  e.preventDefault()
  const container = panelListsRef.value
  if (!container) return
  const startY = e.clientY
  const startH = container.getBoundingClientRect().height
  const startPct = splitPct.value

  const onMove = (ev: PointerEvent) => {
    const delta = ev.clientY - startY
    const next = startPct + (delta / startH) * 100
    splitPct.value = Math.max(15, Math.min(85, next))
  }
  const onUp = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    localStorage.setItem(WIP_SPLIT_KEY, String(splitPct.value))
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  document.body.style.cursor = 'row-resize'
  document.body.style.userSelect = 'none'
}

// ── 键盘上下键导航 ──────────────────────────────────────────────
function onListKeydown(e: KeyboardEvent) {
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
  e.preventDefault()
  e.stopPropagation()

  const list = allFiles.value
  if (list.length === 0) return

  const currentIdx = findSelectedWipIndex(list, selectedPath.value, diffStore.currentStaged)

  let nextIdx: number
  if (e.key === 'ArrowDown') {
    nextIdx = currentIdx < 0 ? 0 : Math.min(currentIdx + 1, list.length - 1)
  } else {
    nextIdx = currentIdx < 0 ? 0 : Math.max(currentIdx - 1, 0)
  }

  const next = list[nextIdx]
  selectedPath.value = next.path
  diffStore.loadFileDiff(next.path, next.staged)

  // 滚动选中项到可视区域
  const unstagedLen = unstagedAll.value.length
  if (nextIdx < unstagedLen) {
    unstagedListRef.value?.scrollToIndex(nextIdx)
  } else {
    stagedListRef.value?.scrollToIndex(nextIdx - unstagedLen)
  }
}

// ── 工作区刷新时清理失效的 selectedPath ─────────────────────────
watch(
  () => workspaceStore.status,
  (s) => {
    if (!selectedPath.value || !s) return
    const allPaths = [...s.staged, ...s.unstaged, ...s.untracked].map((f) => f.path)
    if (!allPaths.includes(selectedPath.value)) {
      selectedPath.value = null
    }
  },
)
</script>

<template>
  <div class="wip-panel">
    <!-- Header -->
    <div class="panel-header">
      <button
        class="btn-trash"
        :disabled="totalCount === 0"
        :title="t('workspace.wip.discardAllTitle')"
        @click="onTrashClick"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
        </svg>
      </button>
      <span class="header-title">
        {{ t('workspace.wip.headerTitle', { count: totalCount }) }}
        <span class="header-branch">{{ t('workspace.wip.onBranch', { branch: branchLabel }) }}</span>
      </span>
      <div class="header-actions">
        <button
          v-if="viewMode === 'tree'"
          class="btn-icon"
          :title="isAllExpanded ? t('workspace.wip.collapseAllTitle', 'Collapse All') : t('workspace.wip.expandAllTitle', 'Expand All')"
          @click="toggleExpandCollapseAll"
        >
          <svg v-if="isAllExpanded" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="17 11 12 6 7 11"></polyline>
            <polyline points="17 18 12 13 7 18"></polyline>
          </svg>
          <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="7 13 12 18 17 13"></polyline>
            <polyline points="7 6 12 11 17 6"></polyline>
          </svg>
        </button>
        <button
          class="btn-icon"
          :class="{ active: viewMode === 'tree' }"
          title="Toggle Tree View"
          @click="toggleViewMode"
        >
          <svg v-if="viewMode === 'list'" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="3" y1="6" x2="21" y2="6"/>
            <line x1="3" y1="12" x2="21" y2="12"/>
            <line x1="3" y1="18" x2="21" y2="18"/>
          </svg>
          <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="21" y1="10" x2="10" y2="10" />
            <line x1="21" y1="6" x2="10" y2="6" />
            <line x1="21" y1="14" x2="10" y2="14" />
            <line x1="21" y1="18" x2="10" y2="18" />
            <path d="M3 6l3 3-3 3" />
          </svg>
        </button>
      </div>
    </div>

    <!-- 文件列表区 -->
    <div ref="panelListsRef" class="panel-lists" tabindex="-1" @keydown="onListKeydown">
      <div class="split-top" :style="{ flex: `${splitPct} 0 0%` }">
        <FileChangeList
          ref="unstagedListRef"
          :files="unstagedAll"
          :title="t('workspace.wip.section.unstaged')"
          :empty-text="t('workspace.wip.empty.unstaged')"
          :show-row-actions="true"
          :selected-path="selectedPath"
          :selected-staged="diffStore.currentStaged"
          variant="unstaged"
          :view-mode="viewMode"
          :submodule-paths="submodulePaths"
          @select="onSelectFile"
          @open="onOpenFileInEditor"
          @toggle="onToggleFile"
          @context-menu="onFileContext"
          @multi-select-change="onUnstagedMultiSelect"
        >
          <template #header-actions>
            <template v-if="unstagedMultiPaths.length > 1">
              <button class="btn-section" @click="batchStage">
                {{ t('workspace.wip.stageSelected', { count: unstagedMultiPaths.length }) }}
              </button>
              <button class="btn-section btn-section--danger" @click="batchDiscard">
                {{ t('workspace.wip.discardSelected', { count: unstagedMultiPaths.length }) }}
              </button>
            </template>
            <button
              v-else-if="unstagedAll.length > 0"
              class="btn-section"
              @click="onStageAll"
            >
              {{ t('workspace.wip.stageAll') }}
            </button>
          </template>
        </FileChangeList>
      </div>

      <div class="split-resize" @pointerdown="startSplitResize" />

      <div class="split-bottom" :style="{ flex: `${100 - splitPct} 0 0%` }">
        <FileChangeList
          ref="stagedListRef"
          :files="stagedAll"
          :title="t('workspace.wip.section.staged')"
          :empty-text="t('workspace.wip.empty.staged')"
          :show-row-actions="true"
          :selected-path="selectedPath"
          :selected-staged="diffStore.currentStaged"
          variant="staged"
          :view-mode="viewMode"
          :submodule-paths="submodulePaths"
          @select="onSelectFile"
          @open="onOpenFileInEditor"
          @toggle="onToggleFile"
          @context-menu="onFileContext"
          @multi-select-change="onStagedMultiSelect"
        >
          <template #header-actions>
            <button
              v-if="stagedMultiPaths.length > 1"
              class="btn-section"
              @click="batchUnstage"
            >
              {{ t('workspace.wip.unstageSelected', { count: stagedMultiPaths.length }) }}
            </button>
            <button
              v-else-if="stagedAll.length > 0"
              class="btn-section"
              @click="onUnstageAll"
            >
              {{ t('workspace.wip.unstageAll') }}
            </button>
          </template>
        </FileChangeList>
      </div>
    </div>

    <WipCommitBox
      :is-unborn="isUnborn"
      :staged-count="stagedAll.length"
      :operation-in-progress="mergeRebaseStore.isOngoing"
    />

    <WorkspaceDiscardDialog
      :request="pendingWorkspaceDiscard"
      :loading="workspaceDiscardLoading"
      @confirm="confirmWorkspaceDiscard"
      @cancel="cancelWorkspaceDiscard"
    />

    <!-- 丢弃全部变更确认框 -->
    <Modal
      :visible="discardConfirmOpen"
      :title="t('workspace.confirmDiscard.allTitle')"
      width="400px"
      @close="cancelDiscardAll"
    >
      <div class="discard-body">
        <p>{{ t('workspace.confirmDiscard.intro') }}</p>
        <ul>
          <li>{{ t('workspace.confirmDiscard.unstagedCount', { count: discardAllCounts.unstaged }) }}</li>
          <li>{{ t('workspace.confirmDiscard.untrackedCount', { count: discardAllCounts.untracked }) }}</li>
          <li>{{ t('workspace.confirmDiscard.stagedCount', { count: discardAllCounts.staged }) }}</li>
        </ul>
        <p class="warn">
          {{ t('workspace.confirmDiscard.warnTrash') }}
          <code>.gitignore</code>
          {{ t('workspace.confirmDiscard.warnIgnored') }}
        </p>
      </div>
      <template #footer>
        <button class="btn btn-secondary" :disabled="discardAllLoading" @click="cancelDiscardAll">
          {{ t('common.cancel') }}
        </button>
        <button class="btn btn-danger" :disabled="discardAllLoading" @click="onConfirmDiscardAll">
          {{ discardAllLoading ? t('workspace.confirmDiscard.runningAll') : t('workspace.confirmDiscard.confirmAll') }}
        </button>
      </template>
    </Modal>

    <!-- 文件右键菜单 -->
    <ContextMenu
      :visible="fileMenu.visible"
      :x="fileMenu.x"
      :y="fileMenu.y"
      :items="fileMenuItems"
      @close="fileMenu.visible = false"
      @select="onFileMenuAction"
    />

    <!-- 多选批量右键菜单 -->
    <ContextMenu
      :visible="batchMenu.visible"
      :x="batchMenu.x"
      :y="batchMenu.y"
      :items="batchMenuItems"
      @close="batchMenu.visible = false"
      @select="onBatchMenuAction"
    />
  </div>
</template>

<style scoped>
.wip-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.panel-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 1px 4px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  white-space: nowrap;
  overflow: hidden;
  height: 18px;
}

.btn-trash, .btn-icon {
  background: none;
  border: 1px solid var(--border);
  border-radius: 3px;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 0 3px;
  display: flex;
  align-items: center;
  transition: background 0.15s, border-color 0.15s;
  line-height: 1;
}

.btn-icon:hover {
  background: var(--bg-overlay);
  color: var(--text-primary);
}

.btn-icon.active {
  background: var(--bg-surface);
  color: var(--accent-blue);
  border-color: var(--accent-blue);
}

.btn-trash {
  color: var(--accent-red);
}

.btn-trash:hover:not(:disabled) {
  background: rgba(237, 135, 150, 0.15);
  border-color: var(--accent-red);
}

.btn-trash:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.header-title {
  font-size: var(--font-xs);
  color: var(--text-primary);
  font-weight: 500;
  flex: 1;
}

.header-actions {
  display: flex;
  gap: 4px;
}

.header-branch {
  color: var(--text-muted);
  font-weight: 400;
  margin-left: 2px;
}

.panel-lists {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  outline: none;
}

.split-top,
.split-bottom {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.split-resize {
  height: 4px;
  flex-shrink: 0;
  cursor: row-resize;
  background: transparent;
  border-top: 1px solid var(--border);
  position: relative;
  z-index: 1;
  transition: background 0.15s;
}

.split-resize:hover,
.split-resize:active {
  background: rgba(138, 173, 244, 0.3);
}

.btn-section {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 3px;
  color: var(--text-secondary);
  cursor: pointer;
  font-family: inherit;
  font-size: var(--font-xs);
  padding: 0 5px;
  line-height: 14px;
  transition: background 0.1s, color 0.1s, border-color 0.1s;
}

.btn-section:hover {
  background: var(--accent-blue);
  color: var(--bg-primary);
  border-color: var(--accent-blue);
}

.btn-section--danger:hover {
  background: var(--accent-red);
  border-color: var(--accent-red);
}

.discard-body {
  font-size: var(--font-md);
  color: var(--text-secondary);
  line-height: 1.6;
}

.discard-body ul {
  margin: 8px 0;
  padding-left: 18px;
}

.discard-body .warn {
  margin-top: 10px;
  color: var(--accent-orange);
}

.discard-body code {
  background: var(--bg-overlay);
  padding: 0 4px;
  border-radius: 3px;
  font-family: Menlo, 'SF Mono', monospace;
  font-size: var(--font-sm);
}

</style>
