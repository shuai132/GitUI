<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { FileEntry } from '@/types/git'
import { fileStatusLabel, fileStatusColor } from '@/utils/format'

const { t } = useI18n()

const props = defineProps<{
  files: FileEntry[]
  title: string
  emptyText?: string
  /** 显示每行的快捷操作按钮（Stage / Unstage / Discard），用于 WipPanel */
  showRowActions?: boolean
  /** 被选中的文件路径（用于高亮） */
  selectedPath?: string | null
  /** 视觉变体：'unstaged'（橙色）| 'staged'（绿色）；省略为中性 */
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
</script>

<template>
  <div class="file-list-section" :class="variant ? `variant-${variant}` : ''">
    <div class="section-header">
      <svg v-if="variant === 'unstaged'" class="section-icon" width="12" height="12"
           viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/>
        <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/>
      </svg>
      <svg v-if="variant === 'staged'" class="section-icon" width="12" height="12"
           viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/>
        <polyline points="9 12 11.5 14.5 16 9.5"/>
      </svg>
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
        <span
          class="status-badge"
          :style="{ color: fileStatusColor(file.status) }"
        >{{ fileStatusLabel(file.status) }}</span>
        <span class="file-path" :title="file.path">
          {{ file.path.split('/').pop() }}
          <span class="file-dir" v-if="file.path.includes('/')">
            &nbsp;{{ file.path.substring(0, file.path.lastIndexOf('/')) }}
          </span>
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
  gap: 6px;
  padding: 3px 10px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  user-select: none;
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
  font-size: var(--font-sm);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}

.section-count {
  font-size: var(--font-sm);
  color: var(--text-muted);
  background: var(--bg-overlay);
  padding: 1px 6px;
  border-radius: 8px;
}

.file-entry {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
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
  padding: 2px 6px;
  margin-left: auto;
  opacity: 0;
  transition: opacity 0.1s, background 0.1s, color 0.1s;
  flex-shrink: 0;
}

.file-entry:hover .row-action {
  opacity: 1;
}

.row-action:hover {
  background: var(--accent-blue);
  color: var(--bg-primary);
  border-color: var(--accent-blue);
}

.status-badge {
  font-size: var(--font-sm);
  font-weight: 700;
  width: 14px;
  flex-shrink: 0;
  font-family: var(--code-font-family, 'SF Mono', monospace);
}

.file-path {
  font-size: var(--font-md);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.file-dir {
  color: var(--text-muted);
  font-size: var(--font-sm);
}

.empty-hint {
  padding: 8px 10px;
  color: var(--text-muted);
  font-size: var(--font-sm);
  font-style: italic;
}

/* ── Section variant styles (unstaged / staged) ── */

.section-icon {
  flex-shrink: 0;
}

.variant-unstaged .section-header {
  border-left: 3px solid var(--unstaged-accent);
}

.variant-staged .section-header {
  border-left: 3px solid var(--staged-accent);
}

.variant-unstaged .section-icon {
  color: var(--unstaged-accent);
}

.variant-staged .section-icon {
  color: var(--staged-accent);
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
