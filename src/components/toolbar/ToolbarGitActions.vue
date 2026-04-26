<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRepoStore } from '@/stores/repos'
import { useHistoryStore } from '@/stores/history'
import { useStashStore } from '@/stores/stash'
import { useWorkspaceStore } from '@/stores/workspace'
import { useRepoOpsStore } from '@/stores/repoOps'
import { useUiStore } from '@/stores/ui'
import { resolveExternalTerminalApp, useSettingsStore } from '@/stores/settings'
import { useShortcutsStore, bindingToLabel, type ShortcutActionId } from '@/stores/shortcuts'
import { useGitCommands } from '@/composables/useGitCommands'
import { useRepoCreation } from '@/composables/useRepoCreation'
import { useGlobalToast } from '@/composables/useGlobalToast'
import ContextMenu, { type ContextMenuItem } from '@/components/common/ContextMenu.vue'
import type { RemoteInfo } from '@/types/git'

const repoStore = useRepoStore()
const historyStore = useHistoryStore()
const stashStore = useStashStore()
const workspaceStore = useWorkspaceStore()
const repoOpsStore = useRepoOpsStore()
const uiStore = useUiStore()
const settingsStore = useSettingsStore()
const shortcutsStore = useShortcutsStore()
const git = useGitCommands()
const repoCreation = useRepoCreation()
const { t } = useI18n()
const { showToast, showError } = useGlobalToast()

function withShortcut(label: string, actionId: ShortcutActionId): string {
  const b = shortcutsStore.bindings[actionId]
  return b ? `${label} (${bindingToLabel(b)})` : label
}

const busy = computed(() => repoOpsStore.getBusy(repoStore.activeRepoId))
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
  return s.staged.length + s.unstaged.length + s.untracked.length > 0
})
const canStashPop = computed(() => hasRepo.value && stashStore.entries.length > 0)

// ── Helpers ────────────────────────────────────────────────────────
const remoteMenu = reactive({
  visible: false,
  x: 0,
  y: 0,
  items: [] as ContextMenuItem[],
  resolve: null as ((remote: string | null) => void) | null,
})

