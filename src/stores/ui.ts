import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import {
  moveFileOrderPaths,
  normalizeFileOrderPrefsByRepoPath,
  type FileOrderBucket,
  type FileOrderPlacement,
  type FileOrderPrefsByRepoPath,
} from '@/utils/fileOrderPrefs'

// ── localStorage keys（集中管理） ───────────────────────────────────
const KEYS = {
  sidebarWidth: 'gitui.sidebar.width',
  reposHeight: 'gitui.sidebar.reposHeight',
  historyLayout: 'gitui.history.layout',
  showUnreachable: 'gitui.history.showUnreachable',
  showStashes: 'gitui.history.showStashes',
  historyBranchScopeByRepoPath: 'gitui.history.branchScopeByRepoPath',
  showRemoteBranches: 'gitui.history.showRemoteBranches',
  historySizes: 'gitui.history.sizes',
  historyColumnOrder: 'gitui.history.columnOrder',
  defaultRemoteByRepoPath: 'gitui.remote.defaultByRepoPath',
  changedFileOrderByRepoPath: 'gitui.changedFiles.orderByRepoPath',
  showChangeStatsColumn: 'gitui.history.showChangeStatsColumn',
  diffViewMode: 'gitui.diff.viewMode',
  diffLayoutMode: 'gitui.diff.layoutMode',
  diffGroupByHunk: 'gitui.diff.groupByHunk',
  diffHighlight: 'gitui.diff.syntax-highlight',
  dockLayout: 'gitui.history.dockLayout',
  customDockLayout: 'gitui.history.customDockLayout',
  layoutPreset: 'gitui.history.layoutPreset',
  debugPanel: 'gitui.debug.visible',
  terminalDock: 'gitui.terminal.dock',
  terminalHeight: 'gitui.terminal.height',
  terminalWidth: 'gitui.terminal.width',
  terminalVisible: 'gitui.terminal.visible',
  detailFilesFirst: 'gitui.history.detailFilesFirst',
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

function loadJsonArray<T extends string>(key: string, fallback: readonly T[], allowed: readonly T[]): T[] {
  const raw = localStorage.getItem(key)
  if (!raw) return [...fallback]
  try {
    return normalizeHistoryColumnOrder(JSON.parse(raw), allowed, fallback)
  } catch {
    return [...fallback]
  }
}

// ── 类型 ──────────────────────────────────────────────────────────────
export type HistoryLayoutMode = 'horizontal' | 'vertical'
export type HistoryBranchScope = 'all' | 'current_first_parent'
export type LayoutPreset = 'custom' | 'vertical' | 'horizontal'
export type LegacyDiffViewMode = 'side-by-side' | 'inline' | 'by-hunk'
export type DiffLayoutMode = 'side-by-side' | 'inline'
export type PanelId = 'commits' | 'info' | 'diff'
export type DockEdge = 'top' | 'bottom' | 'left' | 'right'
export type HistoryColumnId = 'description' | 'changes' | 'commit' | 'author' | 'date'

export interface DockLayout {
  spanning: PanelId
  edge: DockEdge
  first: PanelId
  second: PanelId
}

const LEGACY_DIFF_MODE_VALUES = ['side-by-side', 'inline', 'by-hunk'] as const
const DIFF_LAYOUT_VALUES = ['side-by-side', 'inline'] as const
const HISTORY_BRANCH_SCOPE_VALUES = ['all', 'current_first_parent'] as const
export const DEFAULT_HISTORY_COLUMN_ORDER: readonly HistoryColumnId[] = [
  'description',
  'changes',
  'commit',
  'author',
  'date',
]
const HISTORY_COLUMN_VALUES = DEFAULT_HISTORY_COLUMN_ORDER

export type TerminalDock = 'bottom' | 'right'
const TERMINAL_DOCK_VALUES = ['bottom', 'right'] as const

export const DEFAULT_ADVANCED_VIEW_PREFS = {
  diffLayoutMode: 'inline' as DiffLayoutMode,
  diffGroupByHunk: true,
  diffHighlightEnabled: true,
  showRemoteBranches: true,
  showChangeStatsColumn: false,
  showUnreachableCommits: true,
  showStashCommits: true,
  debugPanelVisible: false,
  detailFilesFirst: true,
} as const
const DEFAULT_HISTORY_BRANCH_SCOPE: HistoryBranchScope = 'all'

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
  /** commit 列表 - change stats 列宽 */
  statsColW: number
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
  statsColW: 150,
  hashColW: 64,
  authorColW: 240,
  dateColW: 170,
  dateCol2W: 16,
  commitInfoTopH: 0,
}

