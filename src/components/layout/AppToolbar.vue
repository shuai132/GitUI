<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { getVersion } from '@tauri-apps/api/app'
import { listen } from '@tauri-apps/api/event'
import { useRepoStore } from '@/stores/repos'
import { useHistoryStore } from '@/stores/history'
import { useStashStore } from '@/stores/stash'
import { useUiStore } from '@/stores/ui'
import { useErrorsStore } from '@/stores/errors'
import { useGitCommands } from '@/composables/useGitCommands'
import ReflogDialog from '@/components/common/ReflogDialog.vue'
import ErrorHistoryDialog from '@/components/common/ErrorHistoryDialog.vue'
import Modal from '@/components/common/Modal.vue'
import ContextMenu, { type ContextMenuItem } from '@/components/common/ContextMenu.vue'

const repoStore = useRepoStore()
const historyStore = useHistoryStore()
const stashStore = useStashStore()
const uiStore = useUiStore()
const errorsStore = useErrorsStore()
const git = useGitCommands()
const appWindow = getCurrentWindow()

// ── IPC 错误自动弹 toast ─────────────────────────────────────────
// errorsStore 由 useGitCommands.call() 统一 push。watch latestId 即可。
const OP_LABELS: Record<string, string> = {
  pull_branch: 'Pull',
  push_branch: 'Push',
  fetch_remote: 'Fetch',
  stash_push: 'Stash',
  stash_pop: 'Stash pop',
  run_gc: 'git gc',
  open_repo: '打开仓库',
  checkout_commit: '检出提交',
  cherry_pick_commit: 'Cherry pick',
  revert_commit: 'Revert',
  reset_to_commit: 'Reset',
  create_branch: '创建分支',
  switch_branch: '切换分支',
  delete_branch: '删除分支',
  checkout_remote_branch: '检出远程分支',
  create_commit: '提交',
  amend_commit: 'Amend',
  create_tag: '创建标签',
  discard_all_changes: '丢弃全部',
  discard_file: '丢弃文件',
  open_terminal: '打开终端',
  init_submodule: 'Init submodule',
  update_submodule: 'Update submodule',
  set_submodule_url: '修改 submodule URL',
  deinit_submodule: '删除 submodule',
}

watch(
  () => errorsStore.latestId,
  (id) => {
    if (!id) return
    const entry = errorsStore.entries[0]
    if (!entry) return
    const label = OP_LABELS[entry.op]
    showError(label ? `${label} 失败：${entry.friendly}` : entry.friendly)
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
    label: `${pullMode.value === 'ff' ? '● ' : '○ '}Pull (fast-forward if possible)`,
    action: 'ff',
  },
  {
    label: `${pullMode.value === 'ff_only' ? '● ' : '○ '}Pull (fast-forward only)`,
    action: 'ff_only',
  },
  {
    label: `${pullMode.value === 'rebase' ? '● ' : '○ '}Pull (rebase)`,
    action: 'rebase',
  },
])

