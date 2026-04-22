<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { useI18n } from 'vue-i18n'
import type { FileEntry, FileStatusKind } from '@/types/git'
import { fileStatusColor } from '@/utils/format'
import { useSettingsStore } from '@/stores/settings'
import { buildFileTree, flattenTree } from '@/utils/fileTree'

const { t } = useI18n()

const props = defineProps<{
  files: FileEntry[]
  title: string
  emptyText?: string
  showRowActions?: boolean
  selectedPath?: string | null
  variant?: 'unstaged' | 'staged'
  viewMode?: 'list' | 'tree'
}>()

export type ContextMenuPayload = {
  file?: FileEntry
  path: string
  isDir: boolean
}

const emit = defineEmits<{
  select: [file: FileEntry]
  toggle: [pathOrFile: FileEntry | string, isDir: boolean]
  toggleAll: []
  contextMenu: [event: MouseEvent, payload: ContextMenuPayload]
  multiSelectChange: [paths: string[]]
}>()

// ── Tree 状态 ───────────────────────────────────────────────────────
const expandedDirs = ref(new Set<string>())

watch(() => props.viewMode, (mode) => {
  if (mode === 'tree' && expandedDirs.value.size === 0) {
    const tree = buildFileTree(props.files, f => f.path)
    tree.forEach(n => {
      if (n.isDir) expandedDirs.value.add(n.path)
    })
  }
})

// 添加展开所有和折叠所有的便捷方法（可选）
function expandAll() {
  const tree = buildFileTree(props.files, f => f.path)
  const stack = [...tree]
  while (stack.length > 0) {
    const node = stack.pop()!
    if (node.isDir) {
      expandedDirs.value.add(node.path)
      stack.push(...node.children)
    }
  }
}

function collapseAll() {
  expandedDirs.value.clear()
}

export type DisplayItem = 
  | { type: 'file'; path: string; file: FileEntry; depth: number }
  | { type: 'dir'; path: string; name: string; depth: number; expanded: boolean }

const displayItems = computed<DisplayItem[]>(() => {
  if (props.viewMode === 'tree') {
    const tree = buildFileTree(props.files, f => f.path)
    const flat = flattenTree(tree, expandedDirs.value)
    return flat.map(node => {
      if (node.isDir) {
        return { type: 'dir', path: node.path, name: node.name, depth: node.depth, expanded: expandedDirs.value.has(node.path) }
      } else {
        return { type: 'file', path: node.path, file: node.file!, depth: node.depth }
      }
    })
  }
  return props.files.map(f => ({ type: 'file', path: f.path, file: f, depth: 0 }))
})

// ── 多选状态 ──────────────────────────────────────────────────────
const multiSelectedPaths = ref(new Set<string>())
const lastClickedIdx = ref<number | null>(null)

// 文件列表更新时清除失效的多选项
watch(
  () => props.files,
  (files) => {
    const validPaths = new Set(files.map((f) => f.path))
    let changed = false
    for (const p of multiSelectedPaths.value) {
      if (!validPaths.has(p)) {
        multiSelectedPaths.value.delete(p)
        changed = true
      }
    }
    if (changed) emit('multiSelectChange', [...multiSelectedPaths.value])
  },
)

function clearMultiSelect() {
  if (multiSelectedPaths.value.size === 0) return
  multiSelectedPaths.value.clear()
  emit('multiSelectChange', [])
}

function onRowClick(e: MouseEvent, item: DisplayItem, idx: number) {
  if (item.type === 'dir') {
    if (expandedDirs.value.has(item.path)) {
      expandedDirs.value.delete(item.path)
    } else {
      expandedDirs.value.add(item.path)
    }
    return
  }

  const file = item.file

  if (e.ctrlKey || e.metaKey) {
    // 从单选状态切入多选时，先把当前单选项加入多选集
    if (multiSelectedPaths.value.size === 0 && props.selectedPath) {
      multiSelectedPaths.value.add(props.selectedPath)
    }
    // Ctrl/Cmd+click：切换单项
    if (multiSelectedPaths.value.has(file.path)) {
      multiSelectedPaths.value.delete(file.path)
    } else {
      multiSelectedPaths.value.add(file.path)
    }
    lastClickedIdx.value = idx
    emit('multiSelectChange', [...multiSelectedPaths.value])
  } else if (e.shiftKey && lastClickedIdx.value !== null) {
    // 从单选状态切入区间选时，先把当前单选项加入多选集
    if (multiSelectedPaths.value.size === 0 && props.selectedPath) {
      multiSelectedPaths.value.add(props.selectedPath)
    }
    // Shift+click：区间选
    const start = Math.min(lastClickedIdx.value, idx)
    const end = Math.max(lastClickedIdx.value, idx)
    for (let i = start; i <= end; i++) {
      const iter = displayItems.value[i]
      if (iter && iter.type === 'file') multiSelectedPaths.value.add(iter.file.path)
    }
    emit('multiSelectChange', [...multiSelectedPaths.value])
  } else {
    // 普通点击：清除多选，单选此文件
    if (multiSelectedPaths.value.size > 0) {
      multiSelectedPaths.value.clear()
      emit('multiSelectChange', [])
    }
    lastClickedIdx.value = idx
    emit('select', file)
  }
}

