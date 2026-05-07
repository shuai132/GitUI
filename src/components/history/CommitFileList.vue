<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useVirtualizer } from '@tanstack/vue-virtual'
import type { FileDiff, FileStatusKind } from '@/types/git'
import { fileStatusColor } from '@/utils/format'
import { useSettingsStore } from '@/stores/settings'
import {
  commitFileStatus,
  useCommitFileItems,
  type CommitFileDisplayItem,
} from '@/composables/history/useCommitFileItems'

const { t } = useI18n()
const settings = useSettingsStore()

const props = withDefaults(defineProps<{
  diffs: FileDiff[]
  selectedFileIdx: number
  loading?: boolean
  commitOid?: string
  submodulePaths?: string[]
}>(), {
  loading: false,
  commitOid: undefined,
  submodulePaths: () => [],
})

const emit = defineEmits<{
  selectFile: [idx: number]
  fileContextMenu: [event: MouseEvent, idx: number]
}>()

const diffsRef = computed(() => props.diffs)
const commitOidRef = computed(() => props.commitOid)

const {
  viewMode,
  isAllExpanded,
  displayItems,
  expandedDirs,
  toggleViewMode,
  toggleExpandCollapseAll,
  toggleDir,
} = useCommitFileItems(diffsRef, commitOidRef)

const statusIconMap: Record<FileStatusKind, { d: string; stroke?: boolean }> = {
  modified: { d: 'M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z' },
  added: { d: 'M12 5v14M5 12h14' },
  deleted: { d: 'M5 12h14' },
  renamed: { d: 'M5 12h7M12 12l-4-4M12 12l-4 4M19 12h-7M12 12l4-4M12 12l4 4' },
  untracked: { d: 'M12 5v14M5 12h14', stroke: true },
  conflicted: { d: 'M18 6L6 18M6 6l12 12' },
}

const scrollContainer = ref<HTMLElement | null>(null)
const rowHeight = computed(() => settings.fileListRowHeight)

const virtualizer = useVirtualizer(
  computed(() => ({
    count: displayItems.value.length,
    getScrollElement: () => scrollContainer.value,
    estimateSize: () => rowHeight.value,
    overscan: 10,
  })),
)

const selectedDisplayIndex = computed(() => (
  displayItems.value.findIndex((item) => item.type === 'file' && item.index === props.selectedFileIdx)
))

const selectedFilePath = computed(() => {
  const diff = props.diffs[props.selectedFileIdx]
  return diff?.new_path ?? diff?.old_path ?? ''
})

const submodulePathSet = computed(() => new Set(props.submodulePaths))

function isSubmodulePath(path: string): boolean {
  return submodulePathSet.value.has(path)
}

function isSubmoduleFile(item: CommitFileDisplayItem): boolean {
  return item.type === 'file' && isSubmodulePath(item.path)
}

function fileTitle(item: CommitFileDisplayItem): string {
  if (!isSubmoduleFile(item)) return item.path
  return `${item.path}\n${t('workspace.fileList.submoduleTitle')}`
}

function expandSelectedFileAncestors() {
  if (viewMode.value !== 'tree' || selectedDisplayIndex.value >= 0) return

  const parts = selectedFilePath.value.split('/').filter(Boolean)
  for (let i = 1; i < parts.length; i += 1) {
    expandedDirs.value.add(parts.slice(0, i).join('/'))
  }
}

async function scrollSelectedFileIntoView() {
  expandSelectedFileAncestors()
  await nextTick()

  const idx = selectedDisplayIndex.value
  if (idx < 0) return
  virtualizer.value.scrollToIndex(idx, { align: 'auto' })
}

watch(rowHeight, () => {
  virtualizer.value.measure()
  scrollSelectedFileIntoView()
})

watch(
  () => [props.selectedFileIdx, props.commitOid, viewMode.value] as const,
  () => {
    scrollSelectedFileIntoView()
  },
  { flush: 'post' },
)

function onRowClick(item: CommitFileDisplayItem) {
  if (item.type === 'dir') {
    toggleDir(item.path)
    return
  }
  emit('selectFile', item.index)
}

function onRowContext(event: MouseEvent, item: CommitFileDisplayItem) {
  if (item.type === 'file') {
    emit('fileContextMenu', event, item.index)
  }
}

