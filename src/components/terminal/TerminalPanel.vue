<script setup lang="ts">
import { onMounted, onBeforeUnmount, reactive, ref, watch, computed, nextTick } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import '@xterm/xterm/css/xterm.css'
import { useI18n } from 'vue-i18n'
import { useUiStore } from '@/stores/ui'
import { useRepoStore } from '@/stores/repos'
import { useGitCommands } from '@/composables/useGitCommands'
import ContextMenu, { type ContextMenuItem } from '@/components/common/ContextMenu.vue'

const { t } = useI18n()
const uiStore = useUiStore()
const repoStore = useRepoStore()
const git = useGitCommands()

const hostEl = ref<HTMLDivElement | null>(null)

let term: Terminal | null = null
let fit: FitAddon | null = null
let sessionId: string | null = null
let unlistenData: UnlistenFn | null = null
let unlistenExit: UnlistenFn | null = null
let resizeObs: ResizeObserver | null = null
let resizeDebounce: number | null = null
let themeObs: MutationObserver | null = null
let disposed = false

// ── 右键菜单 ────────────────────────────────────────────────────────
const ctxMenu = reactive({
  visible: false,
  x: 0,
  y: 0,
})
const hasSelection = ref(false)

const ctxMenuItems = computed<ContextMenuItem[]>(() => [
  { label: t('terminal.menu.copy'), action: 'copy', disabled: !hasSelection.value },
  { label: t('terminal.menu.paste'), action: 'paste' },
  { separator: true },
  { label: t('terminal.menu.selectAll'), action: 'select-all' },
  { label: t('terminal.menu.clear'), action: 'clear' },
  { separator: true },
  { label: t('terminal.menu.close'), action: 'close', danger: true },
])

// ── base64 编解码 ────────────────────────────────────────────────────
function b64encode(s: string): string {
  // TextEncoder → bytes → btoa
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

function b64decodeToBytes(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

// ── 主题（从 CSS 变量取） ───────────────────────────────────────────
function isLightTheme(): boolean {
  return document.documentElement.getAttribute('data-theme') === 'light'
}

function readTheme() {
  const s = getComputedStyle(document.documentElement)
  const light = isLightTheme()
  // 深浅两套 16 色基调；accent-* 由 CSS 变量覆盖以保证和主题一致
  const base = light
    ? {
        black: '#32383f',
        red: '#cf222e',
        green: '#1a7f37',
        yellow: '#9a6700',
        blue: '#0969da',
        magenta: '#8250df',
        cyan: '#0550ae',
        white: '#6e7781',
        brightBlack: '#57606a',
        brightRed: '#cf222e',
        brightGreen: '#116329',
        brightYellow: '#633c01',
        brightBlue: '#0550ae',
        brightMagenta: '#8250df',
        brightCyan: '#1b7c83',
        brightWhite: '#1d1d1f',
      }
    : {
        black: '#494d64',
        red: '#ed8796',
        green: '#a6da95',
        yellow: '#eed49f',
        blue: '#8aadf4',
        magenta: '#c6a0f6',
        cyan: '#7dc4e4',
        white: '#b8c0e0',
        brightBlack: '#5b6078',
        brightRed: '#ed8796',
        brightGreen: '#a6da95',
        brightYellow: '#eed49f',
        brightBlue: '#8aadf4',
        brightMagenta: '#c6a0f6',
        brightCyan: '#7dc4e4',
        brightWhite: '#f5f7fa',
      }
  const accentRed = s.getPropertyValue('--accent-red').trim()
  const accentGreen = s.getPropertyValue('--accent-green').trim()
  const accentYellow = s.getPropertyValue('--accent-yellow').trim()
  const accentBlue = s.getPropertyValue('--accent-blue').trim()
  return {
    background: s.getPropertyValue('--bg-primary').trim() || (light ? '#ffffff' : '#13151f'),
    foreground: s.getPropertyValue('--text-primary').trim() || (light ? '#1d1d1f' : '#f5f7fa'),
    cursor: accentBlue || (light ? '#0969da' : '#4a9eff'),
    selectionBackground: light ? 'rgba(9, 105, 218, 0.25)' : 'rgba(138, 173, 244, 0.35)',
    ...base,
    red: accentRed || base.red,
    green: accentGreen || base.green,
    yellow: accentYellow || base.yellow,
    blue: accentBlue || base.blue,
  }
}

function applyTheme() {
  if (!term) return
  term.options.theme = readTheme()
}

// ── 生命周期 ────────────────────────────────────────────────────────
async function spawnSession() {
  if (!term || !fit) return
  const repoId = repoStore.activeRepoId
  if (!repoId) return
  // 保证容器已排版、fit 可拿到尺寸
  await nextTick()
  try { fit.fit() } catch {}
  const cols = term.cols || 80
  const rows = term.rows || 24
  try {
    sessionId = await git.terminalSpawn(repoId, cols, rows)
  } catch (e) {
    term.write(`\r\n[${t('terminal.spawnFailed')}] ${(e as Error).message}\r\n`)
  }
}

async function closeSession() {
  const id = sessionId
  sessionId = null
  if (id) {
    try { await git.terminalClose(id) } catch {}
  }
}

function scheduleResize() {
  if (resizeDebounce !== null) window.clearTimeout(resizeDebounce)
  resizeDebounce = window.setTimeout(() => {
    if (!fit || !term) return
    try { fit.fit() } catch {}
    if (sessionId) {
      git.terminalResize(sessionId, term.cols, term.rows).catch(() => {})
    }
  }, 80)
}

onMounted(async () => {
  if (!hostEl.value) return
  const theme = readTheme()
  term = new Terminal({
    fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--code-font-family').trim() || 'Menlo, monospace',
    fontSize: 13,
    cursorBlink: true,
    theme,
    scrollback: 5000,
    allowProposedApi: true,
  })
  fit = new FitAddon()
  term.loadAddon(fit)
  term.open(hostEl.value)
  try { fit.fit() } catch {}

  // 键盘输入 → PTY
  term.onData((d) => {
    if (!sessionId) return
    git.terminalWrite(sessionId, b64encode(d)).catch(() => {})
  })

  // 选区变化 → 控制"复制"菜单项是否可用
  term.onSelectionChange(() => {
    hasSelection.value = !!term?.hasSelection()
  })

  // PTY 输出 → 屏幕
  unlistenData = await listen<{ session_id: string; data: string }>(
    'terminal://data',
    (event) => {
      if (!sessionId || event.payload.session_id !== sessionId || !term) return
      const bytes = b64decodeToBytes(event.payload.data)
      term.write(bytes)
    },
  )
  unlistenExit = await listen<{ session_id: string }>(
    'terminal://exit',
    (event) => {
      if (!term) return
      if (event.payload.session_id === sessionId) {
        term.write('\r\n\x1b[33m[shell exited]\x1b[0m\r\n')
        sessionId = null
      }
    },
  )

  // 容器尺寸变化 → fit + resize PTY
  resizeObs = new ResizeObserver(() => scheduleResize())
  resizeObs.observe(hostEl.value)

  // 主题切换（:root[data-theme] 变化）→ 同步 xterm 主题
  themeObs = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'attributes' && m.attributeName === 'data-theme') {
        applyTheme()
        break
      }
    }
  })
  themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

  await spawnSession()
})

