<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { useI18n } from 'vue-i18n'
import type { FileEntry, FileStatusKind } from '@/types/git'
import { fileStatusColor } from '@/utils/format'
import { useSettingsStore } from '@/stores/settings'

const { t } = useI18n()

const props = defineProps<{
  files: FileEntry[]
  title: string
  emptyText?: string
  showRowActions?: boolean
  selectedPath?: string | null
  variant?: 'unstaged' | 'staged'
}>()

const emit = defineEmits<{
  select: [file: FileEntry]
  toggle: [file: FileEntry]
  toggleAll: []
  contextMenu: [event: MouseEvent, file: FileEntry]
  multiSelectChange: [paths: string[]]
}>()

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

function onRowClick(e: MouseEvent, file: FileEntry, idx: number) {
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
      if (props.files[i]) multiSelectedPaths.value.add(props.files[i].path)
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

function onRowContext(e: MouseEvent, file: FileEntry) {
  if (!props.showRowActions) return
  e.preventDefault()
  emit('contextMenu', e, file)
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
    count: props.files.length,
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

defineExpose({ scrollToIndex, clearMultiSelect })
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
            selected: selectedPath === files[vRow.index].path,
            'multi-selected': multiSelectedPaths.has(files[vRow.index].path),
          }"
          :style="{
            position: 'absolute',
            top: vRow.start + 'px',
            height: rowHeight + 'px',
            width: '100%',
          }"
          @click="onRowClick($event, files[vRow.index], vRow.index)"
          @contextmenu="onRowContext($event, files[vRow.index])"
        >
          <svg
            class="status-icon"
            :style="{ color: fileStatusColor(files[vRow.index].status) }"
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path :d="statusIconMap[files[vRow.index].status]?.d ?? statusIconMap.untracked.d" />
          </svg>
          <span class="file-path" :title="files[vRow.index].path">
            <span class="path-text"><bdi>{{ files[vRow.index].path }}</bdi></span>
          </span>
          <span
            class="file-stats"
            v-if="files[vRow.index].additions > 0 || files[vRow.index].deletions > 0"
          >
            <span class="add" v-if="files[vRow.index].additions > 0">+{{ files[vRow.index].additions }}</span>
            <span class="del" v-if="files[vRow.index].deletions > 0">-{{ files[vRow.index].deletions }}</span>
          </span>
          <button
            v-if="showRowActions"
            class="row-action"
            :title="files[vRow.index].staged ? t('workspace.fileList.rowAction.unstageTitle') : t('workspace.fileList.rowAction.stageTitle')"
            @click.stop="emit('toggle', files[vRow.index])"
          >
            {{ files[vRow.index].staged ? t('workspace.fileList.rowAction.unstage') : t('workspace.fileList.rowAction.stage') }}
          </button>
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

.status-icon {
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