function isActiveFile(item: CommitFileDisplayItem): boolean {
  return item.type === 'file' && item.index === props.selectedFileIdx
}

function displayFileName(item: CommitFileDisplayItem): string {
  if (item.type === 'dir') return item.name
  if (viewMode.value !== 'tree') return item.path
  return item.path.split('/').pop() || item.path
}

function getFileItem(item: CommitFileDisplayItem) {
  return item.type === 'file' ? item : null
}

function getDirItem(item: CommitFileDisplayItem) {
  return item.type === 'dir' ? item : null
}
</script>

<template>
  <div class="file-tabs-container">
    <div class="file-tabs-header">
      <span class="file-tabs-title">{{ t('history.detailsPanel.changedFiles', { count: diffs.length }) }}</span>
      <div class="header-actions">
        <button
          v-if="viewMode === 'tree'"
          class="btn-icon"
          :title="isAllExpanded ? t('workspace.wip.collapseAllTitle', 'Collapse All') : t('workspace.wip.expandAllTitle', 'Expand All')"
          @click="toggleExpandCollapseAll"
        >
          <svg v-if="isAllExpanded" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="17 11 12 6 7 11" />
            <polyline points="17 18 12 13 7 18" />
          </svg>
          <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="7 13 12 18 17 13" />
            <polyline points="7 6 12 11 17 6" />
          </svg>
        </button>
        <button
          class="btn-icon"
          :class="{ active: viewMode === 'tree' }"
          title="Toggle Tree View"
          @click="toggleViewMode"
        >
          <svg v-if="viewMode === 'list'" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
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

    <div class="file-tabs" ref="scrollContainer">
      <div v-if="loading && !diffs.length" class="file-list-loading">
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
            active: isActiveFile(displayItems[vRow.index]),
            'is-dir': displayItems[vRow.index].type === 'dir',
            'is-submodule': isSubmoduleFile(displayItems[vRow.index])
          }"
          :style="{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: rowHeight + 'px',
            transform: `translateY(${vRow.start}px)`
          }"
          :title="fileTitle(displayItems[vRow.index])"
          @click="onRowClick(displayItems[vRow.index])"
          @contextmenu="onRowContext($event, displayItems[vRow.index])"
        >
          <div
            v-if="viewMode === 'tree' && displayItems[vRow.index].depth > 0"
            :style="{ width: (displayItems[vRow.index].depth * 14) + 'px' }"
            class="tree-indent"
          />

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
              :style="{ transform: getDirItem(displayItems[vRow.index])?.expanded ? 'rotate(90deg)' : 'rotate(0deg)' }"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
            <span class="file-name"><span class="path-text"><bdi>{{ displayFileName(displayItems[vRow.index]) }}</bdi></span></span>
          </template>

          <template v-else>
            <svg
              v-if="isSubmoduleFile(displayItems[vRow.index])"
              class="submodule-icon"
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
              <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
              <line x1="12" y1="22.08" x2="12" y2="12"/>
            </svg>
            <svg
              v-else
              class="status-icon"
              :style="{ color: fileStatusColor(commitFileStatus(getFileItem(displayItems[vRow.index])!.file)) }"
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path :d="statusIconMap[commitFileStatus(getFileItem(displayItems[vRow.index])!.file)]?.d ?? statusIconMap.modified.d" />
            </svg>
            <span class="file-name"><span class="path-text"><bdi>{{ displayFileName(displayItems[vRow.index]) }}</bdi></span></span>
            <span class="file-stats">
              <span class="add" v-if="getFileItem(displayItems[vRow.index])!.file.additions > 0">+{{ getFileItem(displayItems[vRow.index])!.file.additions }}</span>
              <span class="del" v-if="getFileItem(displayItems[vRow.index])!.file.deletions > 0">-{{ getFileItem(displayItems[vRow.index])!.file.deletions }}</span>
            </span>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
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
.file-tab .folder-icon,
.file-tab .submodule-icon {
  flex-shrink: 0;
}

.submodule-icon {
  color: var(--accent-blue);
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

.file-tab.is-submodule .file-name {
  font-weight: 500;
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
</style>
