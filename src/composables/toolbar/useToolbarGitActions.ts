import { computed, ref, watch, type Ref } from 'vue'
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
import { useRepositoryRefresh } from '@/composables/useRepositoryRefresh'
import { useGlobalToast } from '@/composables/useGlobalToast'
import { runPullWithAutoStash } from '@/composables/toolbar/pullAutoStash'
import {
  countChangedWorkspacePaths,
  isSameStashTarget,
} from '@/composables/toolbar/stashPopSafety'
import {
  requiresForcePushConfirmation,
  type PullMode,
  type PushMode,
} from '@/composables/toolbar/useRemoteActionMenu'

interface UseToolbarGitActionsOptions {
  fetchBtnRef: Ref<HTMLButtonElement | null>
  pickRemote: (
    anchorRect?: DOMRect,
    showFetchAll?: boolean,
    options?: { forceMenu?: boolean; resolveSelection?: boolean },
  ) => Promise<string | null>
}

interface PullRequest {
  repoId: string
  remote: string
  branch: string
  mode: PullMode
}

interface PushRequest {
  repoId: string
  remote: string
  branch: string
  mode: PushMode
}

interface PendingStashPop {
  repoId: string
  index: number
  commitOid: string
  message: string
  changeCount: number
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
  const { refreshActiveRepository } = useRepositoryRefresh()
  const { t } = useI18n()
  const { showToast, showError, showActionError } = useGlobalToast()

  const busy = computed(() => repoOpsStore.getBusy(repoStore.activeRepoId))
  const hasRepo = computed(() => !!repoStore.activeRepoId)
  const currentBranchInfo = computed(
    () => historyStore.branches.find((branch) => branch.is_head && !branch.is_remote) ?? null,
  )
  const currentBranch = computed(() => currentBranchInfo.value?.name ?? null)
  const canRemoteOp = computed(() => hasRepo.value && currentBranch.value !== null)
  const isPublishingBranch = computed(
    () => canRemoteOp.value && !currentBranchInfo.value?.upstream,
  )
  const canStash = computed(() => {
    if (!hasRepo.value) return false
    const s = workspaceStore.status
    if (!s) return false
    return s.staged.length + s.unstaged.length + s.untracked.length > 0
  })
  const canStashPop = computed(() => hasRepo.value && stashStore.entries.length > 0)
  const pendingPull = ref<PullRequest | null>(null)
  const pendingPullChangeCount = ref(0)
  const pullWithChangesLoading = ref(false)
  const pullWithChangesVisible = computed(() => pendingPull.value !== null)
  const pendingForcePush = ref<PushRequest | null>(null)
  const forcePushLoading = ref(false)
  const forcePushVisible = computed(() => pendingForcePush.value !== null)
  const forcePushTarget = computed(() => {
    const request = pendingForcePush.value
    return request ? `${request.remote}/${request.branch}` : ''
  })
  const pendingStashPop = ref<PendingStashPop | null>(null)
  const stashPopLoading = ref(false)
  const stashPopConfirmVisible = computed(() => pendingStashPop.value !== null)
  const stashPopTarget = computed(() => pendingStashPop.value)
  const undoingCommit = ref(false)
  const canUndoLastCommit = computed(() => {
    const candidate = workspaceStore.undoCommitCandidate
    if (
      !candidate ||
      candidate.repoId !== repoStore.activeRepoId ||
      workspaceStore.status?.head_commit !== candidate.oid
    ) {
      return false
    }
    const headBranch = historyStore.branches.find((branch) => branch.is_head && !branch.is_remote)
    return !headBranch?.upstream || headBranch.ahead !== 0
  })

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

    // remote 选择期间用户可能已切换仓库或分支，不能把旧请求落到新上下文。
    if (repoStore.activeRepoId !== id || currentBranch.value !== branch) return

    const request: PullRequest = { repoId: id, remote, branch, mode }
    const changedPaths = new Set([
      ...(workspaceStore.status?.staged ?? []),
      ...(workspaceStore.status?.unstaged ?? []),
      ...(workspaceStore.status?.untracked ?? []),
    ].map((file) => file.path))
    if (changedPaths.size > 0) {
      pendingPull.value = request
      pendingPullChangeCount.value = changedPaths.size
      return
    }

