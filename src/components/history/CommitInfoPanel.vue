<script setup lang="ts">
import { computed, reactive, ref, watch, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useVirtualizer } from '@tanstack/vue-virtual'
import type { CommitDetail, FileDiff, FileStatusKind } from '@/types/git'
import { formatAbsoluteTime, fileStatusColor } from '@/utils/format'
import { GRAPH_COLORS } from '@/utils/graph'
import { useUiStore } from '@/stores/ui'
import { useRepoStore } from '@/stores/repos'
import { useWorkspaceStore } from '@/stores/workspace'
import { useGitCommands } from '@/composables/useGitCommands'
import { useHistoryStore } from '@/stores/history'
import ContextMenu, { type ContextMenuItem } from '@/components/common/ContextMenu.vue'
import { buildFileTree, flattenTree } from '@/utils/fileTree'

const { t } = useI18n()
const historyStore = useHistoryStore()
const uiStore = useUiStore()

const props = defineProps<{
  commit: CommitDetail | null
  selectedFileIdx: number
}>()

const emit = defineEmits<{
  selectFile: [idx: number]
  showFileHistory: [payload: { filePath: string; mode: 'history' | 'blame' }]
}>()

const repoStore = useRepoStore()
const workspaceStore = useWorkspaceStore()
const git = useGitCommands()
const sizes = uiStore.historyPaneSizes

const filesFirst = computed(() => uiStore.detailFilesFirst)

const statusIconMap: Record<FileStatusKind, { d: string; stroke?: boolean }> = {
  modified: { d: 'M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z' },
  added: { d: 'M12 5v14M5 12h14' },
  deleted: { d: 'M5 12h14' },
  renamed: { d: 'M5 12h7M12 12l-4-4M12 12l-4 4M19 12h-7M12 12l4-4M12 12l4 4' },
  untracked: { d: 'M12 5v14M5 12h14', stroke: true },
  conflicted: { d: 'M18 6L6 18M6 6l12 12' },
}

function diffStatus(d: FileDiff): FileStatusKind {
  if (!d.old_blob_oid) return 'added'
  if (!d.new_blob_oid) return 'deleted'
  if (d.old_path !== d.new_path) return 'renamed'
  return 'modified'
}

// ── 头部区（summary + meta-grid）和变动文件列表之间的可拖拽分隔条 ──
const panelRoot = ref<HTMLElement | null>(null)
const topSection = ref<HTMLElement | null>(null)

const topSectionStyle = computed(() => {
  return sizes.commitInfoTopH > 0
    ? { height: sizes.commitInfoTopH + 'px' }
    : { maxHeight: '65%' }
})