async function pickRemote(anchorRect?: DOMRect, showFetchAll: boolean = false): Promise<string | null> {
  const id = repoStore.activeRepoId
  if (!id) return null
  let remotes: RemoteInfo[]
  try {
    remotes = await git.listRemotes(id)
  } catch {
    return null
  }
  if (remotes.length === 0) return null
  if (remotes.length === 1) return remotes[0].name

  return new Promise<string | null>((resolve) => {
    const items = remotes.map((r) => ({ label: r.name, action: r.name }))
    if (showFetchAll) {
      items.unshift({ label: 'Fetch All', action: '--all' })
    }
    remoteMenu.items = items
    if (anchorRect) {
      remoteMenu.x = anchorRect.left
      remoteMenu.y = anchorRect.bottom + 4
    } else {
      // 兜底参考
      remoteMenu.x = 80
      remoteMenu.y = 80
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
  remoteMenu.visible = false
  const fn = remoteMenu.resolve
  remoteMenu.resolve = null
  fn?.(null)
}

// ── 添加仓库 ────────────────────────────────────────────────────────
function showAddRepoMenu(e: MouseEvent) {
  repoCreation.showMenuAt(e.currentTarget as HTMLElement)
}

// ── Pull ────────────────────────────────────────────────────────────
type PullMode = 'ff' | 'ff_only' | 'rebase'

const pullModeMenu = reactive({
  visible: false,
  x: 0,
  y: 0,
})

const pullModeMenuItems = computed<ContextMenuItem[]>(() => [
  { label: t('toolbar.pullMode.ff'), action: 'ff' },
  { label: t('toolbar.pullMode.ffOnly'), action: 'ff_only' },
  { label: t('toolbar.pullMode.rebase'), action: 'rebase' },
])

let pullChevronRect: DOMRect | null = null

function onPullChevronClick(e: MouseEvent) {
  e.stopPropagation()
  if (pullModeMenu.visible) {
    pullModeMenu.visible = false
    return
  }
  const el = e.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  pullChevronRect = rect
  pullModeMenu.x = rect.left
  pullModeMenu.y = rect.bottom + 4
  pullModeMenu.visible = true
}

function onPullModeSelect(action: string) {
  pullModeMenu.visible = false
  doPull(action as PullMode, pullChevronRect ?? undefined)
}

async function onPull(e: MouseEvent) {
  await doPull('ff', (e.currentTarget as HTMLElement | null)?.getBoundingClientRect())
}

async function doPull(mode: PullMode, anchorRect?: DOMRect) {
  const id = repoStore.activeRepoId
  const branch = currentBranch.value
  if (!id || !branch) return
  const remote = await pickRemote(anchorRect, false)
  if (!remote) {
    const remotes = await git.listRemotes(id).catch(() => [])
    if (remotes.length === 0) showError(t('toolbar.noRemoteConfigured'))
    return
  }
  repoOpsStore.setBusy(id, 'pull', true)
  try {
    await git.pullBranch(id, remote, branch, mode)
    await Promise.all([historyStore.loadLog(), historyStore.loadBranches()])
    showToast('success', t('toolbar.opSuccess', { label: t('toolbar.opLabels.pull') }))
  } catch {
    // 错误在 ToolbarToast 中拦截处理
  } finally {
    repoOpsStore.setBusy(id, 'pull', false)
  }
}

// ── Push ────────────────────────────────────────────────────────────
type PushMode = 'normal' | 'force_with_lease' | 'force'

const pushModeMenu = reactive({
  visible: false,
  x: 0,
  y: 0,
})
let pushChevronRect: DOMRect | null = null

const pushModeMenuItems = computed<ContextMenuItem[]>(() => [
  { label: t('toolbar.pushMode.forceWithLease'), action: 'force_with_lease' },
  { label: t('toolbar.pushMode.force'), action: 'force' },
])

function onPushChevronClick(e: MouseEvent) {
  e.stopPropagation()
  if (pushModeMenu.visible) {
    pushModeMenu.visible = false
    return
  }
  const el = e.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  pushChevronRect = rect
  pushModeMenu.x = rect.left
  pushModeMenu.y = rect.bottom + 4
  pushModeMenu.visible = true
}

function onPushModeSelect(action: string) {
  pushModeMenu.visible = false
  doPush(action as PushMode, pushChevronRect ?? undefined)
}

async function onPush(e: MouseEvent) {
  await doPush('normal', (e.currentTarget as HTMLElement | null)?.getBoundingClientRect())
}

async function doPush(mode: PushMode, anchorRect?: DOMRect) {
  const id = repoStore.activeRepoId
  const branch = currentBranch.value
  if (!id || !branch) return
  const remote = await pickRemote(anchorRect, false)
  if (!remote) {
    const remotes = await git.listRemotes(id).catch(() => [])
    if (remotes.length === 0) showError(t('toolbar.noRemoteConfigured'))
    return
  }
  repoOpsStore.setBusy(id, 'push', true)
  try {
    await git.pushBranch(id, remote, branch, mode)
    await historyStore.loadBranches()
    showToast('success', t('toolbar.opSuccess', { label: t('toolbar.opLabels.push') }))
  } catch {
    // 错误在 ToolbarToast 中拦截处理
  } finally {
    repoOpsStore.setBusy(id, 'push', false)
  }
}

// ── Stash / Pop ─────────────────────────────────────────────────────
async function onStash() {
  if (!canStash.value) return
  const id = repoStore.activeRepoId
  if (!id) return
  repoOpsStore.setBusy(id, 'stash', true)
  try {
    const draft = workspaceStore.commitDraft.trim()
    await stashStore.push(draft || undefined)
    if (draft) workspaceStore.commitDraft = ''
  } catch {
    // 错误在 ToolbarToast 中拦截处理
  } finally {
    repoOpsStore.setBusy(id, 'stash', false)
  }
}

async function onPop() {
  if (!canStashPop.value) return
  const id = repoStore.activeRepoId
  if (!id) return
  repoOpsStore.setBusy(id, 'pop', true)
  try {
    await stashStore.pop()
  } catch {
    // 错误在 ToolbarToast 中拦截处理
  } finally {
    repoOpsStore.setBusy(id, 'pop', false)
  }
}

// ── Fetch ───────────────────────────────────────────────────────────
const fetchBtnRef = ref<HTMLButtonElement | null>(null)

watch(() => uiStore.fetchSignal, () => {
  onFetch()
})

async function onFetch(e?: MouseEvent) {
  const id = repoStore.activeRepoId
  if (!id) return
  
  let remote = uiStore.fetchTarget
  if (!remote) {
    const rect = e 
      ? (e.currentTarget as HTMLElement).getBoundingClientRect()
      : fetchBtnRef.value?.getBoundingClientRect()
    remote = await pickRemote(rect, true)
  }
  
  if (!remote) {
    const remotes = await git.listRemotes(id).catch(() => [])
    if (remotes.length === 0) showError(t('toolbar.noRemoteConfigured'))
    return
  }
  repoOpsStore.setBusy(id, 'fetch', true)
  try {
    await git.fetchRemote(id, remote)
    await Promise.all([historyStore.loadLog(), historyStore.loadBranches()])
    historyStore.loadRemoteTags(true).catch(() => {})
  } catch {
    // 错误在 ToolbarToast 中拦截处理
  } finally {
    repoOpsStore.setBusy(id, 'fetch', false)
  }
}

// ── Terminal ────────────────────────────────────────────────────────
async function onOpenSystemTerminal() {
  const id = repoStore.activeRepoId
  if (!id) return
  try {
    await git.openTerminal(id, resolveExternalTerminalApp(settingsStore))
  } catch {
    // 错误在 ToolbarToast 中拦截处理
  }
}
</script>

<template>
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
      <span>Open</span>
    </button>

    <div class="toolbar-sep" />

    <!-- Pull -->
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

    <!-- Push -->
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

    <!-- Fetch -->
    <button
      ref="fetchBtnRef"
      class="btn-tool"
      :title="withShortcut(t('toolbar.title.fetch'), 'fetchAll')"
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

    <!-- Terminal -->
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

    <ContextMenu
      :visible="remoteMenu.visible"
      :x="remoteMenu.x"
      :y="remoteMenu.y"
      :items="remoteMenu.items"
      @close="onRemoteMenuClose"
      @select="onRemoteMenuSelect"
    />

    <ContextMenu
      :visible="pullModeMenu.visible"
      :x="pullModeMenu.x"
      :y="pullModeMenu.y"
      :items="pullModeMenuItems"
      @close="pullModeMenu.visible = false"
      @select="onPullModeSelect"
    />

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
.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.toolbar-sep {
  width: 1px;
  height: 22px;
  background: var(--border);
  flex-shrink: 0;
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
</style>