export function normalizeHistoryColumnOrder<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: readonly T[] = allowed,
): T[] {
  if (!Array.isArray(value)) return [...fallback]

  const allowedSet = new Set<T>(allowed)
  const seen = new Set<T>()
  const normalized: T[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const col = item as T
    if (!allowedSet.has(col) || seen.has(col)) continue
    seen.add(col)
    normalized.push(col)
  }
  for (const col of fallback) {
    if (!seen.has(col)) normalized.push(col)
  }
  return normalized
}

export function moveHistoryColumn<T extends string>(
  order: readonly T[],
  from: T,
  to: T,
  placement: 'before' | 'after' = 'before',
): T[] {
  const fromIndex = order.indexOf(from)
  const toIndex = order.indexOf(to)
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return [...order]

  const next = [...order]
  const [moved] = next.splice(fromIndex, 1)
  const targetIndex = next.indexOf(to)
  next.splice(placement === 'after' ? targetIndex + 1 : targetIndex, 0, moved)
  return next
}

function loadHistoryBranchScopeByRepoPath(): Record<string, HistoryBranchScope> {
  const raw = localStorage.getItem(KEYS.historyBranchScopeByRepoPath)
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

    const result: Record<string, HistoryBranchScope> = {}
    for (const [repoPath, scope] of Object.entries(parsed)) {
      if (
        typeof repoPath === 'string' &&
        repoPath.length > 0 &&
        typeof scope === 'string' &&
        (HISTORY_BRANCH_SCOPE_VALUES as readonly string[]).includes(scope)
      ) {
        result[repoPath] = scope as HistoryBranchScope
      }
    }
    return result
  } catch {
    return {}
  }
}

function loadDefaultRemoteByRepoPath(): Record<string, string> {
  const raw = localStorage.getItem(KEYS.defaultRemoteByRepoPath)
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

    const result: Record<string, string> = {}
    for (const [repoPath, remoteName] of Object.entries(parsed)) {
      if (
        typeof repoPath === 'string' &&
        repoPath.length > 0 &&
        typeof remoteName === 'string' &&
        remoteName.length > 0
      ) {
        result[repoPath] = remoteName
      }
    }
    return result
  } catch {
    return {}
  }
}

function loadChangedFileOrderByRepoPath(): FileOrderPrefsByRepoPath {
  const raw = localStorage.getItem(KEYS.changedFileOrderByRepoPath)
  if (!raw) return {}
  try {
    return normalizeFileOrderPrefsByRepoPath(JSON.parse(raw))
  } catch {
    return {}
  }
}

