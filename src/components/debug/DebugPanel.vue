<script setup lang="ts">
import { ref, nextTick, watch } from 'vue'
import { useDebugStore, type DebugEntry } from '@/stores/debug'
import { useUiStore } from '@/stores/ui'

const debugStore = useDebugStore()
const uiStore = useUiStore()

const expandedId = ref<number | null>(null)
const topPct = ref(50)
const cmdListEl = ref<HTMLElement | null>(null)
const logListEl = ref<HTMLElement | null>(null)

function toggleExpand(entry: DebugEntry) {
  expandedId.value = expandedId.value === entry.id ? null : entry.id
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

/** IPC op + args → 等价 git 命令行 */
function toGitCommand(entry: DebugEntry): string | null {
  const a = entry.args ?? {}
  switch (entry.op) {
    case 'push_branch':
      return `git push ${a.remoteName ?? 'origin'} ${a.branchName ?? ''}`
    case 'pull_branch': {
      const mode = a.mode as string | undefined
      if (mode === 'rebase') return `git pull --rebase ${a.remoteName ?? 'origin'} ${a.branchName ?? ''}`
      if (mode === 'ff_only') return `git pull --ff-only ${a.remoteName ?? 'origin'} ${a.branchName ?? ''}`
      return `git pull ${a.remoteName ?? 'origin'} ${a.branchName ?? ''}`
    }
    case 'fetch_remote':
      return `git fetch ${a.remoteName ?? 'origin'}`
    case 'create_commit':
      return `git commit -m "${truncate(String(a.message ?? ''), 40)}"`
    case 'amend_commit':
      return `git commit --amend -m "${truncate(String(a.message ?? ''), 40)}"`
    case 'stage_file':
      return `git add ${a.filePath ?? ''}`
    case 'unstage_file':
      return `git restore --staged ${a.filePath ?? ''}`
    case 'stage_all':
      return 'git add -A'
    case 'unstage_all':
      return 'git reset HEAD'
    case 'switch_branch':
      return `git switch ${a.name ?? ''}`
    case 'create_branch':
      return `git branch ${a.name ?? ''}${a.fromOid ? ' ' + a.fromOid : ''}`
    case 'delete_branch':
      return `git branch -d ${a.name ?? ''}`
    case 'checkout_commit':
      return `git checkout ${shortOid(a.oid)}`
    case 'checkout_remote_branch':
      return `git checkout -b ${a.localName ?? ''} ${a.remoteBranch ?? ''}${a.track ? ' --track' : ''}`
    case 'cherry_pick_commit':
      return `git cherry-pick ${shortOid(a.oid)}`
    case 'revert_commit':
      return `git revert ${shortOid(a.oid)}`
    case 'reset_to_commit':
      return `git reset --${a.mode ?? 'mixed'} ${shortOid(a.oid)}`
    case 'create_tag':
      return a.message
        ? `git tag -a ${a.name ?? ''} ${shortOid(a.oid)} -m "${truncate(String(a.message), 30)}"`
        : `git tag ${a.name ?? ''} ${shortOid(a.oid)}`
    case 'stash_push':
      return a.message ? `git stash push -m "${a.message}"` : 'git stash push'
    case 'stash_pop':
      return 'git stash pop'
    case 'stash_list':
      return 'git stash list'
    case 'discard_all_changes':
      return 'git checkout -- . && git clean -fd'
    case 'discard_file':
      return `git checkout -- ${a.filePath ?? ''}`
    case 'get_status':
      return 'git status'
    case 'list_branches':
      return 'git branch -a'
    case 'get_log':
      return 'git log'
    case 'get_file_diff':
      return `git diff${a.staged ? ' --cached' : ''} -- ${a.filePath ?? ''}`
    case 'list_remotes':
      return 'git remote'
    case 'get_reflog':
      return 'git reflog'
    case 'run_gc':
      return 'git gc'
    case 'init_submodule':
      return `git submodule init ${a.name ?? ''}`
    case 'update_submodule':
      return `git submodule update ${a.name ?? ''}`
    case 'deinit_submodule':
      return `git submodule deinit ${a.name ?? ''}`
    default:
      return null
  }
}

function shortOid(oid: unknown): string {
  const s = String(oid ?? '')
  return s.length > 8 ? s.slice(0, 8) : s
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '...' : s
}

function formatArgs(args?: Record<string, unknown>): string {
  if (!args) return '(no args)'
  return JSON.stringify(args, null, 2)
}

function onClearCmds() {
  debugStore.clear()
}

function onClearLogs() {
  debugStore.clearLogs()
}

// Auto-scroll
watch(() => debugStore.entries[0]?.id, () => {
  nextTick(() => { if (cmdListEl.value) cmdListEl.value.scrollTop = 0 })
})
watch(() => debugStore.logEntries[0]?.id, () => {
  nextTick(() => { if (logListEl.value) logListEl.value.scrollTop = 0 })
})

// ── Resize handle ─────────────────────────────────────────
function startResize(e: PointerEvent) {
  e.preventDefault()
  const panel = (e.currentTarget as HTMLElement).closest('.debug-panel')!
  const startY = e.clientY
  const startPct = topPct.value
  const panelH = panel.getBoundingClientRect().height

  const onMove = (ev: PointerEvent) => {
    const delta = ev.clientY - startY
    const deltaPct = (delta / panelH) * 100
    topPct.value = Math.max(15, Math.min(85, startPct + deltaPct))
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
      <button class="debug-btn" title="关闭" @click="uiStore.toggleDebugPanel()">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>

    <!-- Top: Commands (with inline expandable detail) -->
    <div class="debug-section" :style="{ flex: `0 0 ${topPct}%` }">
      <div class="section-bar">
        <span class="section-label">Commands</span>
        <button class="debug-btn" title="清空命令" @click="onClearCmds">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
        </button>
      </div>
      <div ref="cmdListEl" class="debug-list">
        <template v-for="entry in debugStore.entries" :key="entry.id">
          <div
            class="debug-row"
            :class="{
              'debug-row--selected': expandedId === entry.id,
              'debug-row--error': entry.status === 'error',
            }"
            @click="toggleExpand(entry)"
          >
            <span class="debug-time">{{ formatTime(entry.ts) }}</span>
            <span class="debug-op">{{ entry.op }}</span>
            <span class="debug-dur">{{ formatDuration(entry.duration) }}</span>
            <span class="debug-status" :class="statusClass(entry.status)">{{ statusIcon(entry.status) }}</span>
          </div>
          <!-- Inline detail (expanded) -->
          <div v-if="expandedId === entry.id" class="detail-inline" @click.stop>
            <pre v-if="toGitCommand(entry)" class="detail-git" @click.stop>$ {{ toGitCommand(entry) }}</pre>
            <pre class="detail-args" @click.stop>{{ formatArgs(entry.args) }}</pre>
            <pre v-if="entry.error" class="detail-error" @click.stop>{{ entry.error }}</pre>
          </div>
        </template>
        <div v-if="debugStore.entries.length === 0" class="debug-empty">暂无命令</div>
      </div>
    </div>

    <!-- Resize handle -->
    <div class="debug-split" @pointerdown="startResize" />

    <!-- Bottom: Logs -->
    <div class="debug-section debug-section--bottom">
      <div class="section-bar">
        <span class="section-label">Logs</span>
        <button class="debug-btn" title="清空日志" @click="onClearLogs">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
        </button>
      </div>
      <div ref="logListEl" class="debug-list">
        <div
          v-for="entry in debugStore.logEntries"
          :key="entry.id"
          class="log-row"
          :class="logLevelClass(entry.level)"
        >
          <span class="log-level">{{ entry.level.charAt(0).toUpperCase() }}</span>
          <span class="log-msg">{{ entry.message }}</span>
        </div>
        <div v-if="debugStore.logEntries.length === 0" class="debug-empty">暂无日志</div>
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
  user-select: text;
  -webkit-user-select: text;
}

.debug-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 6px;
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

/* ── Section ──────────────────────────────────────────────── */
.debug-section {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 48px;
}

.debug-section--bottom {
  flex: 1;
}

.section-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 3px 8px 3px 8px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.section-label {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.debug-list {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}

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
  background: rgba(138, 173, 244, 0.12);
  border-left-color: var(--accent-blue);
}

.debug-row--error {
  color: var(--accent-red);
}

.debug-time {
  color: var(--text-muted);
  font-size: 10px;
  flex-shrink: 0;
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
  min-width: 36px;
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

/* ── Inline detail ────────────────────────────────────────── */
.detail-inline {
  padding: 4px 8px 6px 12px;
  background: var(--bg-secondary);
  border-left: 2px solid var(--accent-blue);
  font-family: 'SF Mono', 'Menlo', 'Monaco', monospace;
  font-size: 11px;
  line-height: 1.4;
}

.detail-git {
  color: var(--accent-green);
  margin: 0 0 2px;
  white-space: pre-wrap;
  word-break: break-all;
}

.detail-args {
  color: var(--text-muted);
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
  font-size: 10px;
}

.detail-error {
  color: var(--accent-red);
  margin: 4px 0 0;
  white-space: pre-wrap;
  word-break: break-all;
}

/* ── Log rows ─────────────────────────────────────────────── */
.log-row {
  display: flex;
  align-items: baseline;
  gap: 4px;
  padding: 1px 8px;
  font-size: 11px;
  font-family: 'SF Mono', 'Menlo', 'Monaco', monospace;
  white-space: nowrap;
  overflow: hidden;
}

.log-level {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 700;
  width: 12px;
  text-align: center;
}

.log-msg {
  flex: 1;
  min-width: 0;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
}

.log-error .log-level { color: var(--accent-red); }
.log-error .log-msg { color: var(--accent-red); }
.log-warn .log-level { color: var(--accent-orange); }
.log-info .log-level { color: var(--accent-blue); }
.log-debug .log-level { color: var(--text-muted); }
.log-debug .log-msg { color: var(--text-muted); }

.debug-empty {
  padding: 12px 8px;
  text-align: center;
  color: var(--text-muted);
  font-size: 11px;
}
</style>