    await runPull(request, false)
  }

  async function refreshAfterPull(repoId: string, includeStashes: boolean) {
    if (repoStore.activeRepoId !== repoId) return
    const tasks: Promise<unknown>[] = [
      historyStore.loadLog(),
      historyStore.loadBranches(),
      workspaceStore.refresh(repoId),
    ]
    if (includeStashes) tasks.push(stashStore.refresh())
    await Promise.all(tasks)
  }

  async function runPull(request: PullRequest, autoStash: boolean) {
    const { repoId, remote, branch, mode } = request
    if (repoStore.activeRepoId !== repoId || currentBranch.value !== branch) return
    repoOpsStore.setBusy(repoId, 'pull', true)
    let pullSucceeded = false
    let restoreCompleted = true
    try {
      if (autoStash) {
        const result = await runPullWithAutoStash({
          stash: () => git.stashPush(
            repoId,
            t('toolbar.pullWithChanges.stashMessage', { remote, branch }),
          ),
          pull: () => git.pullBranch(repoId, remote, branch, mode),
          getRepoState: () => git.getRepoState(repoId),
          restore: () => git.stashPop(repoId, 0),
        })
        pullSucceeded = result.pullSucceeded
        restoreCompleted = result.restore.kind === 'restored'

        if (result.restore.kind === 'deferred') {
          showError(result.restore.repoState === 'unknown'
            ? t('toolbar.pullWithChanges.restoreDeferredUnknown')
            : t('toolbar.pullWithChanges.restoreDeferred'))
        } else if (result.restore.kind === 'failed') {
          showError(t('toolbar.pullWithChanges.restoreFailed', {
            detail: String(result.restore.cause),
          }))
        }
      } else {
        await git.pullBranch(repoId, remote, branch, mode)
        pullSucceeded = true
      }

      await refreshAfterPull(repoId, autoStash)
      if (pullSucceeded && restoreCompleted) {
        showToast('success', t('toolbar.opSuccess', { label: t('toolbar.opLabels.pull') }))
      }
    } catch {
      // 错误在 ToolbarToast 中拦截处理
    } finally {
      repoOpsStore.setBusy(repoId, 'pull', false)
    }
  }

  async function confirmPullWithStash() {
    const request = pendingPull.value
    if (!request || pullWithChangesLoading.value) return
    if (repoStore.activeRepoId !== request.repoId || currentBranch.value !== request.branch) {
      cancelPullWithStash()
      return
    }

    pullWithChangesLoading.value = true
    try {
      await runPull(request, true)
    } finally {
      pullWithChangesLoading.value = false
      pendingPull.value = null
      pendingPullChangeCount.value = 0
    }
  }

  function cancelPullWithStash() {
    if (pullWithChangesLoading.value) return
    pendingPull.value = null
    pendingPullChangeCount.value = 0
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
    // remote 菜单等待期间可能已切换仓库 / 分支，旧 Push 请求不再有效。
    if (repoStore.activeRepoId !== id || currentBranch.value !== branch) return

    const request: PushRequest = { repoId: id, remote, branch, mode }
    if (requiresForcePushConfirmation(mode)) {
      pendingForcePush.value = request
      return
    }

    await runPush(request)
  }

  async function runPush(request: PushRequest) {
    const { repoId, remote, branch, mode } = request
    if (repoStore.activeRepoId !== repoId || currentBranch.value !== branch) return
    const publishing = !currentBranchInfo.value?.upstream
    repoOpsStore.setBusy(repoId, 'push', true)
    try {
      await git.pushBranch(repoId, remote, branch, mode)
      await historyStore.loadBranches()
      workspaceStore.clearUndoCommitCandidate(repoId)
      showToast('success', t('toolbar.opSuccess', {
        label: t(publishing ? 'toolbar.opLabels.publishBranch' : 'toolbar.opLabels.push'),
      }))
    } catch {
      // 错误在 ToolbarToast 中拦截处理
    } finally {
      repoOpsStore.setBusy(repoId, 'push', false)
    }
  }

  async function confirmForcePush() {
    const request = pendingForcePush.value
    if (!request || forcePushLoading.value) return
    if (repoStore.activeRepoId !== request.repoId || currentBranch.value !== request.branch) {
      cancelForcePush()
      return
    }

    forcePushLoading.value = true
    try {
      await runPush(request)
    } finally {
      forcePushLoading.value = false
      pendingForcePush.value = null
    }
  }

  function cancelForcePush() {
    if (forcePushLoading.value) return
    pendingForcePush.value = null
  }

  async function onStash() {
    if (!canStash.value) return
    const id = repoStore.activeRepoId
    if (!id) return
    repoOpsStore.setBusy(id, 'stash', true)
    try {
      const repoPath = repoStore.activeRepo()?.path
      const draft = workspaceStore.commitDraft
      const message = draft.trim()
      await stashStore.push(message || undefined)
      if (repoPath && message) workspaceStore.clearCommitDraftIfUnchanged(repoPath, draft)
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
    const entry = stashStore.entries.find((stash) => stash.index === 0)
    if (!entry) return
    const changeCount = countChangedWorkspacePaths(workspaceStore.status)
    if (changeCount > 0) {
      pendingStashPop.value = {
        repoId: id,
        index: entry.index,
        commitOid: entry.commit_oid,
        message: entry.message,
        changeCount,
      }
      return
    }

    await runStashPop(id, entry.index, entry.commit_oid)
  }

  async function runStashPop(repoId: string, index: number, expectedOid: string) {
    if (repoStore.activeRepoId !== repoId) return
    repoOpsStore.setBusy(repoId, 'pop', true)
    try {
      await stashStore.pop(index, expectedOid)
    } catch {
      // 错误在 ToolbarToast 中拦截处理
    } finally {
      repoOpsStore.setBusy(repoId, 'pop', false)
    }
  }

  async function confirmStashPop() {
    const pending = pendingStashPop.value
    if (!pending || stashPopLoading.value) return
    if (repoStore.activeRepoId !== pending.repoId) {
      cancelStashPop()
      return
    }
    if (!isSameStashTarget(stashStore.entries, pending.index, pending.commitOid)) {
      cancelStashPop()
      showError(t('toolbar.stashPopConfirm.targetChanged'))
      return
    }

    stashPopLoading.value = true
    try {
      await runStashPop(pending.repoId, pending.index, pending.commitOid)
    } finally {
      stashPopLoading.value = false
      pendingStashPop.value = null
    }
  }

  function cancelStashPop() {
    if (stashPopLoading.value) return
    pendingStashPop.value = null
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

  async function onRefreshRepository() {
    try {
      await refreshActiveRepository()
    } catch (e: unknown) {
      showActionError(e)
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

  async function onUndoLastCommit() {
    if (!canUndoLastCommit.value || undoingCommit.value) return
    undoingCommit.value = true
    try {
      const undoneRepoId = await workspaceStore.undoLastCommit()
      if (!undoneRepoId || repoStore.activeRepoId !== undoneRepoId) return
      await Promise.all([historyStore.loadLog(), historyStore.loadBranches()])
      if (repoStore.activeRepoId !== undoneRepoId) return
      historyStore.selectedCommit = null
      historyStore.selectedWip = true
      historyStore.showDetail = true
      showToast('success', t('toolbar.opSuccess', { label: t('toolbar.opLabels.undoCommit') }))
    } catch {
      // 错误在 ToolbarToast 中拦截处理
    } finally {
      undoingCommit.value = false
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
    isPublishingBranch,
    canStash,
    canStashPop,
    pullWithChangesVisible,
    pendingPullChangeCount,
    pullWithChangesLoading,
    forcePushVisible,
    forcePushTarget,
    forcePushLoading,
    stashPopConfirmVisible,
    stashPopTarget,
    stashPopLoading,
    canUndoLastCommit,
    undoingCommit,
    withShortcut,
    showAddRepoMenu,
    onPull,
    doPull,
    confirmPullWithStash,
    cancelPullWithStash,
    onPush,
    doPush,
    confirmForcePush,
    cancelForcePush,
    onStash,
    onPop,
    confirmStashPop,
    cancelStashPop,
    onFetch,
    onRefreshRepository,
    onOpenSystemTerminal,
    onUndoLastCommit,
  }
}
