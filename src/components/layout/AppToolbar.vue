<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { listen } from '@tauri-apps/api/event'
import { useRepoStore } from '@/stores/repos'
import { useHistoryStore } from '@/stores/history'
import { useStashStore } from '@/stores/stash'
import { useWorkspaceStore } from '@/stores/workspace'
import { useUiStore } from '@/stores/ui'
import { useErrorsStore } from '@/stores/errors'
import { resolveExternalTerminalApp, useSettingsStore } from '@/stores/settings'
import { useGitCommands } from '@/composables/useGitCommands'
import { useRepoCreation } from '@/composables/useRepoCreation'
import ReflogDialog from '@/components/common/ReflogDialog.vue'
import ErrorHistoryDialog from '@/components/common/ErrorHistoryDialog.vue'
import Modal from '@/components/common/Modal.vue'
import ContextMenu, { type ContextMenuItem } from '@/components/common/ContextMenu.vue'
import SettingsModal from '@/components/settings/SettingsModal.vue'
import AboutInfo from '@/components/common/AboutInfo.vue'

const repoStore = useRepoStore()
const historyStore = useHistoryStore()
const stashStore = useStashStore()
const workspaceStore = useWorkspaceStore()
const uiStore = useUiStore()
const errorsStore = useErrorsStore()
const settingsStore = useSettingsStore()
const git = useGitCommands()
const repoCreation = useRepoCreation()
const appWindow = getCurrentWindow()
const { t } = useI18n()

// ── IPC 错误自动弹 toast ─────────────────────────────────────────
// errorsStore 由 useGitCommands.call() 统一 push。watch latestId 即可。
const OP_LABELS: Record<string, () => string> = {
  pull_branch: () => t('toolbar.opLabels.pull'),
  push_branch: () => t('toolbar.opLabels.push'),
  fetch_remote: () => t('toolbar.opLabels.fetch'),
  stash_push: () => t('toolbar.opLabels.stash'),
  stash_pop: () => t('toolbar.opLabels.stashPop'),
  run_gc: () => t('toolbar.opLabels.gc'),
  open_repo: () => t('toolbar.opLabels.openRepo'),
  checkout_commit: () => t('toolbar.opLabels.checkoutCommit'),
  cherry_pick_commit: () => t('toolbar.opLabels.cherryPick'),
  revert_commit: () => t('toolbar.opLabels.revert'),
  reset_to_commit: () => t('toolbar.opLabels.reset'),
  create_branch: () => t('toolbar.opLabels.createBranch'),
  switch_branch: () => t('toolbar.opLabels.switchBranch'),
  delete_branch: () => t('toolbar.opLabels.deleteBranch'),
  checkout_remote_branch: () => t('toolbar.opLabels.checkoutRemoteBranch'),
  create_commit: () => t('toolbar.opLabels.commit'),
  amend_commit: () => t('toolbar.opLabels.amend'),
  create_tag: () => t('toolbar.opLabels.createTag'),
  discard_all_changes: () => t('toolbar.opLabels.discardAll'),
  discard_file: () => t('toolbar.opLabels.discardFile'),
  open_terminal: () => t('toolbar.opLabels.openTerminal'),
  init_submodule: () => t('toolbar.opLabels.initSubmodule'),
  update_submodule: () => t('toolbar.opLabels.updateSubmodule'),
  set_submodule_url: () => t('toolbar.opLabels.setSubmoduleUrl'),
  deinit_submodule: () => t('toolbar.opLabels.deinitSubmodule'),
}

watch(
  () => errorsStore.latestId,
  (id) => {
    if (!id) return
    const entry = errorsStore.entries[0]
    if (!entry) return
    const label = OP_LABELS[entry.op]?.()
    showError(label ? t('toolbar.opFailed', { label, message: entry.friendly }) : entry.friendly)
  },
)

// ── 每个按钮的 loading 状态 ────────────────────────────────────────
const busy = reactive({
  pull: false,
  push: false,
  stash: false,
  pop: false,
  fetch: false,
  gc: false,
})