function startTopResize(e: PointerEvent) {
  e.preventDefault()
  const topEl = topSection.value
  const rootEl = panelRoot.value
  if (!topEl || !rootEl) return
  const startY = e.clientY
  const startH = topEl.getBoundingClientRect().height
  const rootH = rootEl.getBoundingClientRect().height
  const maxH = Math.max(80, rootH - 80)
  const dir = filesFirst.value ? -1 : 1
  const onMove = (ev: PointerEvent) => {
    const next = startH + dir * (ev.clientY - startY)
    sizes.commitInfoTopH = Math.max(60, Math.min(maxH, next))
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
  document.body.style.cursor = 'row-resize'
  document.body.style.userSelect = 'none'
}

const initials = computed(() => {
  const name = props.commit?.info.author_name ?? ''
  return name
    .split(/\s+/)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .slice(0, 2)
    .join('')
})

const avatarColor = computed(() => {
  const name = props.commit?.info.author_name ?? ''
  let hash = 0
  for (const c of name) hash = ((hash * 31) + c.charCodeAt(0)) & 0x7fffffff
  return GRAPH_COLORS[hash % GRAPH_COLORS.length]
})

const bodyText = computed(() => {
  const msg = props.commit?.info.message ?? ''
  const firstLine = msg.indexOf('\n')
  return firstLine !== -1 ? msg.slice(firstLine + 1).trim() : ''
})

// ── 视图模式与文件树 ──────────────────────────────────────────────
const HISTORY_VIEW_MODE_KEY = 'history-view-mode'
const viewMode = ref<'list' | 'tree'>((localStorage.getItem(HISTORY_VIEW_MODE_KEY) as 'list' | 'tree') || 'list')

function toggleViewMode() {
  viewMode.value = viewMode.value === 'list' ? 'tree' : 'list'
  localStorage.setItem(HISTORY_VIEW_MODE_KEY, viewMode.value)
}

const isAllExpanded = ref(false)
const expandedDirs = ref(new Set<string>())

function toggleExpandCollapseAll() {
  isAllExpanded.value = !isAllExpanded.value
  if (isAllExpanded.value) {
    const tree = buildFileTree(props.commit?.diffs ?? [], d => d.new_path ?? d.old_path ?? '')
    const stack = [...tree]
    while (stack.length > 0) {
      const node = stack.pop()!
      if (node.isDir) {
        expandedDirs.value.add(node.path)
        stack.push(...node.children)
      }
    }
  } else {
    expandedDirs.value.clear()
  }
}

watch(() => viewMode.value, (mode) => {
  if (mode === 'tree' && expandedDirs.value.size === 0) {
    const tree = buildFileTree(props.commit?.diffs ?? [], d => d.new_path ?? d.old_path ?? '')
    tree.forEach(n => {
      if (n.isDir) expandedDirs.value.add(n.path)
    })
  }
})

watch(() => props.commit?.info.oid, () => {
  if (viewMode.value === 'tree') {
    expandedDirs.value.clear()
    const tree = buildFileTree(props.commit?.diffs ?? [], d => d.new_path ?? d.old_path ?? '')
    tree.forEach(n => {
      if (n.isDir) expandedDirs.value.add(n.path)
    })
    isAllExpanded.value = false
  }
})

type DisplayItem =
  | { type: 'file'; path: string; file: FileDiff; depth: number; index: number }
  | { type: 'dir'; path: string; name: string; depth: number; expanded: boolean }

const displayItems = computed<DisplayItem[]>(() => {
  const diffs = props.commit?.diffs ?? []
  if (viewMode.value === 'tree') {
    const tree = buildFileTree(diffs, d => d.new_path ?? d.old_path ?? '')
    const flat = flattenTree(tree, expandedDirs.value)
    return flat.map(node => {
      if (node.isDir) {
        return { type: 'dir', path: node.path, name: node.name, depth: node.depth, expanded: expandedDirs.value.has(node.path) }
      } else {
        const idx = diffs.findIndex(d => (d.new_path ?? d.old_path ?? '') === node.path)
        return { type: 'file', path: node.path, file: node.file!, depth: node.depth, index: idx }
      }
    })
  }
  return diffs.map((d, i) => ({ type: 'file', path: d.new_path ?? d.old_path ?? '', file: d, depth: 0, index: i }))
})

// ── 虚拟滚动 ──────────────────────────────────────────────────
const scrollContainer = ref<HTMLElement | null>(null)
const rowHeight = 24 // 对应 var(--file-list-row-height)

const virtualizer = useVirtualizer(
  computed(() => ({
    count: displayItems.value.length,
    getScrollElement: () => scrollContainer.value,
    estimateSize: () => rowHeight,
    overscan: 10,
  }))
)

function onRowClick(item: DisplayItem) {
  if (item.type === 'dir') {
    if (expandedDirs.value.has(item.path)) {
      expandedDirs.value.delete(item.path)
    } else {
      expandedDirs.value.add(item.path)
    }
  } else {
    emit('selectFile', item.index)
  }
}

function onRowContext(e: MouseEvent, item: DisplayItem) {
  if (item.type === 'dir') return
  onFileTabContext(e, item.index)
}

function getFile(item: DisplayItem): FileDiff {
  return (item as any).file
}

function getDir(item: DisplayItem): { name: string; expanded: boolean } {
  return item as any
}

// ── 文件右键菜单 ─────────────────────────────────────────────────
const fileMenu = reactive({
  visible: false,
  x: 0,
  y: 0,
  diffIdx: -1,
})

const fileMenuItems = computed<ContextMenuItem[]>(() => {
  const d = props.commit?.diffs[fileMenu.diffIdx]
  if (!d) return []
  const filePath = d.new_path ?? d.old_path ?? ''
  const isDeleted = !d.new_blob_oid && !!d.old_blob_oid
  return [
    { label: t('history.fileMenu.copyName'), action: 'copy-name' },
    { label: t('history.fileMenu.copyRelativePath'), action: 'copy-relative' },
    { label: t('history.fileMenu.copyAbsolutePath'), action: 'copy-absolute' },
    { separator: true },
    { label: t('history.fileMenu.revealInFinder'), action: 'reveal', disabled: isDeleted },
    { label: t('history.fileMenu.openInEditor'), action: 'open-editor', disabled: isDeleted },
    { separator: true },
    { label: t('history.fileMenu.checkoutFileVersion'), action: 'checkout-file', disabled: isDeleted },
    { separator: true },
    { label: t('fileHistory.menu.history'), action: 'file-history' },
    { label: t('fileHistory.menu.blame'), action: 'file-blame', disabled: isDeleted },
  ]
})

function onFileTabContext(e: MouseEvent, idx: number) {
  e.preventDefault()
  fileMenu.diffIdx = idx
  fileMenu.x = e.clientX
  fileMenu.y = e.clientY
  fileMenu.visible = true
}

async function onFileMenuAction(action: string) {
  const d = props.commit?.diffs[fileMenu.diffIdx]
  if (!d) return
  fileMenu.visible = false

  const filePath = d.new_path ?? d.old_path ?? ''
  const repoPath = repoStore.activeRepo()?.path ?? ''
  const absPath = repoPath ? `${repoPath}/${filePath}` : filePath

  try {
    if (action === 'copy-name') {
      await navigator.clipboard.writeText(filePath.split('/').pop() ?? filePath)
    } else if (action === 'copy-relative') {
      await navigator.clipboard.writeText(filePath)
    } else if (action === 'copy-absolute') {
      await navigator.clipboard.writeText(absPath)
    } else if (action === 'reveal') {
      await git.revealFile(absPath)
    } else if (action === 'open-editor') {
      await git.openFileInEditor(absPath)
    } else if (action === 'checkout-file') {
      const repoId = repoStore.activeRepoId
      const sha = props.commit?.info.oid
      if (repoId && sha) {
        await git.checkoutFileAtCommit(repoId, sha, filePath)
        await workspaceStore.refresh(repoId)
      }
    } else if (action === 'file-history') {
      emit('showFileHistory', { filePath, mode: 'history' })
    } else if (action === 'file-blame') {
      emit('showFileHistory', { filePath, mode: 'blame' })
    }
  } catch (e) {
    alert(String(e))
  }
}
</script>

<template>
  <div class="commit-info-panel" v-if="commit" ref="panelRoot">
    <!-- 上半区：头部 + 元数据 -->
    <div
      class="top-section"
      ref="topSection"
      :style="[topSectionStyle, filesFirst ? { order: 2 } : {}]"
    >
      <div class="panel-header">
        <div class="avatar" :style="{ background: avatarColor }">{{ initials }}</div>
        <div class="title-block">
          <div class="commit-summary">{{ commit.info.summary }}</div>
          <div class="commit-body" v-if="bodyText">{{ bodyText }}</div>
        </div>
      </div>

      <div class="meta-grid">
        <span class="mk">{{ t('history.detailsPanel.commit') }}</span>
        <span class="mv oid">{{ commit.info.oid.slice(0, 16) }}</span>

        <span class="mk">{{ t('history.detailsPanel.author') }}</span>
        <span class="mv">{{ commit.info.author_name }}</span>

        <span class="mk">{{ t('history.detailsPanel.date') }}</span>
        <span class="mv">{{ formatAbsoluteTime(commit.info.time) }}</span>

        <span class="mk">{{ t('history.detailsPanel.email') }}</span>
        <span class="mv dim">{{ commit.info.author_email }}</span>

        <template v-if="commit.info.parent_oids.length">
          <span class="mk">{{ t('history.detailsPanel.parents') }}</span>
          <span class="mv">
            <span
              v-for="p in commit.info.parent_oids"
              :key="p"
              class="parent-chip"
            >{{ p.slice(0, 7) }}</span>
          </span>
        </template>
      </div>
    </div>

    <div
      v-if="commit.diffs.length || historyStore.loadingDetail"
      class="top-resize"
      :style="filesFirst ? { order: 1 } : {}"
      @pointerdown="startTopResize"
    />

    <!-- Changed files tab strip -->
    <div
      class="file-tabs-container"
      :style="filesFirst ? { order: 0 } : {}"
      v-if="commit.diffs.length || historyStore.loadingDetail"
    >
      <div class="file-tabs-header">
        <span class="file-tabs-title">{{ t('history.detailsPanel.changedFiles', { count: commit.diffs.length }) }}</span>
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

      <!-- 虚拟滚动列表 -->
      <div class="file-tabs" ref="scrollContainer">
        <div v-if="historyStore.loadingDetail && !commit.diffs.length" class="file-list-loading">
          <span class="loading-spinner" />
          {{ t('history.loading') }}
        </div>
        
        <div
          v-else
          :style="{ height: virtualizer.getTotalSize() + 'px', width: '100%', position: 'relative' }"
        >
          <div
            v-for="vRow in virtualizer.getVirtualItems()"
            :key="vRow.index"
            class="file-tab"
            :class="{ 
              active: displayItems[vRow.index].type === 'file' && displayItems[vRow.index].index === selectedFileIdx, 
              'is-dir': displayItems[vRow.index].type === 'dir' 
            }"
            :style="{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: rowHeight + 'px',
              transform: `translateY(${vRow.start}px)`
            }"
            @click="onRowClick(displayItems[vRow.index])"
            @contextmenu="onRowContext($event, displayItems[vRow.index])"
            :title="displayItems[vRow.index].path"
          >
            <!-- Indent for tree view -->
            <div v-if="viewMode === 'tree' && displayItems[vRow.index].depth > 0" :style="{ width: (displayItems[vRow.index].depth * 14) + 'px' }" class="tree-indent" />

            <!-- Directory Item -->
            <template v-if="displayItems[vRow.index].type === 'dir'">
              <svg
                class="folder-icon"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                :style="{ transform: getDir(displayItems[vRow.index]).expanded ? 'rotate(90deg)' : 'rotate(0deg)' }"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
              <span class="file-name"><span class="path-text"><bdi>{{ getDir(displayItems[vRow.index]).name }}</bdi></span></span>
            </template>

            <!-- File Item -->
            <template v-else>
              <svg
                class="status-icon"
                :style="{ color: fileStatusColor(diffStatus(getFile(displayItems[vRow.index]))) }"
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path :d="statusIconMap[diffStatus(getFile(displayItems[vRow.index]))]?.d ?? statusIconMap.modified.d" />
              </svg>
              <span class="file-name"><span class="path-text"><bdi>{{ viewMode === 'tree' ? (displayItems[vRow.index].path.split('/').pop() || displayItems[vRow.index].path) : displayItems[vRow.index].path }}</bdi></span></span>
              <span class="file-stats">
                <span class="add" v-if="getFile(displayItems[vRow.index]).additions > 0">+{{ getFile(displayItems[vRow.index]).additions }}</span>
                <span class="del" v-if="getFile(displayItems[vRow.index]).deletions > 0">-{{ getFile(displayItems[vRow.index]).deletions }}</span>
              </span>
            </template>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div v-else class="panel-empty">{{ t('history.detailsPanel.empty') }}</div>

  <ContextMenu
    :visible="fileMenu.visible"
    :x="fileMenu.x"
    :y="fileMenu.y"
    :items="fileMenuItems"
    @close="fileMenu.visible = false"
    @select="onFileMenuAction"
  />
