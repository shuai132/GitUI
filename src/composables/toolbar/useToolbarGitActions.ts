import { computed, watch, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRepoStore } from '@/stores/repos'
import { useHistoryStore } from '@/stores/history'
import { useStashStore } from '@/stores/stash'
import { useWorkspaceStore } from '@/stores/workspace'
import { useRepoOpsStore } from '@/stores/repoOps'
import { useUiStore } from '@/stores/ui'
import { resolveExternalTerminalApp, useSettingsStore } from '@/stores/settings'
import { bindingToLabel, useShortcutsStore, type ShortcutActionId } from '@/stores/shortcuts'
import { useGitCommands } from '@/composables/useGitCommands'
import { useRepoCreation } from '@/composables/useRepoCreation'
import { useGlobalToast } from '@/composables/useGlobalToast'
import type { PullMode, PushMode } from '@/composables/toolbar/useRemoteActionMenu'

interface UseToolbarGitActionsOptions {
  fetchBtnRef: Ref<HTMLButtonElement | null>
  pickRemote: (anchorRect?: DOMRect, showFetchAll?: boolean) => Promise<string | null>
}

export function useToolbarGitActions(options: UseToolbarGitActionsOptions) {
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

  function withShortcut(label: string, actionId: ShortcutActionId): string {
    const b = shortcutsStore.bindings[actionId]
    return b ? `${label} (${bindingToLabel(b)})` : label
  }

  function showAddRepoMenu(e: MouseEvent) {
    repoCreation.showMenuAt(e.currentTarget as HTMLElement)
  }

  async function onPull(e: MouseEvent) {
    await doPull('ff', (e.currentTarget as HTMLElement | null)?.getBoundingClientRect())
  }

  async function doPull(mode: PullMode, anchorRect?: DOMRect) {
    const id = repoStore.activeRepoId
    const branch = currentBranch.value
    if (!id || !branch) return
    const remote = await options.pickRemote(anchorRect, false)
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

  async function onPush(e: MouseEvent) {
    await doPush('normal', (e.currentTarget as HTMLElement | null)?.getBoundingClientRect())
  }

  async function doPush(mode: PushMode, anchorRect?: DOMRect) {
    const id = repoStore.activeRepoId
    const branch = currentBranch.value
    if (!id || !branch) return
    const remote = await options.pickRemote(anchorRect, false)
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

  async function onFetch(e?: MouseEvent) {
    const id = repoStore.activeRepoId
    if (!id) return

    let remote = uiStore.fetchTarget
    if (!remote) {
      const rect = e
        ? (e.currentTarget as HTMLElement).getBoundingClientRect()
        : options.fetchBtnRef.value?.getBoundingClientRect()
      remote = await options.pickRemote(rect, true)
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

  async function onOpenSystemTerminal() {
    const id = repoStore.activeRepoId
    if (!id) return
    try {
      await git.openTerminal(id, resolveExternalTerminalApp(settingsStore))
    } catch {
      // 错误在 ToolbarToast 中拦截处理
    }
  }

  watch(() => uiStore.fetchSignal, () => {
    onFetch()
  })

  return {
    stashStore,
    busy,
    hasRepo,
    canRemoteOp,
    canStash,
    canStashPop,
    withShortcut,
    showAddRepoMenu,
    onPull,
    doPull,
    onPush,
    doPush,
    onStash,
    onPop,
    onFetch,
    onOpenSystemTerminal,
  }
}