// ── Pull 模式 ─────────────────────────────────────────────────────
type PullMode = 'ff' | 'ff_only' | 'rebase'
const PULL_MODE_KEY = 'gitui.pull.mode'
const pullMode = ref<PullMode>(
  (localStorage.getItem(PULL_MODE_KEY) as PullMode) || 'ff',
)

function setPullMode(mode: PullMode) {
  pullMode.value = mode
  localStorage.setItem(PULL_MODE_KEY, mode)
}

const pullModeMenu = reactive({
  visible: false,
  x: 0,
  y: 0,
})

const pullModeMenuItems = computed<ContextMenuItem[]>(() => [
  {
    label: `${pullMode.value === 'ff' ? '● ' : '○ '}${t('toolbar.pullMode.ff')}`,
    action: 'ff',
  },
  {
    label: `${pullMode.value === 'ff_only' ? '● ' : '○ '}${t('toolbar.pullMode.ffOnly')}`,
    action: 'ff_only',
  },
  {
    label: `${pullMode.value === 'rebase' ? '● ' : '○ '}${t('toolbar.pullMode.rebase')}`,
    action: 'rebase',
  },
])

function onPullChevronClick(e: MouseEvent) {
  e.stopPropagation()
  if (pullModeMenu.visible) {
    pullModeMenu.visible = false
    return
  }
  const el = e.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  pullModeMenu.x = rect.left
  pullModeMenu.y = rect.bottom + 4
  pullModeMenu.visible = true
}

function onPullModeSelect(action: string) {
  pullModeMenu.visible = false
  setPullMode(action as PullMode)
}

// ── Push 模式 ─────────────────────────────────────────────────────
type PushMode = 'normal' | 'force_with_lease' | 'force'
const PUSH_MODE_KEY = 'gitui.push.mode'
const pushMode = ref<PushMode>(
  (localStorage.getItem(PUSH_MODE_KEY) as PushMode) || 'normal',
)

function setPushMode(mode: PushMode) {
  pushMode.value = mode
  localStorage.setItem(PUSH_MODE_KEY, mode)
}

const pushModeMenu = reactive({
  visible: false,
  x: 0,
  y: 0,
})

const pushModeMenuItems = computed<ContextMenuItem[]>(() => [
  {
    label: `${pushMode.value === 'normal' ? '● ' : '○ '}${t('toolbar.pushMode.normal')}`,
    action: 'normal',
  },
  {
    label: `${pushMode.value === 'force_with_lease' ? '● ' : '○ '}${t('toolbar.pushMode.forceWithLease')}`,
    action: 'force_with_lease',
  },
  {
    label: `${pushMode.value === 'force' ? '● ' : '○ '}${t('toolbar.pushMode.force')}`,
    action: 'force',
  },
])

function onPushChevronClick(e: MouseEvent) {
  e.stopPropagation()
  if (pushModeMenu.visible) {
    pushModeMenu.visible = false
    return
  }
  const el = e.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  pushModeMenu.x = rect.left
  pushModeMenu.y = rect.bottom + 4
  pushModeMenu.visible = true
}

function onPushModeSelect(action: string) {
  pushModeMenu.visible = false
  setPushMode(action as PushMode)
}

const showReflogDialog = ref(false)
const showErrorHistoryDialog = ref(false)
const showAboutDialog = ref(false)
const showSettingsDialog = ref(false)
const searchInputEl = ref<HTMLInputElement | null>(null)
const searchExpanded = ref(false)

onMounted(() => {
  // 监听系统菜单栏的"关于"菜单
  listen('show-about', () => {
    showAboutDialog.value = true
  })
})

function expandSearch() {
  searchExpanded.value = true
  // 等 input 渲染后聚焦
  setTimeout(() => searchInputEl.value?.focus(), 0)
}

function onSearchBlur() {
  // 有内容时保持展开；无内容时收起
  if (!uiStore.historySearchQuery) {
    searchExpanded.value = false
  }
}

function onSearchKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    uiStore.historySearchQuery = ''
    searchExpanded.value = false
    searchInputEl.value?.blur()
  }
}

// ── 主题切换 ─────────────────────────────────────────────────────
// 以当前实际生效（解析后）的主题为准在 light ↔ dark 之间切换。
// auto 档下也按当前呈现切到明确的另一侧，需要恢复 auto 可去设置里改。
const resolvedTheme = computed<'light' | 'dark'>(() => {
  const mode = settingsStore.themeMode
  if (mode !== 'auto') return mode
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return 'dark'
})

