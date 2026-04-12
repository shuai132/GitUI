<script setup lang="ts">
import { ref, computed, nextTick, watch } from 'vue'
import { useDebugStore, type DebugEntry } from '@/stores/debug'
import { useUiStore } from '@/stores/ui'

const debugStore = useDebugStore()
const uiStore = useUiStore()

type Tab = 'commands' | 'details' | 'logs'
const activeTab = ref<Tab>('commands')

const selectedId = ref<number | null>(null)
const cmdListEl = ref<HTMLElement | null>(null)
const logListEl = ref<HTMLElement | null>(null)

const selected = computed<DebugEntry | null>(
  () => debugStore.entries.find((e) => e.id === selectedId.value) ?? null,
)

function selectEntry(entry: DebugEntry) {
  selectedId.value = entry.id
  activeTab.value = 'details'
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

function logLevelClass(level: string): string {
  if (level === 'error') return 'log-error'
  if (level === 'warn') return 'log-warn'
  if (level === 'info') return 'log-info'
  return 'log-debug'
}

function formatArgs(args?: Record<string, unknown>): string {
  if (!args) return '(no args)'
  return JSON.stringify(args, null, 2)
}

function onClear() {
  if (activeTab.value === 'logs') debugStore.clearLogs()
  else debugStore.clear()
}

// Auto-scroll on new entries
watch(
  () => debugStore.entries[0]?.id,
  () => {
    if (activeTab.value === 'commands') {
      nextTick(() => { if (cmdListEl.value) cmdListEl.value.scrollTop = 0 })
    }
  },
)
watch(
  () => debugStore.logEntries[0]?.id,
  () => {
    if (activeTab.value === 'logs') {
      nextTick(() => { if (logListEl.value) logListEl.value.scrollTop = 0 })
    }
  },
)
</script>

<template>
  <div class="debug-panel">
    <!-- Header -->
    <div class="debug-header">
      <div class="debug-tabs">
        <button
          class="debug-tab"
          :class="{ 'debug-tab--active': activeTab === 'commands' }"
          @click="activeTab = 'commands'"
        >Commands</button>
        <button
          class="debug-tab"
          :class="{ 'debug-tab--active': activeTab === 'details' }"
          @click="activeTab = 'details'"
        >Details</button>
        <button
          class="debug-tab"
          :class="{ 'debug-tab--active': activeTab === 'logs' }"
          @click="activeTab = 'logs'"
        >Logs</button>
      </div>
      <div class="debug-actions">
        <button class="debug-btn" title="清空" @click="onClear">
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

    <!-- Tab: Commands -->
    <div v-show="activeTab === 'commands'" class="debug-body">
      <div ref="cmdListEl" class="debug-list">
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
          暂无命令
        </div>
      </div>
    </div>

    <!-- Tab: Details -->
    <div v-show="activeTab === 'details'" class="debug-body">
      <div class="debug-detail">
        <template v-if="selected">
          <div class="detail-section">
            <div class="detail-label">Command</div>
            <pre class="detail-value">{{ selected.op }}</pre>
          </div>
          <div class="detail-section">
            <div class="detail-label">Status</div>
            <pre class="detail-value">{{ selected.status }}{{ selected.duration != null ? ` (${formatDuration(selected.duration)})` : '' }}</pre>
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
          在 Commands 中点击一条查看详情
        </div>
      </div>
    </div>

    <!-- Tab: Logs -->
    <div v-show="activeTab === 'logs'" class="debug-body">
      <div ref="logListEl" class="debug-list">
        <div
          v-for="entry in debugStore.logEntries"
          :key="entry.id"
          class="log-row"
          :class="logLevelClass(entry.level)"
        >
          <span class="debug-time">{{ formatTime(entry.ts) }}</span>
          <span class="log-level">{{ entry.level.toUpperCase() }}</span>
          <span class="log-msg">{{ entry.message }}</span>
        </div>
        <div v-if="debugStore.logEntries.length === 0" class="debug-empty">
          暂无日志
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
  padding: 0 4px 0 0;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.debug-tabs {
  display: flex;
  gap: 0;
}

.debug-tab {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-muted);
  font-size: 11px;
  font-family: inherit;
  padding: 6px 10px;
  border-bottom: 2px solid transparent;
  transition: color 0.15s, border-color 0.15s;
}

.debug-tab:hover {
  color: var(--text-secondary);
}

.debug-tab--active {
  color: var(--text-primary);
  border-bottom-color: var(--accent-blue);
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

.debug-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.debug-list {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}

/* ── Command rows ─────────────────────────────────────────── */
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

/* ── Log rows ─────────────────────────────────────────────── */
.log-row {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 2px 8px;
  font-size: 11px;
  font-family: 'SF Mono', 'Menlo', 'Monaco', monospace;
  line-height: 1.4;
}

.log-level {
  flex-shrink: 0;
  font-size: 9px;
  font-weight: 700;
  min-width: 36px;
  text-align: center;
  padding: 0 2px;
  border-radius: 2px;
  line-height: 1.6;
}

.log-msg {
  flex: 1;
  min-width: 0;
  color: var(--text-secondary);
  word-break: break-all;
}

.log-error .log-level {
  color: var(--accent-red);
  background: rgba(237, 135, 150, 0.12);
}
.log-error .log-msg { color: var(--accent-red); }

.log-warn .log-level {
  color: var(--accent-orange);
  background: rgba(238, 212, 159, 0.12);
}

.log-info .log-level {
  color: var(--accent-blue);
  background: rgba(138, 173, 244, 0.12);
}

.log-debug .log-level {
  color: var(--text-muted);
  background: rgba(110, 115, 141, 0.12);
}

/* ── Detail pane ──────────────────────────────────────────── */
.debug-detail {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
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
