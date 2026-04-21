<script setup lang="ts">
import { onMounted, onBeforeUnmount, reactive, ref, watch, computed, nextTick } from 'vue'
import '@xterm/xterm/css/xterm.css'
import { useI18n } from 'vue-i18n'
import { useUiStore } from '@/stores/ui'
import { useRepoStore } from '@/stores/repos'
import { useTerminalStore, type TerminalTab } from '@/stores/terminal'
import ContextMenu, { type ContextMenuItem } from '@/components/common/ContextMenu.vue'
import { useGitCommands } from '@/composables/useGitCommands'

const { t } = useI18n()
const uiStore = useUiStore()
const repoStore = useRepoStore()
const terminalStore = useTerminalStore()
const git = useGitCommands()

const hostEls = new Map<string, HTMLDivElement>() // key: tabId
let activeResizeObs: ResizeObserver | null = null
let resizeDebounce: number | null = null
let themeObs: MutationObserver | null = null
let disposed = false

const currentRepoId = computed(() => repoStore.activeRepoId)
const currentTabs = computed(() => currentRepoId.value ? terminalStore.getTabsForRepo(currentRepoId.value) : [])
const activeTab = computed(() => currentRepoId.value ? terminalStore.getActiveTab(currentRepoId.value) : undefined)

const ctxMenu = reactive({ visible: false, x: 0, y: 0 })
const ctxMenuItems = computed<ContextMenuItem[]>(() => [
  { label: t('terminal.menu.copy'), action: 'copy', disabled: !activeTab.value?.hasSelection },
  { label: t('terminal.menu.paste'), action: 'paste' },
  { separator: true },
  { label: t('terminal.menu.selectAll'), action: 'select-all' },
  { label: t('terminal.menu.clear'), action: 'clear' },
  { separator: true },
  { label: t('terminal.menu.close'), action: 'close' },
])