function toggleTheme() {
  settingsStore.themeMode = resolvedTheme.value === 'dark' ? 'light' : 'dark'
}

// ── 仓库已打开时按钮才可用 ────────────────────────────────────────
const hasRepo = computed(() => !!repoStore.activeRepoId)

const currentBranch = computed(
  () =>
    historyStore.branches.find((b) => b.is_head && !b.is_remote)?.name ?? null,
)

const canRemoteOp = computed(() => hasRepo.value && currentBranch.value !== null)
const canStash = computed(() => {
  if (!hasRepo.value) return false
  const s = workspaceStore.status
  if (!s) return false
  // 后端 stash_push 用的是 INCLUDE_UNTRACKED，untracked 也会被 stash
  return s.staged.length + s.unstaged.length + s.untracked.length > 0
})
const canStashPop = computed(() => hasRepo.value && stashStore.entries.length > 0)

// ── 工具栏全局错误展示（浮层） ─────────────────────────────────────
const toastError = ref<string | null>(null)
let toastTimer: number | null = null
function showError(msg: string) {
  toastError.value = msg
  if (toastTimer !== null) window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    toastError.value = null
    toastTimer = null
  }, 4000)
}

// ── Helpers ────────────────────────────────────────────────────────
// 多 remote 选择菜单：pickRemote 复用同一个 ContextMenu，resolve 回传
const remoteMenu = reactive({
  visible: false,
  x: 0,
  y: 0,
  items: [] as ContextMenuItem[],
  resolve: null as ((remote: string | null) => void) | null,
})

async function pickRemote(anchorRect?: DOMRect): Promise<string | null> {
  const id = repoStore.activeRepoId
  if (!id) return null
  let remotes: string[]
  try {
    remotes = await git.listRemotes(id)
  } catch {
    return null
  }
  if (remotes.length === 0) return null
  if (remotes.length === 1) return remotes[0]

  // 多 remote：弹菜单让用户显式选择
  return new Promise<string | null>((resolve) => {
    remoteMenu.items = remotes.map((name) => ({ label: name, action: name }))
    if (anchorRect) {
      remoteMenu.x = anchorRect.left
      remoteMenu.y = anchorRect.bottom + 4
    } else {
      // 没有 anchor 就用 actions 按钮作为兜底参考
      const el = actionsBtnRef.value
      const rect = el?.getBoundingClientRect()
      remoteMenu.x = rect ? rect.right - 160 : 80
      remoteMenu.y = rect ? rect.bottom + 4 : 80
    }
    remoteMenu.resolve = resolve
    remoteMenu.visible = true
  })
}

function onRemoteMenuSelect(action: string) {
  remoteMenu.visible = false
  const fn = remoteMenu.resolve
  remoteMenu.resolve = null
  fn?.(action)
}

function onRemoteMenuClose() {
  // 点外部关闭视为取消
  remoteMenu.visible = false
  const fn = remoteMenu.resolve
  remoteMenu.resolve = null
  fn?.(null)
}

// ── 添加仓库 ────────────────────────────────────────────────────────
// 单按钮「新建」，点击直接弹菜单（打开 / 克隆 / 新建），
// 与侧栏 + 按钮行为一致。
function showAddRepoMenu(e: MouseEvent) {
  repoCreation.showMenuAt(e.currentTarget as HTMLElement)
}

// ── Pull ────────────────────────────────────────────────────────────
async function onPull(e: MouseEvent) {
  const id = repoStore.activeRepoId
  const branch = currentBranch.value
  if (!id || !branch) return
  const rect = (e.currentTarget as HTMLElement | null)?.getBoundingClientRect()
  const remote = await pickRemote(rect)
  if (!remote) {
    // 区分 "没配 remote" 与 "用户取消选择"：只有 remotes 为空时才显示错误。
    // 这里简单处理：listRemotes 返回 0 时 showError；取消不提示。
    const remotes = await git.listRemotes(id).catch(() => [])
    if (remotes.length === 0) showError(t('toolbar.noRemoteConfigured'))
    return
  }
  busy.pull = true
  try {
    await git.pullBranch(id, remote, branch, pullMode.value)
    await Promise.all([historyStore.loadLog(), historyStore.loadBranches()])
  } catch {
    /* toast 由 errorsStore watch 统一处理 */
  } finally {
    busy.pull = false
  }
}

