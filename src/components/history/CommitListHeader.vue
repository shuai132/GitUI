<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

defineProps<{
  commitListMinWidth: number
  headerScrollLeft: number
  graphColWidth: number
  sizes: {
    descColW: number
    hashColW: number
    authorColW: number
    dateColW: number
    dateCol2W: number
    commitPanePct: number
    commitRowPct: number
    diffRowPct: number
    infoPanePct: number
  }
}>()

const emit = defineEmits<{
  listBodyWheel: [e: WheelEvent]
  dragHandlePointerDown: [pane: 'commits', e: PointerEvent]
  colResizeStart: [e: PointerEvent, col: 'desc' | 'hash' | 'author' | 'date']
}>()
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
      <div class="col-message" :style="{ width: sizes.descColW + 'px' }">{{ t('history.columns.description') }}</div>
      <div class="col-hash header-col" :style="{ width: sizes.hashColW + 'px' }">
        {{ t('history.columns.commit') }}
        <div class="col-resize" @pointerdown="emit('colResizeStart', $event, 'desc')" :title="t('history.columns.resizeGroup')" />
      </div>
      <div class="col-author header-col" :style="{ width: sizes.authorColW + 'px' }">
        {{ t('history.columns.author') }}
        <div class="col-resize" @pointerdown="emit('colResizeStart', $event, 'hash')" :title="t('history.columns.resizeAuthor')" />
      </div>
      <div class="col-date header-col" :style="{ width: sizes.dateColW + 'px' }">
        {{ t('history.columns.date') }}
        <div class="col-resize" @pointerdown="emit('colResizeStart', $event, 'author')" :title="t('history.columns.resizeDate')" />
      </div>
      <div class="col-date header-col" :style="{ width: sizes.dateCol2W + 'px' }">
        <span style="visibility: hidden">&nbsp;</span>
        <div class="col-resize" @pointerdown="emit('colResizeStart', $event, 'date')" :title="t('history.columns.resizeDateWidth')" />
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
  z-index: 3;
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

.col-hash, .col-author, .col-date {
  flex-shrink: 0;
  overflow: hidden;
  white-space: nowrap;
  text-align: left;
}

.col-hash { padding: 0 6px; }
.col-author { padding: 0 6px; }
.col-date { padding: 0 8px; }

.header-col {
  position: relative;
  overflow: visible;
}

.col-header > .col-message,
.col-header > .header-col {
  border-left: 1px solid var(--border);
}

.col-resize {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  width: 6px;
  transform: translateX(-3px);
  cursor: col-resize;
  z-index: 2;
}

.col-resize:hover {
  background: var(--accent-blue);
  opacity: 0.5;
}
</style>
