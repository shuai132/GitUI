<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { FileEntry, FileStatusKind } from '@/types/git'
import { fileStatusColor } from '@/utils/format'

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
}>()

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
  conflicted: { d: 'M18 6L6 18M6 6l12 12' },
}
</script>

<template>
  <div class="file-list-section" :class="variant ? `variant-${variant}` : ''">
    <div class="section-header">
      <span class="section-title">{{ title }}</span>
      <span class="section-count">{{ files.length }}</span>
      <slot name="header-actions" />
    </div>
    <div class="file-entries">
      <div
        v-for="file in files"
        :key="file.path"
        class="file-entry"
        :class="{ selected: selectedPath === file.path }"
        @click="emit('select', file)"
        @contextmenu="onRowContext($event, file)"
      >
        <svg
          class="status-icon"
          :style="{ color: fileStatusColor(file.status) }"
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path :d="statusIconMap[file.status]?.d ?? statusIconMap.untracked.d" />
        </svg>
        <span class="file-path" :title="file.path">
          {{ file.path.split('/').pop() }}
        </span>
        <span class="file-stats" v-if="file.additions > 0 || file.deletions > 0">
          <span class="add" v-if="file.additions > 0">+{{ file.additions }}</span>
          <span class="del" v-if="file.deletions > 0">-{{ file.deletions }}</span>
        </span>
        <button
          v-if="showRowActions"
          class="row-action"
          :title="file.staged ? t('workspace.fileList.rowAction.unstageTitle') : t('workspace.fileList.rowAction.stageTitle')"
          @click.stop="emit('toggle', file)"
        >
          {{ file.staged ? t('workspace.fileList.rowAction.unstage') : t('workspace.fileList.rowAction.stage') }}
        </button>
      </div>
      <div v-if="files.length === 0" class="empty-hint">
        {{ emptyText ?? t('workspace.fileList.emptyDefault') }}
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
  padding: 1px 4px;
  cursor: pointer;
  transition: background 0.1s;
  position: relative;
}

.file-entry:hover {
  background: var(--bg-overlay);
}

.file-entry.selected {
  background: rgba(138, 173, 244, 0.18);
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
  font-size: var(--font-md);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
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