// ── Push ────────────────────────────────────────────────────────────
async function onPush(e: MouseEvent) {
  const id = repoStore.activeRepoId
  const branch = currentBranch.value
  if (!id || !branch) return
  const rect = (e.currentTarget as HTMLElement | null)?.getBoundingClientRect()
  const remote = await pickRemote(rect)
  if (!remote) {
    const remotes = await git.listRemotes(id).catch(() => [])
    if (remotes.length === 0) showError(t('toolbar.noRemoteConfigured'))
    return
  }
  busy.push = true
  try {
    await git.pushBranch(id, remote, branch, pushMode.value)
    await historyStore.loadBranches()
  } catch {
    /* toast 由 errorsStore watch 统一处理 */
  } finally {
    busy.push = false
  }
}

// ── Stash / Pop ─────────────────────────────────────────────────────
async function onStash() {
  if (!canStash.value) return
  busy.stash = true
  try {
    // 用 WipPanel 输入框里的提交信息当 stash message；空则回退到 libgit2 默认 "WIP on..."
    const draft = workspaceStore.commitDraft.trim()
    await stashStore.push(draft || undefined)
    // 变更已搬到 stash 里，message 也跟过去了，清空草稿
    if (draft) workspaceStore.commitDraft = ''
  } catch {
    /* toast 由 errorsStore watch 统一处理 */
  } finally {
    busy.stash = false
  }
}

async function onPop() {
  if (!canStashPop.value) return
  busy.pop = true
  try {
    await stashStore.pop()
  } catch {
    /* toast 由 errorsStore watch 统一处理 */
  } finally {
    busy.pop = false
  }
}

// ── Fetch ───────────────────────────────────────────────────────────
async function onFetch(e: MouseEvent) {
  const id = repoStore.activeRepoId
  if (!id) return
  const rect = (e.currentTarget as HTMLElement | null)?.getBoundingClientRect()
  const remote = await pickRemote(rect)
  if (!remote) {
    const remotes = await git.listRemotes(id).catch(() => [])
    if (remotes.length === 0) showError(t('toolbar.noRemoteConfigured'))
    return
  }
  busy.fetch = true
  try {
    await git.fetchRemote(id, remote)
    // fetch 会带来新的远端 commits，log 也要刷新，
    // 不然用户会以为 fetch 没生效
    await Promise.all([historyStore.loadLog(), historyStore.loadBranches()])
    // 远端 tag 列表可能随 fetch 变化（新增 / 被别人删）
    historyStore.loadRemoteTags().catch(() => {})
  } catch {
    /* toast 由 errorsStore watch 统一处理 */
  } finally {
    busy.fetch = false
  }
}

// ── Terminal ────────────────────────────────────────────────────────
// 中间按钮：直接在系统终端打开当前仓库
async function onOpenSystemTerminal() {
  const id = repoStore.activeRepoId
  if (!id) return
  try {
    await git.openTerminal(id, resolveExternalTerminalApp(settingsStore))
  } catch {
    /* toast 由 errorsStore watch 统一处理 */
  }
}

// 右侧小按钮：切换应用内终端可见（内容由 App.vue 的 mount-once 保留）
function onToggleInAppTerminal() {
  uiStore.toggleTerminalVisible()
}

// ── Actions 下拉菜单 ───────────────────────────────────────────────
const actionsMenu = reactive({
  visible: false,
  x: 0,
  y: 0,
})
const actionsBtnRef = ref<HTMLButtonElement | null>(null)