</template>

<style scoped>
.commit-info-panel {
  display: flex;
  flex-direction: column;
  background: var(--bg-secondary);
  border-top: 1px solid var(--border);
  overflow: hidden;
  height: 100%;
}

/* 头部 + 元数据组合区：默认内容自适应高度，拖拽后变成固定像素高度 */
.top-section {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  overflow-y: auto;
  min-height: 0;
}

.panel-header {
  display: flex;
  gap: 10px;
  padding: 10px 12px 8px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  min-height: 0;
}

/* 盖过全局 * { user-select: none }：通配符直接给每个子元素设 none，
   单独给父元素设 text 不会继承，需要连子孙一起覆写。 */
.panel-header,
.panel-header *,
.meta-grid,
.meta-grid * {
  user-select: text;
  -webkit-user-select: text;
}

.avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--font-base);
  font-weight: 700;
  color: var(--bg-primary);
  flex-shrink: 0;
}

.title-block {
  flex: 1;
  min-width: 0;
}

.commit-summary {
  font-size: var(--font-base);
  font-weight: 600;
  color: var(--text-primary);
  /* 超长标题改为水平滚动而非截断 */
  white-space: nowrap;
  overflow-x: auto;
  overflow-y: hidden;
}

.commit-body {
  font-size: var(--font-sm);
  color: var(--text-secondary);
  margin-top: 3px;
  /* 保留原始换行；长行自动折行；不独立滚动，由 top-section 统一处理 */
  white-space: pre-wrap;
  word-break: break-word;
  overflow: visible;
}

