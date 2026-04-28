<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { HistoryColumnId } from '@/stores/ui'

const { t } = useI18n()

type ResizableColumnId = 'desc' | 'stats' | 'hash' | 'author' | 'date'

interface HeaderColumn {
  id: HistoryColumnId
  className: string
  width: number
  resizeCol: ResizableColumnId
  label: string
}

defineProps<{
  commitListMinWidth: number
  headerScrollLeft: number
  graphColWidth: number
  columns: HeaderColumn[]
}>()

const emit = defineEmits<{
  listBodyWheel: [e: WheelEvent]
  dragHandlePointerDown: [pane: 'commits', e: PointerEvent]
  colResizeStart: [e: PointerEvent, col: ResizableColumnId]
  columnReorder: [from: HistoryColumnId, to: HistoryColumnId, placement: 'before' | 'after']
}>()

interface ColumnDragState {
  id: HistoryColumnId
  startX: number
  startY: number
  isDragging: boolean
}

const dragState = ref<ColumnDragState | null>(null)
const dragOverColumn = ref<HistoryColumnId | null>(null)
const dragPlacement = ref<'before' | 'after'>('before')
const DRAG_THRESHOLD = 4

function onColumnPointerDown(e: PointerEvent, id: HistoryColumnId) {
  if (e.button !== 0) return
  dragState.value = {
    id,
    startX: e.clientX,
    startY: e.clientY,
    isDragging: false,
  }
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)
}

function updateDragTarget(e: PointerEvent) {
  const target = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-history-column]')
  if (!target) {
    dragOverColumn.value = null
    return
  }
  const id = target.dataset.historyColumn as HistoryColumnId | undefined
  if (!id) {
    dragOverColumn.value = null
    return
  }
  const rect = target.getBoundingClientRect()
  dragOverColumn.value = id
  dragPlacement.value = e.clientX < rect.left + rect.width / 2 ? 'before' : 'after'
}

function onPointerMove(e: PointerEvent) {
  const state = dragState.value
  if (!state) return
  if (!state.isDragging) {
    const dx = e.clientX - state.startX
    const dy = e.clientY - state.startY
    if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return
    state.isDragging = true
  }
  updateDragTarget(e)
  e.preventDefault()
}

function onPointerUp() {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerUp)

  const state = dragState.value
  const target = dragOverColumn.value
  const placement = dragPlacement.value
  dragState.value = null
  dragOverColumn.value = null

  if (!state?.isDragging || !target || target === state.id) return
  emit('columnReorder', state.id, target, placement)
}

function resizeTitle(col: ResizableColumnId): string {
  switch (col) {
    case 'desc': return t('history.columns.resizeDescription')
    case 'stats': return t('history.columns.resizeChanges')
    case 'hash': return t('history.columns.resizeCommit')
    case 'author': return t('history.columns.resizeAuthor')
    case 'date': return t('history.columns.resizeDateWidth')
  }
}
</script>

<template>
  <div class="col-header-clip">
    <div
      class="col-header"
      :style="{ minWidth: commitListMinWidth + 'px', transform: `translateX(${-headerScrollLeft}px)` }"
      @wheel="emit('listBodyWheel', $event)"
    >
      <div class="dock-handle" @pointerdown="emit('dragHandlePointerDown', 'commits', $event)" :title="t('history.dock.dragToMove')">
        <svg width="8" height="14" viewBox="0 0 8 14"><circle cx="2" cy="2" r="1" fill="currentColor"/><circle cx="6" cy="2" r="1" fill="currentColor"/><circle cx="2" cy="7" r="1" fill="currentColor"/><circle cx="6" cy="7" r="1" fill="currentColor"/><circle cx="2" cy="12" r="1" fill="currentColor"/><circle cx="6" cy="12" r="1" fill="currentColor"/></svg>
      </div>
      <div class="col-graph" :style="{ width: graphColWidth + 'px' }"></div>
      <div
        v-for="col in columns"
        :key="col.id"
        class="header-col history-header-col"
        :class="[
          col.className,
          {
            'column-drag-source': dragState?.isDragging && dragState.id === col.id,
            'column-drop-before': dragOverColumn === col.id && dragPlacement === 'before',
            'column-drop-after': dragOverColumn === col.id && dragPlacement === 'after',
          },
        ]"
        :style="{ width: col.width + 'px' }"
        :data-history-column="col.id"
        @pointerdown="onColumnPointerDown($event, col.id)"
      >
        {{ col.label }}
        <div
          class="col-resize"
          @pointerdown.stop="emit('colResizeStart', $event, col.resizeCol)"
          :title="resizeTitle(col.resizeCol)"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.col-header-clip {
  position: relative;
  overflow: hidden;
  flex-shrink: 0;
}

.col-header {
  position: relative;
  display: flex;
  align-items: center;
  height: 26px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  font-size: var(--font-sm);
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.col-header > .dock-handle {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  height: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  cursor: grab;
  color: var(--text-muted);
  opacity: 0.5;
  transition: opacity 0.15s;
  z-index: 3;
}

.col-header > .dock-handle:hover {
  opacity: 1;
  color: var(--text-secondary);
}

.col-header > .dock-handle:active {
  cursor: grabbing;
}

.col-header > .dock-handle svg {
  display: block;
}

.col-graph {
  flex-shrink: 0;
  overflow: hidden;
  display: flex;
  align-items: center;
}

.col-message {
  flex-shrink: 0;
  padding: 0 8px;
  display: flex;
  align-items: center;
  gap: 4px;
  overflow: hidden;
  text-align: left;
}

.col-change-stats, .col-hash, .col-author, .col-date {
  flex-shrink: 0;
  overflow: hidden;
  white-space: nowrap;
  text-align: left;
}

.col-change-stats { padding: 0 6px; }
.col-hash { padding: 0 6px; }
.col-author { padding: 0 6px; }
.col-date { padding: 0 8px; }

.header-col {
  position: relative;
  overflow: visible;
}

.history-header-col {
  cursor: grab;
  user-select: none;
}

.history-header-col:active {
  cursor: grabbing;
}

.history-header-col.column-drag-source {
  opacity: 0.45;
}

.history-header-col.column-drop-before::before,
.history-header-col.column-drop-after::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--accent-blue);
  z-index: 4;
}

.history-header-col.column-drop-before::before {
  left: 0;
}

.history-header-col.column-drop-after::after {
  right: 0;
}

.col-header > .col-message,
.col-header > .col-change-stats,
.col-header > .header-col {
  border-left: 1px solid var(--border);
}

.col-resize {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 6px;
  transform: translateX(3px);
  cursor: col-resize;
  z-index: 2;
}

.col-resize:hover {
  background: var(--accent-blue);
  opacity: 0.5;
}
</style>
