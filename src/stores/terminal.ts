import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { useGitCommands } from '@/composables/useGitCommands'
import { useRepoStore } from '@/stores/repos'
import { useUiStore } from '@/stores/ui'

export interface TerminalTab {
  id: string
  title: string
  sessionId: string | null
  term: Terminal
  fit: FitAddon
  hasSelection: boolean
}

export const useTerminalStore = defineStore('terminal', () => {
  // Keyed by repoId
  const repoTabs = ref<Map<string, TerminalTab[]>>(new Map())
  const activeTabId = ref<Map<string, string>>(new Map())
  
  const git = useGitCommands()
  const repoStore = useRepoStore()
  const uiStore = useUiStore()

  let unlistenData: UnlistenFn | null = null
  let unlistenExit: UnlistenFn | null = null

  // base64 decode utility
  function b64decodeToBytes(s: string): Uint8Array {
    const bin = atob(s)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  }

  function getTabsForRepo(repoId: string): TerminalTab[] {
    if (!repoTabs.value.has(repoId)) {
      repoTabs.value.set(repoId, [])
    }
    return repoTabs.value.get(repoId)!
  }

  function getActiveTab(repoId: string): TerminalTab | undefined {
    const tabs = getTabsForRepo(repoId)
    const activeId = activeTabId.value.get(repoId)
    return tabs.find(t => t.id === activeId) || tabs[0]
  }

  async function createTerminal(repoId: string, title?: string): Promise<TerminalTab> {
    const tabs = getTabsForRepo(repoId)
    const id = Math.random().toString(36).substring(2, 9)
    
    const term = new Terminal({
      fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--code-font-family').trim() || 'Menlo, monospace',
      fontSize: 13,
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: true,
      // theme will be set by the component when it mounts the terminal
    })
    
    const fit = new FitAddon()
    term.loadAddon(fit)
    
    const tab: TerminalTab = {
      id,
      title: title || `Tab ${tabs.length + 1}`,
      sessionId: null,
      term,
      fit,
      hasSelection: false
    }

    term.onData((data) => {
      if (tab.sessionId) {
        git.terminalWrite(tab.sessionId, btoa(unescape(encodeURIComponent(data)))).catch(() => {})
      }
    })

    term.onSelectionChange(() => {
      tab.hasSelection = !!term.hasSelection()
    })

    tabs.push(tab)
    activeTabId.value.set(repoId, id)
    
    // If the terminal panel is visible, spawn a session
    if (uiStore.terminalVisible) {
      await spawnSession(repoId, tab)
    }

    return tab
  }

  async function spawnSession(repoId: string, tab: TerminalTab) {
    if (tab.sessionId) return
    
    // We need cols/rows, but if not yet mounted, we might need a default
    // The component will call fit() and resize later.
    const cols = tab.term.cols || 80
    const rows = tab.term.rows || 24
    
    try {
      tab.sessionId = await git.terminalSpawn(repoId, cols, rows)
    } catch (e) {
      tab.term.write(`\r\n[Spawn Failed] ${(e as Error).message}\r\n`)
    }
  }

  async function closeTab(repoId: string, tabId: string) {
    const tabs = getTabsForRepo(repoId)
    const idx = tabs.findIndex(t => t.id === tabId)
    if (idx === -1) return
    
    const [tab] = tabs.splice(idx, 1)
    if (tab.sessionId) {
      await git.terminalClose(tab.sessionId).catch(() => {})
    }
    tab.term.dispose()
    
    if (activeTabId.value.get(repoId) === tabId) {
      const nextActive = tabs[Math.max(0, idx - 1)]
      if (nextActive) {
        activeTabId.value.set(repoId, nextActive.id)
      } else {
        activeTabId.value.delete(repoId)
      }
    }

    if (tabs.length === 0 && repoId === repoStore.activeRepoId) {
       uiStore.setTerminalVisible(false)
    }
  }

  function setActiveTab(repoId: string, tabId: string) {
    activeTabId.value.set(repoId, tabId)
  }

  async function initEvents() {
    if (unlistenData) return
    
    unlistenData = await listen<{ session_id: string; data: string }>(
      'terminal://data',
      (event) => {
        for (const tabs of repoTabs.value.values()) {
          const tab = tabs.find(t => t.sessionId === event.payload.session_id)
          if (tab) {
            tab.term.write(b64decodeToBytes(event.payload.data))
            break
          }
        }
      }
    )

    unlistenExit = await listen<{ session_id: string }>(
      'terminal://exit',
      (event) => {
        for (const [repoId, tabs] of repoTabs.value.entries()) {
          const tabIdx = tabs.findIndex(t => t.sessionId === event.payload.session_id)
          if (tabIdx !== -1) {
            const tab = tabs[tabIdx]
            tab.sessionId = null
            // Optional: auto-close tab or just show exited message
            tab.term.write('\r\n[Process exited]\r\n')
            break
          }
        }
      }
    )
  }

  function dispose() {
    if (unlistenData) unlistenData()
    if (unlistenExit) unlistenExit()
    unlistenData = null
    unlistenExit = null
    
    for (const tabs of repoTabs.value.values()) {
      for (const tab of tabs) {
        if (tab.sessionId) git.terminalClose(tab.sessionId).catch(() => {})
        tab.term.dispose()
      }
    }
    repoTabs.value.clear()
    activeTabId.value.clear()
  }

  return {
    repoTabs,
    activeTabId,
    getTabsForRepo,
    getActiveTab,
    createTerminal,
    closeTab,
    setActiveTab,
    spawnSession,
    initEvents,
    dispose
  }
})