onBeforeUnmount(async () => {
  disposed = true
  if (resizeObs) { resizeObs.disconnect(); resizeObs = null }
  if (themeObs) { themeObs.disconnect(); themeObs = null }
  if (resizeDebounce !== null) window.clearTimeout(resizeDebounce)
  if (unlistenData) { unlistenData(); unlistenData = null }
  if (unlistenExit) { unlistenExit(); unlistenExit = null }
  await closeSession()
  if (term) { term.dispose(); term = null }
  fit = null
})

// 切换仓库：关旧 session，起新 session（保留 term 实例）
watch(
  () => repoStore.activeRepoId,
  async (id, old) => {
    if (disposed || !term) return
    if (id === old) return
    await closeSession()
    term.reset()
    if (id) await spawnSession()
  },
)

// 停靠切换：下一 tick 触发 fit+resize
watch(() => uiStore.terminalDock, () => scheduleResize())

// ── 停靠 resize handle ──────────────────────────────────────────────
function startResize(e: PointerEvent) {
  e.preventDefault()
  const dock = uiStore.terminalDock
  const startY = e.clientY
  const startX = e.clientX
  const startH = uiStore.terminalHeight
  const startW = uiStore.terminalWidth
  const MIN = 120
  const MAX_H = Math.max(200, window.innerHeight - 200)
  const MAX_W = Math.max(260, window.innerWidth - 320)
  const onMove = (ev: PointerEvent) => {
    if (dock === 'bottom') {
      const next = Math.max(MIN, Math.min(MAX_H, startH - (ev.clientY - startY)))
      uiStore.terminalHeight = next
    } else {
      const next = Math.max(MIN, Math.min(MAX_W, startW - (ev.clientX - startX)))
      uiStore.terminalWidth = next
    }
    scheduleResize()
  }
  const onUp = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    if (dock === 'bottom') uiStore.persistTerminalHeight()
    else uiStore.persistTerminalWidth()
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  document.body.style.cursor = dock === 'bottom' ? 'row-resize' : 'col-resize'
  document.body.style.userSelect = 'none'
}

