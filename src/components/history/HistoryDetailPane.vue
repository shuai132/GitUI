<script setup lang="ts">
import type { CSSProperties } from 'vue'
import type { CommitDetail, FileDiff, FileEntry } from '@/types/git'
import type { PanelId } from '@/stores/ui'
import DiffView from '@/components/diff/DiffView.vue'
import CommitInfoPanel from '@/components/history/CommitInfoPanel.vue'
import WipPanel from '@/components/workspace/WipPanel.vue'

interface ChangeStats {
  modified: number
  deleted: number
  added: number
}

defineProps<{
  panelBorders: Record<string, CSSProperties>
  repoId?: string
  selectedWip: boolean
  selectedCommit: CommitDetail | null
  selectedFileIdx: number
  currentDiff: FileDiff | null
  currentStaged: boolean
  currentWipFile: FileEntry | null
  currentConflictFilePath: string | null
  wipStats: ChangeStats
  commitStats: ChangeStats
}>()

const emit = defineEmits<{
  close: []
  selectFile: [idx: number]
  showFileHistory: [payload: { filePath: string; mode: 'history' | 'blame' }]
  dragHandlePointerDown: [panel: PanelId, event: PointerEvent]
}>()

function onDragHandlePointerDown(panel: PanelId, event: PointerEvent) {
  emit('dragHandlePointerDown', panel, event)
}
</script>

<template>
  <div class="diff-area" :style="panelBorders.diff" data-panel-id="diff">
    <div
      class="dock-handle dock-handle-float"
      :title="$t('history.dock.dragToMove')"
      @pointerdown="onDragHandlePointerDown('diff', $event)"
    >
      <svg width="8" height="14" viewBox="0 0 8 14"><circle cx="2" cy="2" r="1" fill="currentColor"/><circle cx="6" cy="2" r="1" fill="currentColor"/><circle cx="2" cy="7" r="1" fill="currentColor"/><circle cx="6" cy="7" r="1" fill="currentColor"/><circle cx="2" cy="12" r="1" fill="currentColor"/><circle cx="6" cy="12" r="1" fill="currentColor"/></svg>
    </div>
    <DiffView
      :diff="currentDiff"
      :repo-id="repoId"
      :wip="selectedWip ? { staged: currentStaged, status: currentWipFile?.status } : null"
      :conflict-file-path="currentConflictFilePath"
      @close="emit('close')"
    />
  </div>

  <div class="info-pane" :style="panelBorders.info" data-panel-id="info">
    <div class="pane-header">
      <div
        class="dock-handle"
        :title="$t('history.dock.dragToMove')"
        @pointerdown="onDragHandlePointerDown('info', $event)"
      >
        <svg width="8" height="14" viewBox="0 0 8 14"><circle cx="2" cy="2" r="1" fill="currentColor"/><circle cx="6" cy="2" r="1" fill="currentColor"/><circle cx="2" cy="7" r="1" fill="currentColor"/><circle cx="6" cy="7" r="1" fill="currentColor"/><circle cx="2" cy="12" r="1" fill="currentColor"/><circle cx="6" cy="12" r="1" fill="currentColor"/></svg>
      </div>
      <span class="pane-header-title" />

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

      <span v-else-if="selectedCommit" class="pane-header-stats">
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

    <WipPanel v-if="selectedWip" @show-file-history="emit('showFileHistory', $event)" />
    <CommitInfoPanel
      v-else
      :commit="selectedCommit"
      :selected-file-idx="selectedFileIdx"
      @select-file="emit('selectFile', $event)"
      @show-file-history="emit('showFileHistory', $event)"
    />
  </div>
</template>

<style scoped>
.diff-area {
  grid-area: diff;
  position: relative;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
  min-height: 0;
}

.info-pane {
  grid-area: info;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
  min-height: 0;
}

.info-pane :deep(.commit-info-panel),
.info-pane :deep(.panel-empty) {
  border-top: none;
}

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

.dock-handle-float {
  position: absolute;
  top: 4px;
  left: 4px;
  z-index: 10;
  width: 16px;
  height: 20px;
}

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
</style>