function onRowContext(e: MouseEvent, item: DisplayItem) {
  if (!props.showRowActions) return
  e.preventDefault()
  emit('contextMenu', e, {
    file: item.type === 'file' ? item.file : undefined,
    path: item.path,
    isDir: item.type === 'dir'
  })
}

function getFile(item: DisplayItem): FileEntry {
  return (item as any).file
}

function getDir(item: DisplayItem): { name: string; expanded: boolean } {
  return item as any
}

const statusIconMap: Record<FileStatusKind, { d: string; stroke?: boolean }> = {
  modified: { d: 'M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z' },
  added: { d: 'M12 5v14M5 12h14' },
  deleted: { d: 'M5 12h14' },
  renamed: { d: 'M5 12h7M12 12l-4-4M12 12l-4 4M19 12h-7M12 12l4-4M12 12l4 4' },
  untracked: { d: 'M12 5v14M5 12h14', stroke: true },
  conflicted: { d: 'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z M12 9v4 M12 17h.01' },
}

const settings = useSettingsStore()
const rowHeight = computed(() => settings.fileListRowHeight)

const scrollEl = ref<HTMLElement | null>(null)

const virtualizer = useVirtualizer(
  computed(() => ({
    count: displayItems.value.length,
    getScrollElement: () => scrollEl.value,
    estimateSize: () => rowHeight.value,
    overscan: 5,
  }))
)

watch(rowHeight, () => {
  virtualizer.value.measure()
})

function scrollToIndex(idx: number) {
  virtualizer.value.scrollToIndex(idx, { align: 'auto' })
}

defineExpose({ scrollToIndex, clearMultiSelect, expandAll, collapseAll })
</script>

<template>
  <div class="file-list-section" :class="variant ? `variant-${variant}` : ''">
    <div class="section-header">
      <span class="section-title">{{ title }}</span>
      <span class="section-count">{{ files.length }}</span>
      <slot name="header-actions" />
    </div>
    <div ref="scrollEl" class="file-entries">
      <div
        v-if="files.length === 0"
        class="empty-hint"
      >
        {{ emptyText ?? t('workspace.fileList.emptyDefault') }}
      </div>
      <div
        v-else
        :style="{ height: virtualizer.getTotalSize() + 'px', position: 'relative' }"
      >
        <div
          v-for="vRow in virtualizer.getVirtualItems()"
          :key="vRow.index"
          class="file-entry"
          :class="{
            selected: displayItems[vRow.index].type === 'file' && selectedPath === displayItems[vRow.index].path,
            'multi-selected': displayItems[vRow.index].type === 'file' && multiSelectedPaths.has(displayItems[vRow.index].path),
            'is-dir': displayItems[vRow.index].type === 'dir'
          }"
          :style="{
            position: 'absolute',
            top: vRow.start + 'px',
            height: rowHeight + 'px',
            width: '100%',
          }"
          @click="onRowClick($event, displayItems[vRow.index], vRow.index)"
          @contextmenu="onRowContext($event, displayItems[vRow.index])"
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
            <span class="file-path" :title="displayItems[vRow.index].path">
              <span class="path-text"><bdi>{{ getDir(displayItems[vRow.index]).name }}</bdi></span>
            </span>
            <button
              v-if="showRowActions"
              class="row-action"
              :title="variant === 'staged' ? t('workspace.fileList.rowAction.unstageTitle') : t('workspace.fileList.rowAction.stageTitle')"
              @click.stop="emit('toggle', displayItems[vRow.index].path, true)"
            >
              {{ variant === 'staged' ? t('workspace.fileList.rowAction.unstage') : t('workspace.fileList.rowAction.stage') }}
            </button>
          </template>

          <!-- File Item -->
          <template v-else>
            <svg
              class="status-icon"
              :style="{ color: fileStatusColor(getFile(displayItems[vRow.index]).status) }"
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path :d="statusIconMap[getFile(displayItems[vRow.index]).status]?.d ?? statusIconMap.untracked.d" />
            </svg>
            <span class="file-path" :title="displayItems[vRow.index].path">
              <span class="path-text"><bdi>{{ viewMode === 'tree' ? (displayItems[vRow.index].path.split('/').pop() || displayItems[vRow.index].path) : displayItems[vRow.index].path }}</bdi></span>
            </span>
            <span
              class="file-stats"
              v-if="getFile(displayItems[vRow.index]).additions > 0 || getFile(displayItems[vRow.index]).deletions > 0"
            >
              <span class="add" v-if="getFile(displayItems[vRow.index]).additions > 0">+{{ getFile(displayItems[vRow.index]).additions }}</span>
              <span class="del" v-if="getFile(displayItems[vRow.index]).deletions > 0">-{{ getFile(displayItems[vRow.index]).deletions }}</span>
            </span>
            <button
              v-if="showRowActions"
              class="row-action"
              :title="getFile(displayItems[vRow.index]).staged ? t('workspace.fileList.rowAction.unstageTitle') : t('workspace.fileList.rowAction.stageTitle')"
              @click.stop="emit('toggle', getFile(displayItems[vRow.index]), false)"
            >
              {{ getFile(displayItems[vRow.index]).staged ? t('workspace.fileList.rowAction.unstage') : t('workspace.fileList.rowAction.stage') }}
            </button>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.file-list-section {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 1px 4px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  user-select: none;
  height: 18px;
}

