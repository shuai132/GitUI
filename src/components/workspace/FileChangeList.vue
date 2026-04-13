<script setup lang="ts">
import type { FileEntry } from '@/types/git'
import { fileStatusLabel, fileStatusColor } from '@/utils/format'

const props = defineProps<{
  files: FileEntry[]
  title: string
  emptyText?: string
  /** 显示每行的快捷操作按钮（Stage / Unstage / Discard），用于 WipPanel */
  showRowActions?: boolean
  /** 被选中的文件路径（用于高亮） */
  selectedPath?: string | null
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
  <div class="file-list-section">
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
          :title="file.staged ? '取消暂存此文件' : '暂存此文件'"
          @click.stop="emit('toggle', file)"
        >
          {{ file.staged ? '取消暂存' : '暂存' }}
        </button>
      </div>
      <div v-if="files.length === 0" class="empty-hint">
        {{ emptyText ?? '无变更' }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.file-list-section {
  display: flex;
  flex-direction: column;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 5px 10px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  user-select: none;
}

.section-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}

.section-count {
  font-size: 11px;
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
  font-size: 10px;
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
  font-size: 11px;
  font-weight: 700;
  width: 14px;
  flex-shrink: 0;
  font-family: 'SF Mono', monospace;
}

.file-path {
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.file-dir {
  color: var(--text-muted);
  font-size: 11px;
}

.empty-hint {
  padding: 8px 10px;
  color: var(--text-muted);
  font-size: 11px;
  font-style: italic;
}
</style>