function b64encode(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

function readTheme() {
  const s = getComputedStyle(document.documentElement)
  const isLight = document.documentElement.getAttribute('data-theme') === 'light'
  const accentBlue = s.getPropertyValue('--accent-blue').trim()
  return {
    background: s.getPropertyValue('--bg-primary').trim(),
    foreground: s.getPropertyValue('--text-primary').trim(),
    cursor: accentBlue,
    selectionBackground: isLight ? 'rgba(9, 105, 218, 0.25)' : 'rgba(138, 173, 244, 0.35)',
    black: '#32383f',
    red: s.getPropertyValue('--accent-red').trim(),
    green: s.getPropertyValue('--accent-green').trim(),
    yellow: s.getPropertyValue('--accent-yellow').trim(),
    blue: accentBlue,
    magenta: '#8250df',
    cyan: '#0550ae',
    white: '#6e7781',
  }
}

function applyTheme() {
  const theme = readTheme()
  for (const tabs of terminalStore.repoTabs.values()) {
    for (const tab of tabs) tab.term.options.theme = theme
  }
}

function setHostEl(tabId: string, el: HTMLDivElement | null) {
  if (el) {
    hostEls.set(tabId, el)
    if (tabId === activeTab.value?.id && uiStore.terminalVisible) {
      nextTick(() => mountTerminal(tabId))
    }
  } else {
    hostEls.delete(tabId)
  }
}

function mountTerminal(tabId: string) {
  const el = hostEls.get(tabId)
  const tab = currentTabs.value.find(t => t.id === tabId)
  if (!el || !tab) return
  if ((tab.term as any)._core?.element === el) return

  // Prevent xterm.js from falling into an infinite ResizeObserver/Refresh loop 
  // by never opening it inside a hidden (display: none) container.
  if (el.clientWidth === 0 || el.clientHeight === 0) return

  tab.term.options.theme = readTheme()
  tab.term.open(el)
  nextTick(() => { if (!disposed) try { tab.fit.fit() } catch {} })
}

function scheduleResize() {
  if (resizeDebounce !== null) window.clearTimeout(resizeDebounce)
  resizeDebounce = window.setTimeout(() => {
    const tab = activeTab.value
    if (!tab || disposed || !uiStore.terminalVisible) return
    const el = hostEls.get(tab.id)
    if (!el || el.clientWidth === 0 || el.clientHeight === 0) return
    try {
      tab.fit.fit()
      if (tab.sessionId) {
        git.terminalResize(tab.sessionId, tab.term.cols, tab.term.rows).catch(() => {})
      }
    } catch (e) {}
  }, 100)
}

function setupResizeObserver(tabId: string) {
  if (activeResizeObs) { activeResizeObs.disconnect(); activeResizeObs = null }
  const el = hostEls.get(tabId)
  if (!el || disposed) return
  activeResizeObs = new ResizeObserver(() => scheduleResize())
  activeResizeObs.observe(el)
}

onMounted(async () => {
  await terminalStore.initEvents()
  themeObs = new MutationObserver(() => applyTheme())
  themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

  const id = currentRepoId.value
  if (id && uiStore.terminalVisible) {
    if (terminalStore.getTabsForRepo(id).length === 0) await terminalStore.createTerminal(id)
    const tab = terminalStore.getActiveTab(id)
    if (tab) { 
      nextTick(() => {
        mountTerminal(tab.id)
        setupResizeObserver(tab.id)
        scheduleResize()
      })
    }
  }
})

onBeforeUnmount(() => {
  disposed = true
  if (activeResizeObs) activeResizeObs.disconnect()
  if (themeObs) themeObs.disconnect()
  if (resizeDebounce !== null) window.clearTimeout(resizeDebounce)
})

watch(() => repoStore.activeRepoId, async (id) => {
  if (disposed || !id || !uiStore.terminalVisible) return
  if (terminalStore.getTabsForRepo(id).length === 0) await terminalStore.createTerminal(id)
  const tab = terminalStore.getActiveTab(id)
  if (tab) { 
    nextTick(() => {
      mountTerminal(tab.id)
      setupResizeObserver(tab.id)
      scheduleResize()
    })
  }
})

watch(() => activeTab.value?.id, (id) => {
  if (id) {
    nextTick(() => {
      mountTerminal(id)
      setupResizeObserver(id)
      scheduleResize()
      activeTab.value?.term.focus()
    })
  }
})

watch(() => uiStore.terminalVisible, async (v) => {
  const id = currentRepoId.value
  if (v && id) {
    if (terminalStore.getTabsForRepo(id).length === 0) await terminalStore.createTerminal(id)
    const tab = terminalStore.getActiveTab(id)
    if (tab) { 
      nextTick(() => {
        mountTerminal(tab.id)
        setupResizeObserver(tab.id)
        scheduleResize()
        tab.term.focus()
      })
    }
  }
})

watch(() => uiStore.terminalDock, () => scheduleResize())

async function onAddTab() { if (currentRepoId.value) await terminalStore.createTerminal(currentRepoId.value) }
function onCloseTab(tabId: string) { if (currentRepoId.value) terminalStore.closeTab(currentRepoId.value, tabId) }
function onSelectTab(tabId: string) { if (currentRepoId.value) terminalStore.setActiveTab(currentRepoId.value, tabId) }
function onToggleDock() { uiStore.toggleTerminalDock() }
function onClosePanel() { uiStore.setTerminalVisible(false) }

function startResize(e: PointerEvent) {
  e.preventDefault()
  const dock = uiStore.terminalDock
  const startPos = dock === 'bottom' ? e.clientY : e.clientX
  const startSize = dock === 'bottom' ? uiStore.terminalHeight : uiStore.terminalWidth
  const onMove = (ev: PointerEvent) => {
    const delta = (dock === 'bottom' ? ev.clientY : ev.clientX) - startPos
    const next = Math.max(120, startSize - delta)
    if (dock === 'bottom') uiStore.terminalHeight = next
    else uiStore.terminalWidth = next
    scheduleResize()
  }
  const onUp = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    if (dock === 'bottom') uiStore.persistTerminalHeight()
    else uiStore.persistTerminalWidth()
  }
  window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp)
}

function onContextMenu(e: MouseEvent) {
  e.preventDefault(); ctxMenu.x = e.clientX; ctxMenu.y = e.clientY; ctxMenu.visible = true
}

async function onCtxSelect(action: string) {
  ctxMenu.visible = false
  const tab = activeTab.value
  if (!tab) return
  if (action === 'copy') {
    const sel = tab.term.getSelection()
    if (sel) await navigator.clipboard.writeText(sel)
  } else if (action === 'paste') {
    const text = await navigator.clipboard.readText()
    if (text && tab.sessionId) git.terminalWrite(tab.sessionId, b64encode(text))
  } else if (action === 'select-all') tab.term.selectAll()
  else if (action === 'clear') tab.term.clear()
  else if (action === 'close') onClosePanel()
}
</script>