/* 隐藏滚动条（内容仍可滚动，但不显示指示条） */
.commit-summary,
.mv {
  scrollbar-width: none;
}
.commit-summary::-webkit-scrollbar,
.mv::-webkit-scrollbar {
  display: none;
}

.meta-grid {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr);
  gap: 2px 8px;
  padding: 6px 12px;
  font-size: var(--font-sm);
  flex-shrink: 0;
}

/* top-section 与 file-tabs 之间的可拖拽分隔条 */
.top-resize {
  flex-shrink: 0;
  height: 4px;
  cursor: row-resize;
  background: transparent;
  border-top: 1px solid var(--border);
  position: relative;
  z-index: 2;
}
.top-resize:hover,
.top-resize:active {
  background: rgba(138, 173, 244, 0.15);
}

.mk {
  color: var(--text-muted);
  text-align: right;
  align-self: center;
  white-space: nowrap;
}

.mv {
  color: var(--text-primary);
  white-space: nowrap;
  overflow-x: auto;
  overflow-y: hidden;
  align-self: center;
  /* 最小高度保持行对齐，避免滚动条把行撑高 */
  min-width: 0;
}

.mv.oid {
  font-family: Menlo, 'SF Mono', monospace;
  font-size: var(--font-xs);
  color: var(--accent-blue);
}

