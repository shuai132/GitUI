<script setup lang="ts">
import type { FileEntry } from '@/types/git'
import { fileStatusLabel, fileStatusColor } from '@/utils/format'

const props = defineProps<{
  files: FileEntry[]
  title: string
  emptyText?: string
}>()

const emit = defineEmits<{
  select: [file: FileEntry]
  toggle: [file: FileEntry]
  toggleAll: []
}>()
</script>

<template>
  <div class="file-list-section">
    <div class="section-header" @click="emit('toggleAll')">
      <span class="section-title">{{ title }}</span>
      <span class="section-count">{{ files.length }}</span>
    </div>
    <div class="file-entries">
      <div
        v-for="file in files"
        :key="file.path"
        class="file-entry"
        @click="emit('select', file)"
        @dblclick="emit('toggle', file)"
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
  padding: 5px 10px;
  cursor: pointer;
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
}

.file-entry:hover {
  background: var(--bg-overlay);
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