<template>
  <div class="terminal-panel" :class="`terminal-panel--${uiStore.terminalDock}`">
    <div class="terminal-resize" @pointerdown="startResize" />
    <div class="terminal-header">
      <div class="terminal-tabs">
        <div v-for="tab in currentTabs" :key="tab.id" class="terminal-tab"
          :class="{ active: tab.id === activeTab?.id }" @click="onSelectTab(tab.id)">
          <span class="tab-title">{{ tab.title }}</span>
          <button class="tab-close" @click.stop="onCloseTab(tab.id)">
            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <button class="add-tab-btn" :title="t('terminal.newTab')" @click="onAddTab">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
        </button>
      </div>
      <div class="terminal-actions">
        <button class="term-btn" @click="onToggleDock">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="1"/>
            <line v-if="uiStore.terminalDock === 'bottom'" x1="15" y1="3" x2="15" y2="21"/>
            <line v-else x1="3" y1="15" x2="21" y2="15"/>
          </svg>
        </button>
        <button class="term-btn" @click="onClosePanel">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    </div>
    <div class="terminal-content">
      <!-- 使用 v-show 保持所有实例，确保切换顺畅且不丢失状态 -->
      <div v-for="tab in currentTabs" :key="tab.id" class="terminal-host"
        v-show="tab.id === activeTab?.id" :ref="el => setHostEl(tab.id, el as HTMLDivElement)"
        @contextmenu="onContextMenu" />
    </div>
    <ContextMenu :visible="ctxMenu.visible" :x="ctxMenu.x" :y="ctxMenu.y" :items="ctxMenuItems"
      @close="ctxMenu.visible = false" @select="onCtxSelect" />
  </div>
</template>

<style scoped>
.terminal-panel {
  display: flex; flex-direction: column; background: var(--bg-primary);
  border-color: var(--border); border-style: solid; border-width: 0;
  overflow: hidden; position: relative; flex-shrink: 0;
}
.terminal-panel--bottom { border-top-width: 1px; width: 100%; }
.terminal-panel--right { border-left-width: 1px; height: 100%; }
.terminal-resize { position: absolute; background: transparent; z-index: 5; transition: background 0.15s; }
.terminal-panel--bottom .terminal-resize { top: 0; left: 0; right: 0; height: 5px; margin-top: -2px; cursor: row-resize; }
.terminal-panel--right .terminal-resize { top: 0; bottom: 0; left: 0; width: 5px; margin-left: -2px; cursor: col-resize; }
.terminal-resize:hover { background: rgba(138, 173, 244, 0.3); }
.terminal-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 2px 0 0; background: var(--bg-secondary);
  border-bottom: 1px solid var(--border); height: 20px;
}
.terminal-tabs { display: flex; align-items: center; height: 100%; overflow: hidden; }
.terminal-tab {
  display: flex; align-items: center; height: 100%; padding: 0 4px 0 8px;
  cursor: pointer; background: var(--bg-secondary); color: var(--text-muted);
  font-size: 10px; max-width: 120px; min-width: 40px; position: relative;
  border-right: 1px solid var(--border); transition: background 0.1s;
}
.terminal-tab.active { background: var(--bg-primary); color: var(--text-primary); }
.terminal-tab.active::after {
  content: ''; position: absolute; top: 0; left: 0; right: 0; height: 1px; background: var(--accent-blue);
}
.tab-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-right: 2px; }
.tab-close {
  display: inline-flex; align-items: center; justify-content: center; width: 11px; height: 11px;
  border: none; background: transparent; color: var(--text-muted); border-radius: 2px;
  opacity: 0; transition: opacity 0.1s;
}
.terminal-tab:hover .tab-close, .terminal-tab.active .tab-close { opacity: 1; }
.tab-close:hover { background: var(--bg-overlay); color: var(--text-primary); }
.add-tab-btn, .term-btn {
  display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px;
  border: none; background: transparent; color: var(--text-muted); cursor: pointer; border-radius: 3px;
}
.add-tab-btn:hover, .term-btn:hover { background: var(--bg-overlay); color: var(--text-primary); }

.terminal-content { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.terminal-host { flex: 1; min-height: 0; min-width: 0; padding: 4px 6px 6px; overflow: hidden; }

:deep(.xterm) { height: 100%; }
:deep(.xterm-viewport) { background-color: transparent !important; }
</style>