const actionsMenuItems = computed<ContextMenuItem[]>(() => [
  {
    label:
      (uiStore.showUnreachableCommits ? '✓ ' : '   ') +
      t('toolbar.actionsMenu.showUnreachable'),
    action: 'toggle-unreachable',
    disabled: !hasRepo.value,
  },
  {
    label: (uiStore.showStashCommits ? '✓ ' : '   ') + t('toolbar.actionsMenu.showStashes'),
    action: 'toggle-stashes',
    disabled: !hasRepo.value,
  },
  {
    label: (uiStore.debugPanelVisible ? '✓ ' : '   ') + t('toolbar.actionsMenu.debugLog'),
    action: 'toggle-debug',
  },
  { separator: true },
  {
    label: t('toolbar.actionsMenu.reflog'),
    action: 'reflog',
    disabled: !hasRepo.value,
  },
  {
    label:
      errorsStore.entries.length > 0
        ? t('toolbar.actionsMenu.recentErrorsWithCount', { count: errorsStore.entries.length })
        : t('toolbar.actionsMenu.recentErrors'),
    action: 'error-history',
    disabled: errorsStore.entries.length === 0,
  },
  {
    label: busy.gc ? t('toolbar.actionsMenu.gcCleaning') : t('toolbar.actionsMenu.gc'),
    action: 'gc',
    disabled: !hasRepo.value || busy.gc,
  },
  { separator: true },
  {
    label: t('toolbar.actionsMenu.discardAll'),
    action: 'discard-all',
    disabled: !hasRepo.value,
  },
  { separator: true },
  {
    label: t('toolbar.actionsMenu.about'),
    action: 'about',
  },
])

function onActions() {
  if (actionsMenu.visible) {
    actionsMenu.visible = false
    return
  }
  const el = actionsBtnRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  actionsMenu.x = rect.right - 200
  actionsMenu.y = rect.bottom + 4
  actionsMenu.visible = true
}

async function onActionsSelect(action: string) {
  actionsMenu.visible = false
  const id = repoStore.activeRepoId
  if (!id) return
  switch (action) {
    case 'reflog': {
      showReflogDialog.value = true
      break
    }
    case 'gc': {
      busy.gc = true
      try {
        const msg = await git.runGc(id)
        showError(msg)  // 借用 toast 展示成功信息
      } catch {
        /* toast 由 errorsStore watch 统一处理 */
      } finally {
        busy.gc = false
      }
      break
    }
    case 'error-history': {
      showErrorHistoryDialog.value = true
      break
    }
    case 'discard-all': {
      // 转发到 HistoryView 的 WipPanel 处理：通过 uiStore 触发
      uiStore.requestDiscardAll()
      break
    }
    case 'about': {
      showAboutDialog.value = true
      break
    }
    case 'toggle-unreachable': {
      uiStore.toggleShowUnreachable()
      // HistoryView 的 watch 会自动 reload；这里无需手动调用
      break
    }
    case 'toggle-stashes': {
      uiStore.toggleShowStashes()
      break
    }
    case 'toggle-debug': {
      uiStore.toggleDebugPanel()
      break
    }
  }
}

// ── 打开外部链接 ──────────────────────────────────────────────────
async function openUrl(url: string) {
  const { openUrl: open } = await import('@tauri-apps/plugin-opener')
  open(url)
}

// ── 顶部工具栏作为窗口拖动区域 ─────────────────────────────────────
function handleDragStart(e: MouseEvent) {
  if (e.button !== 0) return
  if ((e.target as HTMLElement).closest('button, input, a, select, textarea')) return
  appWindow.startDragging()
}

async function handleDblClick(e: MouseEvent) {
  if ((e.target as HTMLElement).closest('button, input, a, select, textarea')) return
  if (await appWindow.isMaximized()) await appWindow.unmaximize()
  else await appWindow.maximize()
}
</script>