.section-count {
  margin-right: auto;
}

.file-entries {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

.section-title {
  font-size: var(--font-xs);
  font-weight: 500;
  color: var(--text-muted);
}

.section-count {
  font-size: 10px;
  color: var(--text-muted);
  background: var(--bg-overlay);
  padding: 0 4px;
  border-radius: 6px;
  line-height: 12px;
}

.file-entry {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px;
  cursor: pointer;
  transition: background 0.1s;
  box-sizing: border-box;
}

.file-entry:hover {
  background: var(--bg-overlay);
}

.file-entry.is-dir {
  font-weight: 500;
  color: var(--text-primary);
}

.file-entry.selected {
  background: var(--row-selected-bg);
  color: var(--row-selected-fg);
}

.file-entry.selected .file-path,
.file-entry.selected .file-stats .add,
.file-entry.selected .file-stats .del {
  color: var(--row-selected-fg);
}

.file-entry.multi-selected {
  background: color-mix(in srgb, var(--row-selected-bg) 45%, transparent);
}

.file-entry.selected.multi-selected {
  background: var(--row-selected-bg);
  color: var(--row-selected-fg);
}

.row-action {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 3px;
  color: var(--text-secondary);
  cursor: pointer;
  font-family: inherit;
  font-size: var(--font-xs);
  padding: 0 5px;
  position: absolute;
  right: 4px;
  opacity: 0;
  transition: opacity 0.1s, background 0.1s, color 0.1s;
  line-height: 14px;
  z-index: 1;
}

.file-entry:hover .row-action {
  opacity: 1;
}

.row-action:hover {
  background: var(--accent-blue);
  color: var(--bg-primary);
  border-color: var(--accent-blue);
}

.status-icon, .folder-icon {
  flex-shrink: 0;
  color: var(--text-secondary);
}

.folder-icon {
  transition: transform 0.1s;
}

.tree-indent {
  flex-shrink: 0;
}

.file-path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: var(--font-md);
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

.file-stats {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
  margin-left: 4px;
  font-size: var(--font-xs);
}

.file-stats .add { color: var(--accent-green); }
.file-stats .del { color: var(--accent-red); }

.empty-hint {
  padding: 8px 10px;
  color: var(--text-muted);
  font-size: var(--font-sm);
  font-style: italic;
}

/* ── Section variant styles (unstaged / staged) ── */

.variant-unstaged .section-header {
  border-left: 3px solid var(--unstaged-accent);
}

.variant-staged .section-header {
  border-left: 3px solid var(--staged-accent);
}

.variant-unstaged .section-count {
  color: var(--unstaged-accent);
  background: var(--unstaged-accent-bg);
}

.variant-staged .section-count {
  color: var(--staged-accent);
  background: var(--staged-accent-bg);
}

.variant-unstaged .file-entry {
  border-left: 2px solid var(--unstaged-bar);
}

.variant-staged .file-entry {
  border-left: 2px solid var(--staged-bar);
}
</style>