// ── Store ─────────────────────────────────────────────────────────────
export const useUiStore = defineStore('ui', () => {
  // 粘性请求：从 Actions 菜单转发 "丢弃所有变更" 给 WipPanel
  const shouldOpenDiscardAll = ref(false)

  // 提交历史搜索词（不持久化）
  const historySearchQuery = ref('')

  // Diff 搜索词（不持久化）
  const diffSearchQuery = ref('')

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

  const showUnreachableCommits = ref<boolean>(
    loadBool(KEYS.showUnreachable, DEFAULT_ADVANCED_VIEW_PREFS.showUnreachableCommits),
  )
  const showStashCommits = ref<boolean>(
    loadBool(KEYS.showStashes, DEFAULT_ADVANCED_VIEW_PREFS.showStashCommits),
  )
  const historyBranchScopeByRepoPath = ref<Record<string, HistoryBranchScope>>(
    loadHistoryBranchScopeByRepoPath(),
  )
  const defaultRemoteByRepoPath = ref<Record<string, string>>(
    loadDefaultRemoteByRepoPath(),
  )
  const changedFileOrderByRepoPath = ref<FileOrderPrefsByRepoPath>(
    loadChangedFileOrderByRepoPath(),
  )
  const showRemoteBranches = ref<boolean>(
    loadBool(KEYS.showRemoteBranches, DEFAULT_ADVANCED_VIEW_PREFS.showRemoteBranches),
  )
  const historyColumnOrder = ref<HistoryColumnId[]>(
    loadJsonArray<HistoryColumnId>(
      KEYS.historyColumnOrder,
      DEFAULT_HISTORY_COLUMN_ORDER,
      HISTORY_COLUMN_VALUES,
    ),
  )
  const showChangeStatsColumn = ref<boolean>(
    loadBool(KEYS.showChangeStatsColumn, DEFAULT_ADVANCED_VIEW_PREFS.showChangeStatsColumn),
  )

  const historyPaneSizes = ref<HistoryPaneSizes>(
    loadJson<HistoryPaneSizes>(KEYS.historySizes, DEFAULT_HISTORY_SIZES),
  )
  // 旧版默认 170px，纯占位列没必要这么宽；超过阈值视为旧默认，迁移到新默认。
  if (historyPaneSizes.value.dateCol2W > 40) {
    historyPaneSizes.value.dateCol2W = DEFAULT_HISTORY_SIZES.dateCol2W
    localStorage.setItem(KEYS.historySizes, JSON.stringify(historyPaneSizes.value))
  }

  const hasLegacyDiffViewMode = localStorage.getItem(KEYS.diffViewMode) !== null
  const legacyDiffViewMode = loadString<LegacyDiffViewMode>(
    KEYS.diffViewMode,
    'inline',
    LEGACY_DIFF_MODE_VALUES,
  )
  const legacyDiffLayoutMode: DiffLayoutMode =
    legacyDiffViewMode === 'side-by-side'
      ? 'side-by-side'
      : DEFAULT_ADVANCED_VIEW_PREFS.diffLayoutMode
  const diffLayoutMode = ref<DiffLayoutMode>(
    loadString<DiffLayoutMode>(KEYS.diffLayoutMode, legacyDiffLayoutMode, DIFF_LAYOUT_VALUES),
  )
  const diffGroupByHunk = ref<boolean>(
    loadBool(
      KEYS.diffGroupByHunk,
      hasLegacyDiffViewMode
        ? legacyDiffViewMode === 'by-hunk'
        : DEFAULT_ADVANCED_VIEW_PREFS.diffGroupByHunk,
    ),
  )
  const diffHighlightEnabled = ref<boolean>(
    loadBool(KEYS.diffHighlight, DEFAULT_ADVANCED_VIEW_PREFS.diffHighlightEnabled),
  )
  const debugPanelVisible = ref<boolean>(
    loadBool(KEYS.debugPanel, DEFAULT_ADVANCED_VIEW_PREFS.debugPanelVisible),
  )

  // ── Terminal 偏好 ─────────────────────────────────────────────────
  const terminalDock = ref<TerminalDock>(
    loadString<TerminalDock>(KEYS.terminalDock, 'bottom', TERMINAL_DOCK_VALUES),
  )
  const terminalHeight = ref<number>(loadNumber(KEYS.terminalHeight, 260))
  const terminalWidth = ref<number>(loadNumber(KEYS.terminalWidth, 420))
  const terminalVisible = ref<boolean>(loadBool(KEYS.terminalVisible, false))
  const detailFilesFirst = ref<boolean>(
    loadBool(KEYS.detailFilesFirst, DEFAULT_ADVANCED_VIEW_PREFS.detailFilesFirst),
  )

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

  function persistHistoryBranchScopeByRepoPath(scopes: Record<string, HistoryBranchScope>) {
    const entries = Object.entries(scopes).filter(
      ([, scope]) => scope !== DEFAULT_HISTORY_BRANCH_SCOPE,
    )
    if (entries.length === 0) {
      localStorage.removeItem(KEYS.historyBranchScopeByRepoPath)
      return
    }
    localStorage.setItem(
      KEYS.historyBranchScopeByRepoPath,
      JSON.stringify(Object.fromEntries(entries)),
    )
  }

  function getHistoryBranchScope(repoPath: string | null | undefined): HistoryBranchScope {
    if (!repoPath) return DEFAULT_HISTORY_BRANCH_SCOPE
    return historyBranchScopeByRepoPath.value[repoPath] ?? DEFAULT_HISTORY_BRANCH_SCOPE
  }

  function setHistoryBranchScopeForRepo(
    repoPath: string | null | undefined,
    scope: HistoryBranchScope,
  ) {
    if (!repoPath) return
    const next = { ...historyBranchScopeByRepoPath.value }
    if (scope === DEFAULT_HISTORY_BRANCH_SCOPE) {
      delete next[repoPath]
    } else {
      next[repoPath] = scope
    }
    historyBranchScopeByRepoPath.value = next
    persistHistoryBranchScopeByRepoPath(next)
  }

  function toggleHistoryBranchScopeForRepo(repoPath: string | null | undefined) {
    const current = getHistoryBranchScope(repoPath)
    setHistoryBranchScopeForRepo(
      repoPath,
      current === 'all' ? 'current_first_parent' : 'all',
    )
  }

  function persistDefaultRemoteByRepoPath(defaults: Record<string, string>) {
    if (Object.keys(defaults).length === 0) {
      localStorage.removeItem(KEYS.defaultRemoteByRepoPath)
      return
    }
    localStorage.setItem(KEYS.defaultRemoteByRepoPath, JSON.stringify(defaults))
  }

  function getDefaultRemote(repoPath: string | null | undefined): string | null {
    if (!repoPath) return null
    return defaultRemoteByRepoPath.value[repoPath] ?? null
  }

  function setDefaultRemoteForRepo(
    repoPath: string | null | undefined,
    remoteName: string,
  ) {
    if (!repoPath || !remoteName) return
    const next = { ...defaultRemoteByRepoPath.value, [repoPath]: remoteName }
    defaultRemoteByRepoPath.value = next
    persistDefaultRemoteByRepoPath(next)
  }

  function clearDefaultRemoteForRepo(repoPath: string | null | undefined) {
    if (!repoPath) return
    const next = { ...defaultRemoteByRepoPath.value }
    delete next[repoPath]
    defaultRemoteByRepoPath.value = next
    persistDefaultRemoteByRepoPath(next)
  }

  function persistChangedFileOrderByRepoPath(prefs: FileOrderPrefsByRepoPath) {
    const normalized = normalizeFileOrderPrefsByRepoPath(prefs)
    if (Object.keys(normalized).length === 0) {
      localStorage.removeItem(KEYS.changedFileOrderByRepoPath)
      return
    }
    localStorage.setItem(KEYS.changedFileOrderByRepoPath, JSON.stringify(normalized))
  }

  function getChangedFileOrder(repoPath: string | null | undefined): FileOrderBucket {
    if (!repoPath) return { front: [], back: [] }
    const bucket = changedFileOrderByRepoPath.value[repoPath]
    return bucket ? { front: [...bucket.front], back: [...bucket.back] } : { front: [], back: [] }
  }

  function moveChangedFilesForRepo(
    repoPath: string | null | undefined,
    filePaths: readonly string[],
    placement: FileOrderPlacement,
  ) {
    if (!repoPath) return
    const current = getChangedFileOrder(repoPath)
    const nextBucket = moveFileOrderPaths(current, filePaths, placement)
    const nextPrefs = { ...changedFileOrderByRepoPath.value }
    if (nextBucket.front.length === 0 && nextBucket.back.length === 0) {
      delete nextPrefs[repoPath]
    } else {
      nextPrefs[repoPath] = nextBucket
    }
    changedFileOrderByRepoPath.value = nextPrefs
    persistChangedFileOrderByRepoPath(nextPrefs)
  }

  function toggleShowRemoteBranches() {
    showRemoteBranches.value = !showRemoteBranches.value
    localStorage.setItem(KEYS.showRemoteBranches, String(showRemoteBranches.value))
  }

  function setHistoryColumnOrder(order: readonly HistoryColumnId[]) {
    historyColumnOrder.value = normalizeHistoryColumnOrder(
      order,
      HISTORY_COLUMN_VALUES,
      DEFAULT_HISTORY_COLUMN_ORDER,
    )
    localStorage.setItem(KEYS.historyColumnOrder, JSON.stringify(historyColumnOrder.value))
  }

  function moveHistoryColumnTo(from: HistoryColumnId, to: HistoryColumnId, placement: 'before' | 'after') {
    setHistoryColumnOrder(moveHistoryColumn(historyColumnOrder.value, from, to, placement))
  }

  function toggleShowChangeStatsColumn() {
    showChangeStatsColumn.value = !showChangeStatsColumn.value
    localStorage.setItem(KEYS.showChangeStatsColumn, String(showChangeStatsColumn.value))
  }

  function setDiffLayoutMode(mode: DiffLayoutMode) {
    diffLayoutMode.value = mode
    localStorage.setItem(KEYS.diffLayoutMode, mode)
  }

  function setDiffGroupByHunk(value: boolean) {
    diffGroupByHunk.value = value
    localStorage.setItem(KEYS.diffGroupByHunk, String(value))
  }

  function toggleDiffGroupByHunk() {
    setDiffGroupByHunk(!diffGroupByHunk.value)
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

  function toggleDetailFilesFirst() {
    detailFilesFirst.value = !detailFilesFirst.value
    localStorage.setItem(KEYS.detailFilesFirst, String(detailFilesFirst.value))
  }

  function resetAdvancedViewPrefs() {
    diffLayoutMode.value = DEFAULT_ADVANCED_VIEW_PREFS.diffLayoutMode
    diffGroupByHunk.value = DEFAULT_ADVANCED_VIEW_PREFS.diffGroupByHunk
    diffHighlightEnabled.value = DEFAULT_ADVANCED_VIEW_PREFS.diffHighlightEnabled
    showRemoteBranches.value = DEFAULT_ADVANCED_VIEW_PREFS.showRemoteBranches
    showChangeStatsColumn.value = DEFAULT_ADVANCED_VIEW_PREFS.showChangeStatsColumn
    showUnreachableCommits.value = DEFAULT_ADVANCED_VIEW_PREFS.showUnreachableCommits
    showStashCommits.value = DEFAULT_ADVANCED_VIEW_PREFS.showStashCommits
    debugPanelVisible.value = DEFAULT_ADVANCED_VIEW_PREFS.debugPanelVisible
    detailFilesFirst.value = DEFAULT_ADVANCED_VIEW_PREFS.detailFilesFirst

    localStorage.setItem(KEYS.diffLayoutMode, diffLayoutMode.value)
    localStorage.setItem(KEYS.diffGroupByHunk, String(diffGroupByHunk.value))
    localStorage.setItem(KEYS.diffHighlight, String(diffHighlightEnabled.value))
    localStorage.setItem(KEYS.showRemoteBranches, String(showRemoteBranches.value))
    localStorage.setItem(KEYS.showChangeStatsColumn, String(showChangeStatsColumn.value))
    localStorage.setItem(KEYS.showUnreachable, String(showUnreachableCommits.value))
    localStorage.setItem(KEYS.showStashes, String(showStashCommits.value))
    localStorage.setItem(KEYS.debugPanel, String(debugPanelVisible.value))
    localStorage.setItem(KEYS.detailFilesFirst, String(detailFilesFirst.value))
  }

  // ── WipPanel 粘性请求 ─────────────────────────────────────────────
  function requestDiscardAll() {
    shouldOpenDiscardAll.value = true
  }

  function consumeDiscardAllRequest() {
    shouldOpenDiscardAll.value = false
  }

  // ── 全局面板打开信号 ────────────────────────────────────────────
  // 使用 counter 而非 boolean，这样同一面板可以重复触发而不需要手动 reset
  const openSettingsSignal = ref(0)
  function requestOpenSettings() {
    openSettingsSignal.value++
  }

  const openSearchSignal = ref(0)
  function requestOpenSearch() {
    openSearchSignal.value++
  }

  const openRepoSearchSignal = ref(0)
  function requestOpenRepoSearch() {
    openRepoSearchSignal.value++
  }

  const focusCommitMessageSignal = ref(0)
  function requestFocusCommitMessage() {
    focusCommitMessageSignal.value++
  }

  const openDiffSearchSignal = ref(0)
  function requestOpenDiffSearch() {
    openDiffSearchSignal.value++
  }

  const fetchSignal = ref(0)
  const fetchTarget = ref<string | null>(null)
  function requestFetch(target: string | null = null) {
    fetchTarget.value = target
    fetchSignal.value++
  }

  return {
    // state
    shouldOpenDiscardAll,
    historySearchQuery,
    diffSearchQuery,
    sidebarWidth,
    reposHeight,
    dockLayout,
    layoutPreset,
    historyLayoutMode,
    showUnreachableCommits,
    showStashCommits,
    historyBranchScopeByRepoPath,
    defaultRemoteByRepoPath,
    changedFileOrderByRepoPath,
    showRemoteBranches,
    historyColumnOrder,
    showChangeStatsColumn,
    historyPaneSizes,
    diffLayoutMode,
    diffGroupByHunk,
    diffHighlightEnabled,
    debugPanelVisible,
    terminalDock,
    terminalHeight,
    terminalWidth,
    terminalVisible,
    detailFilesFirst,
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
    getHistoryBranchScope,
    setHistoryBranchScopeForRepo,
    toggleHistoryBranchScopeForRepo,
    getDefaultRemote,
    setDefaultRemoteForRepo,
    clearDefaultRemoteForRepo,
    getChangedFileOrder,
    moveChangedFilesForRepo,
    toggleShowRemoteBranches,
    setHistoryColumnOrder,
    moveHistoryColumnTo,
    toggleShowChangeStatsColumn,
    setDiffLayoutMode,
    setDiffGroupByHunk,
    toggleDiffGroupByHunk,
    toggleDiffHighlight,
    toggleDebugPanel,
    setTerminalDock,
    toggleTerminalDock,
    setTerminalVisible,
    toggleTerminalVisible,
    toggleDetailFilesFirst,
    resetAdvancedViewPrefs,
    // transient
    requestDiscardAll,
    consumeDiscardAllRequest,
    openSettingsSignal,
    requestOpenSettings,
    openSearchSignal,
    requestOpenSearch,
    openRepoSearchSignal,
    requestOpenRepoSearch,
    focusCommitMessageSignal,
    requestFocusCommitMessage,
    openDiffSearchSignal,
    requestOpenDiffSearch,
    fetchSignal,
    fetchTarget,
    requestFetch,
  }
})