<template>
  <div
    class="toolbar"
    data-tauri-drag-region
    @mousedown="handleDragStart"
    @dblclick="handleDblClick"
  >

    <div class="toolbar-actions">
      <button
        class="btn-tool"
        :title="t('repo.menu.title')"
        data-menu-anchor
        @click="showAddRepoMenu($event)"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        <span>{{ t('toolbar.button.new') }}</span>
      </button>

      <div class="toolbar-sep" />

      <!-- Pull (split button: main + chevron) -->
      <div class="btn-tool-group">
        <button
          class="btn-tool btn-tool--main"
          :title="t('toolbar.title.pull')"
          :disabled="!canRemoteOp || busy.pull"
          @click="onPull($event)"
        >
          <span v-if="busy.pull" class="spinner" />
          <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="3" x2="12" y2="15"/>
            <polyline points="6 9 12 15 18 9"/>
            <line x1="6" y1="21" x2="18" y2="21"/>
          </svg>
          <span>Pull</span>
        </button>
        <button
          class="btn-tool btn-tool--chevron"
          :title="t('toolbar.title.pullModeSelect')"
          data-menu-anchor
          :disabled="!canRemoteOp || busy.pull"
          @click="onPullChevronClick($event)"
        >
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>
      </div>

      <!-- Push (split button: main + chevron) -->
      <div class="btn-tool-group">
        <button
          class="btn-tool btn-tool--main"
          :title="t('toolbar.title.push')"
          :disabled="!canRemoteOp || busy.push"
          @click="onPush($event)"
        >
          <span v-if="busy.push" class="spinner" />
          <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="21" x2="12" y2="9"/>
            <polyline points="18 15 12 9 6 15"/>
            <line x1="6" y1="3" x2="18" y2="3"/>
          </svg>
          <span>Push</span>
        </button>
        <button
          class="btn-tool btn-tool--chevron"
          :title="t('toolbar.title.pushModeSelect')"
          data-menu-anchor
          :disabled="!canRemoteOp || busy.push"
          @click="onPushChevronClick($event)"
        >
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>
      </div>

      <!-- Stash -->
      <button
        class="btn-tool"
        :title="canStash ? t('toolbar.title.stash') : t('toolbar.title.stashEmpty')"
        :disabled="!canStash || busy.stash"
        @click="onStash"
      >
        <span v-if="busy.stash" class="spinner" />
        <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/>
          <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>
        </svg>
        <span>Stash</span>
      </button>

      <!-- Pop -->
      <button
        class="btn-tool"
        :title="canStashPop ? t('toolbar.title.popWithCount', { count: stashStore.entries.length }) : t('toolbar.title.popEmpty')"
        :disabled="!canStashPop || busy.pop"
        @click="onPop"
      >
        <span v-if="busy.pop" class="spinner" />
        <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/>
          <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>
          <line x1="12" y1="15" x2="12" y2="5"/>
          <polyline points="9 8 12 5 15 8"/>
        </svg>
        <span>Pop</span>
      </button>

      <!-- Fetch：抓取远端但不合并 -->
      <button
        class="btn-tool"
        :title="t('toolbar.title.fetch')"
        :disabled="!hasRepo || busy.fetch"
        @click="onFetch($event)"
      >
        <span v-if="busy.fetch" class="spinner" />
        <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="23 4 23 10 17 10"/>
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
        </svg>
        <span>Fetch</span>
      </button>

      <!-- Terminal：在系统终端打开当前仓库 -->
      <button
        class="btn-tool"
        :title="t('toolbar.title.terminalSystem')"
        :disabled="!hasRepo"
        @click="onOpenSystemTerminal"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="4 17 10 11 4 5"/>
          <line x1="12" y1="19" x2="20" y2="19"/>
        </svg>
        <span>Terminal</span>
      </button>
    </div>

    <div class="toolbar-spacer" data-tauri-drag-region />

    <!-- 错误提示（自动消失） -->
    <div v-if="toastError" class="toast-error" :title="toastError">
      {{ toastError }}
    </div>

    <!-- 右侧：搜索框、布局切换、更多操作 -->
    <div class="toolbar-right">
      <div
        v-if="hasRepo"
        class="search-box"
        :class="{ 'search-box--expanded': searchExpanded || uiStore.historySearchQuery }"
      >
        <button class="search-icon-btn" tabindex="-1" @click="expandSearch">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
        </button>
        <input
          v-show="searchExpanded || uiStore.historySearchQuery"
          ref="searchInputEl"
          v-model="uiStore.historySearchQuery"
          class="search-input"
          :placeholder="t('toolbar.search.placeholder')"
          spellcheck="false"
          autocomplete="off"
          @blur="onSearchBlur"
          @keydown="onSearchKeydown"
        />
      </div>

      <!-- 主题切换：深色显示太阳（点击切浅色），浅色显示月亮（点击切深色） -->
      <button
        class="btn-icon-only"
        :title="resolvedTheme === 'dark' ? t('toolbar.title.themeSwitchLight') : t('toolbar.title.themeSwitchDark')"
        @click="toggleTheme"
      >
        <!-- 太阳：当前深色 -->
        <svg v-if="resolvedTheme === 'dark'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="4"/>
          <line x1="12" y1="2" x2="12" y2="4"/>
          <line x1="12" y1="20" x2="12" y2="22"/>
          <line x1="4.93" y1="4.93" x2="6.34" y2="6.34"/>
          <line x1="17.66" y1="17.66" x2="19.07" y2="19.07"/>
          <line x1="2" y1="12" x2="4" y2="12"/>
          <line x1="20" y1="12" x2="22" y2="12"/>
          <line x1="4.93" y1="19.07" x2="6.34" y2="17.66"/>
          <line x1="17.66" y1="6.34" x2="19.07" y2="4.93"/>
        </svg>
        <!-- 月亮：当前浅色 -->
        <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
        </svg>
      </button>

      <button
        v-if="hasRepo"
        class="btn-icon-only"
        :class="{ 'btn-icon-only--active': uiStore.terminalVisible }"
        :title="uiStore.terminalVisible ? t('toolbar.title.terminalToggleHide') : t('toolbar.title.terminalToggleShow')"
        @click="onToggleInAppTerminal"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="4 17 10 11 4 5"/>
          <line x1="12" y1="19" x2="20" y2="19"/>
        </svg>
      </button>

      <button
        v-if="hasRepo"
        class="btn-icon-only"
        :title="{ custom: t('toolbar.title.layoutCustom'), vertical: t('toolbar.title.layoutVertical'), horizontal: t('toolbar.title.layoutHorizontal') }[uiStore.layoutPreset]"
        @click="uiStore.toggleHistoryLayout()"
      >
        <!-- 自定义布局：田字格图标 -->
        <svg v-if="uiStore.layoutPreset === 'custom'" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="2" y="2" width="12" height="12" rx="1"/>
          <line x1="8" y1="2" x2="8" y2="14"/>
          <line x1="2" y1="8" x2="14" y2="8"/>
        </svg>
        <!-- 上下布局：水平分割线 -->
        <svg v-else-if="uiStore.layoutPreset === 'vertical'" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="2" y="2" width="12" height="12" rx="1"/>
          <line x1="2" y1="8" x2="14" y2="8"/>
        </svg>
        <!-- 左右布局：垂直分割线 -->
        <svg v-else width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="2" y="2" width="12" height="12" rx="1"/>
          <line x1="8" y1="2" x2="8" y2="14"/>
        </svg>
      </button>

      <button
        class="btn-icon-only"
        :title="t('toolbar.title.settings')"
        @click="showSettingsDialog = true"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
      </button>

      <button
        ref="actionsBtnRef"
        class="btn-icon-only"
        :title="t('toolbar.title.actions')"
        :disabled="!hasRepo"
        data-menu-anchor
        @mousedown.stop
        @click="onActions"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="1"/>
          <circle cx="19" cy="12" r="1"/>
          <circle cx="5" cy="12" r="1"/>
        </svg>
      </button>
    </div>

    <ReflogDialog
      :visible="showReflogDialog"
      @close="showReflogDialog = false"
    />

    <ErrorHistoryDialog
      :visible="showErrorHistoryDialog"
      @close="showErrorHistoryDialog = false"
    />

    <SettingsModal
      :visible="showSettingsDialog"
      @close="showSettingsDialog = false"
    />

    <Modal
      :visible="showAboutDialog"
      :title="t('common.aboutTitle')"
      width="320px"
      @close="showAboutDialog = false"
    >
      <AboutInfo />
    </Modal>

    <ContextMenu
      :visible="actionsMenu.visible"
      :x="actionsMenu.x"
      :y="actionsMenu.y"
      :items="actionsMenuItems"
      @close="actionsMenu.visible = false"
      @select="onActionsSelect"
    />

    <!-- 多 remote 选择菜单：pickRemote 触发 -->
    <ContextMenu
      :visible="remoteMenu.visible"
      :x="remoteMenu.x"
      :y="remoteMenu.y"
      :items="remoteMenu.items"
      @close="onRemoteMenuClose"
      @select="onRemoteMenuSelect"
    />

    <!-- Pull 模式选择菜单 -->
    <ContextMenu
      :visible="pullModeMenu.visible"
      :x="pullModeMenu.x"
      :y="pullModeMenu.y"
      :items="pullModeMenuItems"
      @close="pullModeMenu.visible = false"
      @select="onPullModeSelect"
    />

    <!-- Push 模式选择菜单 -->
    <ContextMenu
      :visible="pushModeMenu.visible"
      :x="pushModeMenu.x"
      :y="pushModeMenu.y"
      :items="pushModeMenuItems"
      @close="pushModeMenu.visible = false"
      @select="onPushModeSelect"
    />
  </div>