.mv.dim {
  color: var(--text-secondary);
}

.parent-chip {
  display: inline-block;
  background: var(--bg-overlay);
  border-radius: 3px;
  padding: 1px 5px;
  font-family: Menlo, 'SF Mono', monospace;
  font-size: var(--font-xs);
  color: var(--accent-blue);
  margin-right: 4px;
  cursor: pointer;
}

.file-tabs-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.file-tabs-header {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 6px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  user-select: none;
}

.file-tabs-title {
  font-size: var(--font-xs);
  color: var(--text-muted);
  flex: 1;
}

.header-actions {
  display: flex;
  gap: 4px;
}

.btn-icon {
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

.file-tabs {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  padding: 4px 0;
}

.file-list-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 20px;
  color: var(--text-muted);
  font-size: var(--font-sm);
}

.file-tab {
  display: flex;
  align-items: center;
  padding: 2px 3px;
  height: var(--file-list-row-height);
  cursor: pointer;
  font-size: var(--font-sm);
  transition: background 0.1s;
  gap: 4px;
}

.file-tab .status-icon,
.file-tab .folder-icon {
  flex-shrink: 0;
}

.folder-icon {
  color: var(--text-secondary);
  transition: transform 0.1s;
}

.tree-indent {
  flex-shrink: 0;
}

.file-tab:hover {
  background: var(--bg-overlay);
}

.file-tab.active {
  background: var(--row-selected-bg);
  border-left: 2px solid var(--accent-blue);
  color: var(--row-selected-fg);
}

.file-tab.is-dir {
  font-weight: 500;
  color: var(--text-primary);
}

.file-name {
  color: var(--text-secondary);
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.path-text {
  display: inline-block;
  vertical-align: middle;
  max-width: 100%;
  direction: rtl;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-tab.active .file-name {
  color: var(--row-selected-fg);
}

.file-tab.active .add,
.file-tab.active .del {
  color: var(--row-selected-fg);
}

.file-stats {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
  margin-left: 8px;
}

.add { color: var(--accent-green); }
.del { color: var(--accent-red); }

.panel-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-muted);
  font-size: var(--font-md);
  background: var(--bg-secondary);
  border-top: 1px solid var(--border);
}
</style>