const dockClass = computed(() => `terminal-panel--${uiStore.terminalDock}`)

function onToggleDock() {
  uiStore.toggleTerminalDock()
}

function onClose() {
  uiStore.setTerminalVisible(false)
}

// ── 右键菜单 handlers ───────────────────────────────────────────────
function onContextMenu(e: MouseEvent) {
  e.preventDefault()
  // 打开菜单前刷新一下选区状态，避免 onSelectionChange 遗漏
  hasSelection.value = !!term?.hasSelection()
  ctxMenu.x = e.clientX
  ctxMenu.y = e.clientY
  ctxMenu.visible = true
}

async function onCtxSelect(action: string) {
  ctxMenu.visible = false
  if (!term) return
  switch (action) {
    case 'copy': {
      const sel = term.getSelection()
      if (sel) {
        try { await navigator.clipboard.writeText(sel) } catch {}
      }
      break
    }
    case 'paste': {
      try {
        const text = await navigator.clipboard.readText()
        if (text && sessionId) {
          await git.terminalWrite(sessionId, b64encode(text))
        }
      } catch {}
      break
    }
    case 'select-all':
      term.selectAll()
      hasSelection.value = !!term.hasSelection()
      break
    case 'clear':
      // xterm 的 clear 把 viewport 清空但保留 scrollback；
      // 对交互式 shell 直接 reset 更接近"清屏"的直觉
      term.clear()
      break
    case 'close':
      onClose()
      break
  }
}
</script>

<template>
  <div class="terminal-panel" :class="dockClass">
    <div class="terminal-resize" @pointerdown="startResize" />
    <div class="terminal-header">
      <span class="terminal-title">Terminal</span>
      <div class="terminal-actions">
        <button
          class="term-btn"
          :title="uiStore.terminalDock === 'bottom' ? t('terminal.dockRight') : t('terminal.dockBottom')"
          @click="onToggleDock"
        >
          <svg v-if="uiStore.terminalDock === 'bottom'" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="1"/>
            <line x1="15" y1="3" x2="15" y2="21"/>
          </svg>
          <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="1"/>
            <line x1="3" y1="15" x2="21" y2="15"/>
          </svg>
        </button>
        <button class="term-btn" :title="t('terminal.close')" @click="onClose">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    </div>
    <div ref="hostEl" class="terminal-host" @contextmenu="onContextMenu" />

    <ContextMenu
      :visible="ctxMenu.visible"
      :x="ctxMenu.x"
      :y="ctxMenu.y"
      :items="ctxMenuItems"
      @close="ctxMenu.visible = false"
      @select="onCtxSelect"
    />
  </div>
</template>

<style scoped>
.terminal-panel {
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
  border-color: var(--border);
  border-style: solid;
  border-width: 0;
  overflow: hidden;
  position: relative;
  flex-shrink: 0;
}

.terminal-panel--bottom {
  border-top-width: 1px;
  width: 100%;
}

.terminal-panel--right {
  border-left-width: 1px;
  height: 100%;
}

/* Resize handle 贴在面板的「远离主内容」一侧之反面，即紧贴靠近主内容那条边 */
.terminal-resize {
  position: absolute;
  background: transparent;
  z-index: 5;
  transition: background 0.15s;
}
.terminal-panel--bottom .terminal-resize {
  top: 0;
  left: 0;
  right: 0;
  height: 5px;
  margin-top: -2px;
  cursor: row-resize;
}
.terminal-panel--right .terminal-resize {
  top: 0;
  bottom: 0;
  left: 0;
  width: 5px;
  margin-left: -2px;
  cursor: col-resize;
}
.terminal-resize:hover,
.terminal-resize:active {
  background: rgba(138, 173, 244, 0.3);
}

.terminal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  font-size: var(--font-sm);
  color: var(--text-secondary);
  flex-shrink: 0;
}

.terminal-title {
  font-weight: 600;
  letter-spacing: 0.5px;
  text-transform: uppercase;
}

.terminal-actions {
  display: flex;
  gap: 2px;
}

.term-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  border-radius: 3px;
}
.term-btn:hover {
  background: var(--bg-overlay);
  color: var(--text-primary);
}

.terminal-host {
  flex: 1;
  min-height: 0;
  min-width: 0;
  padding: 4px 6px 6px;
  overflow: hidden;
}

/* xterm 自身会渲染 canvas，给它留充足空间 */
:deep(.xterm) {
  height: 100%;
}
:deep(.xterm-viewport) {
  background-color: transparent !important;
}
</style>