</template>

<style scoped>
.toolbar {
  height: 38px;
  display: flex;
  align-items: center;
  padding: 0 12px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  gap: 8px;
  flex-shrink: 0;
  /* macOS traffic lights 让出 78px 空间 */
  padding-left: 78px;
  position: relative;
}

.toolbar-sep {
  width: 1px;
  height: 22px;
  background: var(--border);
  flex-shrink: 0;
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.toolbar-spacer {
  flex: 1;
  align-self: stretch;
  min-width: 0;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 4px;
}

.search-box {
  display: flex;
  align-items: center;
  border-radius: 4px;
  overflow: hidden;
  transition: width 0.18s ease, border-color 0.18s ease, background 0.18s ease;
  /* 收起：只有图标，无边框 */
  width: 26px;
  border: 1px solid transparent;
  background: transparent;
}

.search-box--expanded {
  width: 136px;
  border-color: var(--border);
  background: var(--bg-surface);
  padding-right: 6px;
}

.search-icon-btn {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-muted);
  border-radius: 4px;
  padding: 0;
  transition: color 0.15s;
}

.search-icon-btn:hover {
  color: var(--text-primary);
}

.search-box--expanded .search-icon-btn {
  cursor: default;
}

.search-input {
  flex: 1;
  min-width: 0;
  background: none;
  border: none;
  color: var(--text-primary);
  font-size: var(--font-sm);
  font-family: inherit;
  outline: none;
}