function onPullChevronClick(e: MouseEvent) {
  e.stopPropagation()
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

const showReflogDialog = ref(false)
const showErrorHistoryDialog = ref(false)
const showAboutDialog = ref(false)
const appVersion = ref('')
const searchInputEl = ref<HTMLInputElement | null>(null)
const searchExpanded = ref(false)

onMounted(async () => {
  appVersion.value = await getVersion()
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

// ── 仓库已打开时按钮才可用 ────────────────────────────────────────
const hasRepo = computed(() => !!repoStore.activeRepoId)

const currentBranch = computed(
  () =>
    historyStore.branches.find((b) => b.is_head && !b.is_remote)?.name ?? null,
)

const canRemoteOp = computed(() => hasRepo.value && currentBranch.value !== null)
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

// ── 打开仓库 ────────────────────────────────────────────────────────
async function openFolder() {
  try {
    const { open: openDialog } = await import('@tauri-apps/plugin-dialog')
    const selected = await openDialog({ directory: true })
    if (selected) {
      await repoStore.openRepo(selected as string)
    }
  } catch (e) {
    console.error(e)
  }
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
    if (remotes.length === 0) showError('当前仓库没有配置 remote')
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
    if (remotes.length === 0) showError('当前仓库没有配置 remote')
    return
  }
  busy.push = true
  try {
    await git.pushBranch(id, remote, branch)
    await historyStore.loadBranches()
  } catch {
    /* toast 由 errorsStore watch 统一处理 */
  } finally {
    busy.push = false
  }
}

// ── Stash / Pop ─────────────────────────────────────────────────────
async function onStash() {
  if (!hasRepo.value) return
  busy.stash = true
  try {
    await stashStore.push()
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

// ── Terminal ────────────────────────────────────────────────────────
async function onTerminal() {
  const id = repoStore.activeRepoId
  if (!id) return
  try {
    await git.openTerminal(id)
  } catch {
    /* toast 由 errorsStore watch 统一处理 */
  }
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
    label: busy.fetch ? '抓取中...' : '抓取 (Fetch)',
    action: 'fetch',
    disabled: !hasRepo.value || busy.fetch,
  },
  { separator: true },
  {
    label:
      (uiStore.showUnreachableCommits ? '✓ ' : '   ') +
      '显示悬垂引用',
    action: 'toggle-unreachable',
    disabled: !hasRepo.value,
  },
  {
    label: (uiStore.showStashCommits ? '✓ ' : '   ') + '显示贮藏',
    action: 'toggle-stashes',
    disabled: !hasRepo.value,
  },
  {
    label: (uiStore.debugPanelVisible ? '✓ ' : '   ') + '调试日志',
    action: 'toggle-debug',
  },
  { separator: true },
  {
    label: '显示Reflog',
    action: 'reflog',
    disabled: !hasRepo.value,
  },
  {
    label:
      errorsStore.entries.length > 0
        ? `最近错误 (${errorsStore.entries.length})...`
        : '最近错误...',
    action: 'error-history',
    disabled: errorsStore.entries.length === 0,
  },
  {
    label: busy.gc ? '清理中...' : '清理仓库 (git gc)',
    action: 'gc',
    disabled: !hasRepo.value || busy.gc,
  },
  { separator: true },
  {
    label: '丢弃所有变更',
    action: 'discard-all',
    disabled: !hasRepo.value,
  },
  { separator: true },
  {
    label: '关于 GitUI',
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
    case 'fetch': {
      const rect = actionsBtnRef.value?.getBoundingClientRect()
      const remote = await pickRemote(rect)
      if (!remote) {
        const remotes = await git.listRemotes(id).catch(() => [])
        if (remotes.length === 0) showError('当前仓库没有配置 remote')
        return
      }
      busy.fetch = true
      try {
        await git.fetchRemote(id, remote)
        // fetch 会带来新的远端 commits，log 也要刷新，
        // 不然用户会以为 fetch 没生效
        await Promise.all([historyStore.loadLog(), historyStore.loadBranches()])
      } catch {
        /* toast 由 errorsStore watch 统一处理 */
      } finally {
        busy.fetch = false
      }
      break
    }
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
      <button class="btn-tool" title="打开仓库" @click="openFolder">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
        <span>打开</span>
      </button>

      <div class="toolbar-sep" />

      <!-- Pull (split button: main + chevron) -->
      <div class="btn-tool-group">
        <button
          class="btn-tool btn-tool--main"
          title="Pull (fetch + merge)"
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
          title="选择 Pull 模式"
          :disabled="!canRemoteOp || busy.pull"
          @click="onPullChevronClick($event)"
        >
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>
      </div>

      <!-- Push -->
      <button
        class="btn-tool"
        title="Push 当前分支"
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

      <!-- Stash -->
      <button
        class="btn-tool"
        title="Stash 当前工作区"
        :disabled="!hasRepo || busy.stash"
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
        :title="canStashPop ? `Pop 最新 stash (共 ${stashStore.entries.length} 条)` : '没有 stash'"
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

      <!-- Terminal -->
      <button
        class="btn-tool"
        title="在系统终端打开仓库"
        :disabled="!hasRepo"
        @click="onTerminal"
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
          placeholder="搜索提交"
          spellcheck="false"
          autocomplete="off"
          @blur="onSearchBlur"
          @keydown="onSearchKeydown"
        />
      </div>

      <button
        v-if="hasRepo"
        class="btn-icon-only"
        :title="{ custom: '自定义布局 → 切换为上下', vertical: '上下布局 → 切换为左右', horizontal: '左右布局 → 切换为自定义' }[uiStore.layoutPreset]"
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
        ref="actionsBtnRef"
        class="btn-icon-only"
        title="更多操作"
        :disabled="!hasRepo"
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

    <Modal
      :visible="showAboutDialog"
      title="关于 GitUI"
      width="320px"
      @close="showAboutDialog = false"
    >
      <div class="about-content">
        <div class="about-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--accent-blue)" stroke-width="1.5">
            <circle cx="12" cy="12" r="4"/>
            <line x1="1.05" y1="12" x2="7" y2="12"/>
            <line x1="17.01" y1="12" x2="22.96" y2="12"/>
            <line x1="12" y1="1.05" x2="12" y2="7"/>
            <line x1="12" y1="17.01" x2="12" y2="22.96"/>
          </svg>
        </div>
        <div class="about-name">GitUI</div>
        <div class="about-fields">
          <div class="about-row">
            <span class="about-label">作者：</span>
            <span class="about-value">刘帅</span>
          </div>
          <div class="about-row">
            <span class="about-label">版本：</span>
            <span class="about-value">{{ appVersion }}</span>
          </div>
          <div class="about-row">
            <span class="about-label">项目：</span>
            <a
              class="about-link"
              href="https://github.com/shuai132/GitUI"
              target="_blank"
              rel="noopener"
              @click.prevent="openUrl('https://github.com/shuai132/GitUI')"
            >https://github.com/shuai132/GitUI</a>
          </div>
        </div>
      </div>
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
  font-size: 11px;
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
  font-size: 11px;
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
  opacity: 0.4;
  cursor: not-allowed;
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
  width: 12px;
  height: 12px;
  border: 1.5px solid var(--text-muted);
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

.btn-icon-only:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}


.about-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.about-icon {
  margin-bottom: 4px;
}

.about-name {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary);
}

.about-fields {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.about-row {
  display: flex;
  align-items: center;
  font-size: 12px;
}

.about-label {
  color: var(--text-muted);
}

.about-value {
  color: var(--text-primary);
}

.about-link {
  color: var(--accent-blue);
  text-decoration: none;
  cursor: pointer;
}

.about-link:hover {
  text-decoration: underline;
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
  font-size: 11px;
  color: var(--accent-red);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  z-index: 50;
}
</style>
