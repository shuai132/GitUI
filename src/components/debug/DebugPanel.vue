<script setup lang="ts">
import { ref, computed, nextTick, watch } from 'vue'
import { useDebugStore, type DebugEntry } from '@/stores/debug'
import { useUiStore } from '@/stores/ui'

const debugStore = useDebugStore()
const uiStore = useUiStore()

const selectedId = ref<number | null>(null)
const topPct = ref(50)
const listEl = ref<HTMLElement | null>(null)

const selected = computed<DebugEntry | null>(
  () => debugStore.entries.find((e) => e.id === selectedId.value) ?? null,
)

function selectEntry(entry: DebugEntry) {
  selectedId.value = selectedId.value === entry.id ? null : entry.id
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString('en-GB', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0')
}

function formatDuration(ms?: number): string {
  if (ms === undefined) return '--'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function statusIcon(status: string): string {
  if (status === 'ok') return '\u2713'
  if (status === 'error') return '\u2717'
  return '\u23F3'
}

function statusClass(status: string): string {
  if (status === 'ok') return 'status-ok'
  if (status === 'error') return 'status-error'
  return 'status-pending'
}

function formatArgs(args?: Record<string, unknown>): string {
  if (!args) return '(no args)'
  return JSON.stringify(args, null, 2)
}

// Auto-scroll to top when new entry arrives
watch(
  () => debugStore.entries[0]?.id,
  () => {
    nextTick(() => {
      if (listEl.value) listEl.value.scrollTop = 0
    })
  },
)

// ── Resize handle ─────────────────────────────────────────────────
function startResize(e: PointerEvent) {
  e.preventDefault()
  const container = (e.currentTarget as HTMLElement).parentElement!
  const startY = e.clientY
  const startPct = topPct.value
  const containerH = container.getBoundingClientRect().height

  const onMove = (ev: PointerEvent) => {
    const delta = ev.clientY - startY
    const deltaPct = (delta / containerH) * 100
    topPct.value = Math.max(20, Math.min(80, startPct + deltaPct))
  }
  const onUp = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  document.body.style.cursor = 'row-resize'
  document.body.style.userSelect = 'none'
}
</script>

<template>
  <div class="debug-panel">
    <!-- Header -->
    <div class="debug-header">
      <span class="debug-title">Debug</span>
      <div class="debug-actions">
        <button class="debug-btn" title="清空" @click="debugStore.clear()">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
        </button>
        <button class="debug-btn" title="关闭" @click="uiStore.toggleDebugPanel()">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    </div>

    <!-- Top: Command list -->
    <div class="debug-top" :style="{ flex: `0 0 ${topPct}%` }">
      <div class="debug-section-label">Commands</div>
      <div ref="listEl" class="debug-list">
        <div
          v-for="entry in debugStore.entries"
          :key="entry.id"
          class="debug-row"
          :class="{
            'debug-row--selected': selectedId === entry.id,
            'debug-row--error': entry.status === 'error',
          }"
          @click="selectEntry(entry)"
        >
          <span class="debug-time">{{ formatTime(entry.ts) }}</span>
          <span class="debug-op">{{ entry.op }}</span>
          <span class="debug-dur">{{ formatDuration(entry.duration) }}</span>
          <span class="debug-status" :class="statusClass(entry.status)">{{ statusIcon(entry.status) }}</span>
        </div>
        <div v-if="debugStore.entries.length === 0" class="debug-empty">
          暂无日志
        </div>
      </div>
    </div>

    <!-- Resize handle -->
    <div class="debug-split" @pointerdown="startResize" />

    <!-- Bottom: Detail -->
    <div class="debug-bottom">
      <div class="debug-section-label">Detail</div>
      <div class="debug-detail">
        <template v-if="selected">
          <div class="detail-section">
            <div class="detail-label">Command</div>
            <pre class="detail-value">{{ selected.op }}</pre>
          </div>
          <div class="detail-section">
            <div class="detail-label">Arguments</div>
            <pre class="detail-value">{{ formatArgs(selected.args) }}</pre>
          </div>
          <div v-if="selected.error" class="detail-section">
            <div class="detail-label detail-label--error">Error</div>
            <pre class="detail-value detail-value--error">{{ selected.error }}</pre>
          </div>
        </template>
        <div v-else class="debug-empty">
          点击上方命令查看详情
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.debug-panel {
  width: 320px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
  border-left: 1px solid var(--border);
  overflow: hidden;
}

.debug-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.debug-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.debug-actions {
  display: flex;
  gap: 2px;
}

.debug-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-muted);
  padding: 3px;
  border-radius: 3px;
  display: flex;
  align-items: center;
  transition: color 0.15s, background 0.15s;
}

.debug-btn:hover {
  color: var(--text-primary);
  background: var(--bg-overlay);
}

.debug-section-label {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 4px 8px 2px;
  flex-shrink: 0;
}

.debug-top {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 60px;
}

.debug-list {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}

.debug-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  font-size: 11px;
  font-family: 'SF Mono', 'Menlo', 'Monaco', monospace;
  cursor: pointer;
  transition: background 0.1s;
  border-left: 2px solid transparent;
}

.debug-row:hover {
  background: rgba(138, 173, 244, 0.08);
}

.debug-row--selected {
  background: rgba(138, 173, 244, 0.15);
  border-left-color: var(--accent-blue);
}

.debug-row--error {
  color: var(--accent-red);
}

.debug-time {
  color: var(--text-muted);
  font-size: 10px;
  flex-shrink: 0;
  min-width: 72px;
}

.debug-op {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-secondary);
}

.debug-dur {
  color: var(--text-muted);
  font-size: 10px;
  flex-shrink: 0;
  text-align: right;
  min-width: 40px;
}

.debug-status {
  flex-shrink: 0;
  font-size: 11px;
  width: 14px;
  text-align: center;
}

.status-ok { color: var(--accent-green); }
.status-error { color: var(--accent-red); }
.status-pending { color: var(--accent-orange); }

.debug-split {
  height: 5px;
  flex-shrink: 0;
  cursor: row-resize;
  background: var(--border);
  transition: background 0.15s;
}

.debug-split:hover,
.debug-split:active {
  background: rgba(138, 173, 244, 0.4);
}

.debug-bottom {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 60px;
}

.debug-detail {
  flex: 1;
  overflow-y: auto;
  padding: 4px 8px;
}

.detail-section {
  margin-bottom: 8px;
}

.detail-label {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  margin-bottom: 2px;
}

.detail-label--error {
  color: var(--accent-red);
}

.detail-value {
  font-size: 11px;
  font-family: 'SF Mono', 'Menlo', 'Monaco', monospace;
  color: var(--text-secondary);
  background: var(--bg-secondary);
  border-radius: 4px;
  padding: 6px 8px;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
  line-height: 1.4;
}

.detail-value--error {
  color: var(--accent-red);
  background: rgba(237, 135, 150, 0.08);
}

.debug-empty {
  padding: 16px 8px;
  text-align: center;
  color: var(--text-muted);
  font-size: 11px;
}
</style>