.search-input::placeholder {
  color: var(--text-muted);
}

.btn-tool {
  background: none;
  border: 1px solid var(--border);
  cursor: pointer;
  color: var(--text-secondary);
  padding: 2px 6px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: var(--font-sm);
  font-family: inherit;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
  white-space: nowrap;
}

.btn-tool:hover:not(:disabled) {
  background: var(--bg-overlay);
  color: var(--text-primary);
  border-color: var(--text-muted);
}

.btn-tool:disabled {
  cursor: not-allowed;
}

/* 纯禁用状态才压暗；busy 显示 spinner 时保持全亮，否则 spinner 也会被压到 40% 看不清 */
.btn-tool:disabled:not(:has(.spinner)) {
  opacity: 0.4;
}

.btn-tool-group {
  display: flex;
  align-items: stretch;
}

.btn-tool-group .btn-tool--main {
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
  border-right: none;
}

.btn-tool-group .btn-tool--chevron {
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
  padding: 0 3px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.spinner {
  display: inline-block;
  box-sizing: border-box;
  width: 12px;
  height: 12px;
  border: 2px solid var(--border);
  border-top-color: var(--accent-blue);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
  flex-shrink: 0;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.btn-icon-only {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-muted);
  padding: 5px 6px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  transition: background 0.15s, color 0.15s;
}

.btn-icon-only:hover:not(:disabled) {
  background: var(--bg-overlay);
  color: var(--text-primary);
}

/* 切换型图标按钮处于激活态（终端已展开） */
.btn-icon-only--active {
  background: var(--bg-overlay);
  color: var(--accent-blue);
}

.btn-icon-only:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}


.toast-error {
  position: absolute;
  top: 44px;
  right: 12px;
  max-width: 440px;
  background: var(--bg-surface);
  border: 1px solid var(--accent-red);
  border-radius: 6px;
  padding: 6px 10px;
  font-size: var(--font-sm);
  color: var(--accent-red);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  z-index: 50;
}
</style>
