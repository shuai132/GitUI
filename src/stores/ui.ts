import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

// ── localStorage keys（集中管理） ───────────────────────────────────
const KEYS = {
  sidebarWidth: 'gitui.sidebar.width',
  reposHeight: 'gitui.sidebar.reposHeight',
  historyLayout: 'gitui.history.layout',
  showUnreachable: 'gitui.history.showUnreachable',
  showStashes: 'gitui.history.showStashes',
  historySizes: 'gitui.history.sizes',
  diffViewMode: 'gitui.diff.viewMode',
  diffHighlight: 'gitui.diff.syntax-highlight',
  dockLayout: 'gitui.history.dockLayout',
  customDockLayout: 'gitui.history.customDockLayout',
  layoutPreset: 'gitui.history.layoutPreset',
  debugPanel: 'gitui.debug.visible',
  terminalDock: 'gitui.terminal.dock',
  terminalHeight: 'gitui.terminal.height',
  terminalWidth: 'gitui.terminal.width',
  terminalVisible: 'gitui.terminal.visible',
} as const

// ── 读取工具 ──────────────────────────────────────────────────────────
function loadNumber(key: string, fallback: number): number {
  const v = localStorage.getItem(key)
  if (v === null) return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function loadBool(key: string, fallback: boolean): boolean {
  const v = localStorage.getItem(key)
  if (v === null) return fallback
  return v === 'true'
}

function loadString<T extends string>(key: string, fallback: T, allowed?: readonly T[]): T {
  const v = localStorage.getItem(key)
  if (v === null) return fallback
  if (allowed && !allowed.includes(v as T)) return fallback
  return v as T
}

function loadJson<T>(key: string, fallback: T): T {
  const raw = localStorage.getItem(key)
  if (!raw) return fallback
  try {
    return { ...fallback, ...JSON.parse(raw) }
  } catch {
    return fallback
  }
}

// ── 类型 ──────────────────────────────────────────────────────────────
export type HistoryLayoutMode = 'horizontal' | 'vertical'
export type LayoutPreset = 'custom' | 'vertical' | 'horizontal'
export type DiffViewMode = 'side-by-side' | 'inline' | 'by-hunk'
export type PanelId = 'commits' | 'info' | 'diff'
export type DockEdge = 'top' | 'bottom' | 'left' | 'right'

export interface DockLayout {
  spanning: PanelId
  edge: DockEdge
  first: PanelId
  second: PanelId
}

const DIFF_MODE_VALUES = ['side-by-side', 'inline', 'by-hunk'] as const

export type TerminalDock = 'bottom' | 'right'
const TERMINAL_DOCK_VALUES = ['bottom', 'right'] as const

const PRESET_LAYOUTS: Record<string, DockLayout> = {
  vertical:   { spanning: 'commits', edge: 'top',  first: 'info', second: 'diff' },
  horizontal: { spanning: 'commits', edge: 'left', first: 'info', second: 'diff' },
}
const DEFAULT_DOCK_LAYOUT: DockLayout = PRESET_LAYOUTS.vertical

export interface HistoryPaneSizes {
  /** horizontal 布局：commit 列占比（%） */
  commitPanePct: number
  /** vertical 布局：info 列占比（%） */
  infoPanePct: number
  /** horizontal 布局：diff 区高度占比（%） */
  diffRowPct: number
  /** vertical 布局：commit 行高度占比（%） */
  commitRowPct: number
  /** commit 列表 - 描述列宽（可拖动，用于整体左右移动右侧三列组） */
  descColW: number
  /** commit 列表 - hash 列宽 */
  hashColW: number
  /** commit 列表 - author 列宽 */
  authorColW: number
  /** commit 列表 - date 列宽 */
  dateColW: number
  /** commit 列表 - date2 列宽 */
  dateCol2W: number
  /** CommitInfoPanel 头部区（summary + body + meta-grid）高度（px）；0 = 自适应 */
  commitInfoTopH: number
}

const DEFAULT_HISTORY_SIZES: HistoryPaneSizes = {
  commitPanePct: 55,
  infoPanePct: 38,
  diffRowPct: 70,
  commitRowPct: 55,
  descColW: 400,
  hashColW: 64,
  authorColW: 240,
  dateColW: 170,
  dateCol2W: 170,
  commitInfoTopH: 0,
}

// ── Store ─────────────────────────────────────────────────────────────
export const useUiStore = defineStore('ui', () => {
  // 粘性请求：从 Actions 菜单转发 "丢弃所有变更" 给 WipPanel
  const shouldOpenDiscardAll = ref(false)

  // 提交历史搜索词（不持久化）
  const historySearchQuery = ref('')

  // ── 持久化字段 ────────────────────────────────────────────────────
  const sidebarWidth = ref<number>(loadNumber(KEYS.sidebarWidth, 220))
  const reposHeight = ref<number>(loadNumber(KEYS.reposHeight, 160))

  // 迁移旧 historyLayout key → dockLayout
  if (!localStorage.getItem(KEYS.dockLayout) && localStorage.getItem(KEYS.historyLayout)) {
    const old = localStorage.getItem(KEYS.historyLayout)
    const migrated = old === 'horizontal' ? PRESET_LAYOUTS.horizontal : PRESET_LAYOUTS.vertical
    localStorage.setItem(KEYS.dockLayout, JSON.stringify(migrated))
  }

  const dockLayout = ref<DockLayout>(
    loadJson<DockLayout>(KEYS.dockLayout, DEFAULT_DOCK_LAYOUT),
  )

  const customDockLayout = ref<DockLayout>(
    loadJson<DockLayout>(KEYS.customDockLayout, DEFAULT_DOCK_LAYOUT),
  )

  const LAYOUT_PRESET_VALUES = ['custom', 'vertical', 'horizontal'] as const
  const layoutPreset = ref<LayoutPreset>(
    loadString<LayoutPreset>(KEYS.layoutPreset, 'custom', LAYOUT_PRESET_VALUES),
  )

  // 向后兼容：派生只读 historyLayoutMode
  const historyLayoutMode = computed<HistoryLayoutMode>(() => {
    const e = dockLayout.value.edge
    return (e === 'left' || e === 'right') ? 'horizontal' : 'vertical'
  })

  const showUnreachableCommits = ref<boolean>(loadBool(KEYS.showUnreachable, true))
  const showStashCommits = ref<boolean>(loadBool(KEYS.showStashes, true))

  const historyPaneSizes = ref<HistoryPaneSizes>(
    loadJson<HistoryPaneSizes>(KEYS.historySizes, DEFAULT_HISTORY_SIZES),
  )

  const diffViewMode = ref<DiffViewMode>(
    loadString<DiffViewMode>(KEYS.diffViewMode, 'side-by-side', DIFF_MODE_VALUES),
  )
  const diffHighlightEnabled = ref<boolean>(loadBool(KEYS.diffHighlight, true))
  const debugPanelVisible = ref<boolean>(loadBool(KEYS.debugPanel, false))

  // ── Terminal 偏好 ─────────────────────────────────────────────────
  const terminalDock = ref<TerminalDock>(
    loadString<TerminalDock>(KEYS.terminalDock, 'bottom', TERMINAL_DOCK_VALUES),
  )
  const terminalHeight = ref<number>(loadNumber(KEYS.terminalHeight, 260))
  const terminalWidth = ref<number>(loadNumber(KEYS.terminalWidth, 420))
  const terminalVisible = ref<boolean>(loadBool(KEYS.terminalVisible, false))

  // ── 持久化动作 ────────────────────────────────────────────────────
  // 拖动类：组件在 pointermove 里直接改 .value，pointerup 再调 persistXxx()
  function persistSidebarWidth() {
    localStorage.setItem(KEYS.sidebarWidth, String(sidebarWidth.value))
  }

  function persistReposHeight() {
    localStorage.setItem(KEYS.reposHeight, String(reposHeight.value))
  }

  function persistHistoryPaneSizes() {
    localStorage.setItem(KEYS.historySizes, JSON.stringify(historyPaneSizes.value))
  }

  // Toggle / setter 类：直接写入
  /** 拖拽停靠时调用：更新当前布局 + 保存为自定义布局 */
  function setDockLayout(layout: DockLayout) {
    dockLayout.value = layout
    localStorage.setItem(KEYS.dockLayout, JSON.stringify(layout))
    // 拖拽产生的布局自动归入自定义
    customDockLayout.value = layout
    localStorage.setItem(KEYS.customDockLayout, JSON.stringify(layout))
    layoutPreset.value = 'custom'
    localStorage.setItem(KEYS.layoutPreset, 'custom')
  }

  /** 循环切换：自定义 → 上下 → 左右 → 自定义 */
  function toggleHistoryLayout() {
    const order: LayoutPreset[] = ['custom', 'vertical', 'horizontal']
    const idx = order.indexOf(layoutPreset.value)
    const next = order[(idx + 1) % order.length]
    layoutPreset.value = next
    localStorage.setItem(KEYS.layoutPreset, next)

    let layout: DockLayout
    if (next === 'custom') {
      layout = customDockLayout.value
    } else {
      layout = PRESET_LAYOUTS[next]
    }
    dockLayout.value = layout
    localStorage.setItem(KEYS.dockLayout, JSON.stringify(layout))
  }

  function toggleShowUnreachable() {
    showUnreachableCommits.value = !showUnreachableCommits.value
    localStorage.setItem(KEYS.showUnreachable, String(showUnreachableCommits.value))
  }

  function toggleShowStashes() {
    showStashCommits.value = !showStashCommits.value
    localStorage.setItem(KEYS.showStashes, String(showStashCommits.value))
  }

  function setDiffViewMode(mode: DiffViewMode) {
    diffViewMode.value = mode
    localStorage.setItem(KEYS.diffViewMode, mode)
  }

  function toggleDiffHighlight() {
    diffHighlightEnabled.value = !diffHighlightEnabled.value
    localStorage.setItem(KEYS.diffHighlight, String(diffHighlightEnabled.value))
  }

  function toggleDebugPanel() {
    debugPanelVisible.value = !debugPanelVisible.value
    localStorage.setItem(KEYS.debugPanel, String(debugPanelVisible.value))
  }

  // ── Terminal 偏好动作 ─────────────────────────────────────────────
  function setTerminalDock(dock: TerminalDock) {
    terminalDock.value = dock
    localStorage.setItem(KEYS.terminalDock, dock)
  }

  function toggleTerminalDock() {
    setTerminalDock(terminalDock.value === 'bottom' ? 'right' : 'bottom')
  }

  function persistTerminalHeight() {
    localStorage.setItem(KEYS.terminalHeight, String(terminalHeight.value))
  }

  function persistTerminalWidth() {
    localStorage.setItem(KEYS.terminalWidth, String(terminalWidth.value))
  }

  function setTerminalVisible(v: boolean) {
    terminalVisible.value = v
    localStorage.setItem(KEYS.terminalVisible, String(v))
  }

  function toggleTerminalVisible() {
    setTerminalVisible(!terminalVisible.value)
  }

  // ── WipPanel 粘性请求 ─────────────────────────────────────────────
  function requestDiscardAll() {
    shouldOpenDiscardAll.value = true
  }

  function consumeDiscardAllRequest() {
    shouldOpenDiscardAll.value = false
  }

  return {
    // state
    shouldOpenDiscardAll,
    historySearchQuery,
    sidebarWidth,
    reposHeight,
    dockLayout,
    layoutPreset,
    historyLayoutMode,
    showUnreachableCommits,
    showStashCommits,
    historyPaneSizes,
    diffViewMode,
    diffHighlightEnabled,
    debugPanelVisible,
    terminalDock,
    terminalHeight,
    terminalWidth,
    terminalVisible,
    // persistence
    persistSidebarWidth,
    persistReposHeight,
    persistHistoryPaneSizes,
    persistTerminalHeight,
    persistTerminalWidth,
    // setters / togglers
    setDockLayout,
    toggleHistoryLayout,
    toggleShowUnreachable,
    toggleShowStashes,
    setDiffViewMode,
    toggleDiffHighlight,
    toggleDebugPanel,
    setTerminalDock,
    toggleTerminalDock,
    setTerminalVisible,
    toggleTerminalVisible,
    // transient
    requestDiscardAll,
    consumeDiscardAllRequest,
  }
})
