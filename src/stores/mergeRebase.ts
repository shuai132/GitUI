import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type {
  ConflictFile,
  MergeStrategy,
  RebaseTodoItem,
  RepoState,
} from '@/types/git'
import { useGitCommands } from '@/composables/useGitCommands'
import { useRepoStore } from './repos'
import { useHistoryStore } from './history'
import { useStashStore } from './stash'
import { useWorkspaceStore } from './workspace'
import { t } from '@/i18n'
import { runWithAutoStash, type AutoStashRestore } from '@/utils/autoStash'

/**
 * Merge / Rebase 相关状态与操作。
 * `repoState` 是 `get_status` 的一部分，由 workspace store 在 refresh 时同步到这里，
 * 这样 OngoingOpBanner / WipPanel / 对话框都能读同一份状态。
 */
export const useMergeRebaseStore = defineStore('mergeRebase', () => {
  const repoState = ref<RepoState | null>(null)
  const conflictCache = ref<Map<string, ConflictFile>>(new Map())
  const busy = ref(false)
  const lastError = ref<string | null>(null)

  const git = useGitCommands()

  const isOngoing = computed(() => {
    const k = repoState.value?.kind
    return !!k && k !== 'clean'
  })

  const isMerging = computed(() => repoState.value?.kind === 'merge')
  const isRebasing = computed(() => {
    const k = repoState.value?.kind
    return k === 'rebase' || k === 'rebase_interactive' || k === 'rebase_merge'
  })
  const isCherryPicking = computed(() => repoState.value?.kind === 'cherry_pick')
  const isReverting = computed(() => repoState.value?.kind === 'revert')

  function setRepoState(state: RepoState | null) {
    repoState.value = state
    // 切状态时清冲突缓存
    conflictCache.value = new Map()
  }

  async function refreshFromServer() {
    const repoStore = useRepoStore()
    if (!repoStore.activeRepoId) return
    try {
      const state = await git.getRepoState(repoStore.activeRepoId)
      setRepoState(state)
    } catch (e: unknown) {
      lastError.value = String(e)
    }
  }

  async function refreshAfterHeadChange(repoId: string, includeStashes = false) {
    if (useRepoStore().activeRepoId !== repoId) return
    const historyStore = useHistoryStore()
    const workspaceStore = useWorkspaceStore()
    // workspace.refresh 内部会更新 repoState（通过 setRepoState 钩子）
    const tasks: Promise<unknown>[] = [
      historyStore.loadLog(),
      historyStore.loadBranches(),
      workspaceStore.refresh(repoId),
    ]
    if (includeStashes) tasks.push(useStashStore().refresh())
    await Promise.all(tasks)
  }

  function restoreNotice(restore: AutoStashRestore): string | null {
    if (restore.kind === 'restored') return null
    if (restore.kind === 'failed') {
      return t('errors.autoStash.popFailed', { detail: String(restore.cause) })
    }
    return restore.repoState === 'unknown'
      ? t('errors.autoStash.restoreDeferredUnknown')
      : t('errors.autoStash.restoreDeferred')
  }

  async function runIntegrationWithAutoStash(
    repoId: string,
    stashMessage: string,
    operation: () => Promise<void>,
  ) {
    const result = await runWithAutoStash({
      stash: () => git.stashPush(repoId, stashMessage),
      operation,
      getRepoState: () => git.getRepoState(repoId),
      restore: (stashOid) => git.stashPop(repoId, 0, stashOid),
    })
    const notice = restoreNotice(result.restore)
    if (notice) lastError.value = notice
    if (result.operationError !== null) {
      if (notice) throw new Error(`${String(result.operationError)}\n\n${notice}`)
      throw result.operationError
    }
    if (notice) throw new Error(notice)
  }

  // ── Merge ────────────────────────────────────────────────────────────

  async function startMerge(
    repoId: string,
    sourceBranch: string,
    strategy: MergeStrategy,
    message: string | null,
    autoStash = false,
    expectedHead: string,
    expectedHeadRef: string,
    expectedSource: string,
  ) {
    busy.value = true
    lastError.value = null
    const shouldAutoStash = autoStash && hasWorktreeChanges(repoId)
    try {
      const operation = () => git.mergeBranch(
        repoId,
        sourceBranch,
        strategy,
        message,
        expectedHead,
        expectedHeadRef,
        expectedSource,
      )
      if (shouldAutoStash) {
        await runIntegrationWithAutoStash(
          repoId,
          'gitui: auto-stash before merge',
          operation,
        )
      } else {
        await operation()
      }
    } finally {
      busy.value = false
      await refreshAfterHeadChange(repoId, shouldAutoStash)
    }
  }

  function hasWorktreeChanges(repoId: string): boolean {
    if (useRepoStore().activeRepoId !== repoId) return false
    const s = useWorkspaceStore().status
    if (!s) return false
    return (s.staged?.length ?? 0) + (s.unstaged?.length ?? 0) + (s.untracked?.length ?? 0) > 0
  }

  async function continueMerge(message: string) {
    const repoStore = useRepoStore()
    const repoId = repoStore.activeRepoId
    if (!repoId) return
    busy.value = true
    try {
      await git.mergeContinue(repoId, message)
    } finally {
      busy.value = false
      await refreshAfterHeadChange(repoId)
    }
  }

  async function abortMerge() {
    const repoStore = useRepoStore()
    const repoId = repoStore.activeRepoId
    if (!repoId) return
    busy.value = true
    try {
      await git.mergeAbort(repoId)
    } finally {
      busy.value = false
      await refreshAfterHeadChange(repoId)
    }
  }

  // ── Rebase ───────────────────────────────────────────────────────────

  async function planRebase(
    repoId: string,
    upstream: string,
    onto: string | null,
    expectedHead: string,
    expectedHeadRef: string,
    expectedUpstream: string,
    expectedOnto: string | null,
  ) {
    return git.rebasePlan(
      repoId,
      upstream,
      onto,
      expectedHead,
      expectedHeadRef,
      expectedUpstream,
      expectedOnto,
    )
  }

  async function startRebase(
    repoId: string,
    upstream: string,
    onto: string | null,
    todo: RebaseTodoItem[] | null,
    autoStash = false,
    expectedHead: string,
    expectedHeadRef: string,
    expectedUpstream: string,
    expectedOnto: string | null,
  ) {
    busy.value = true
    lastError.value = null
    const shouldAutoStash = autoStash && hasWorktreeChanges(repoId)
    try {
      const operation = () => git.rebaseStart(
        repoId,
        upstream,
        onto,
        todo,
        expectedHead,
        expectedHeadRef,
        expectedUpstream,
        expectedOnto,
      )
      if (shouldAutoStash) {
        await runIntegrationWithAutoStash(
          repoId,
          'gitui: auto-stash before rebase',
          operation,
        )
      } else {
        await operation()
      }
    } finally {
      busy.value = false
      await refreshAfterHeadChange(repoId, shouldAutoStash)
    }
  }

  async function continueRebase(amendedMessage: string | null) {
    const repoStore = useRepoStore()
    const repoId = repoStore.activeRepoId
    if (!repoId) return
    busy.value = true
    try {
      await git.rebaseContinue(repoId, amendedMessage)
    } finally {
      busy.value = false
      await refreshAfterHeadChange(repoId)
    }
  }

  async function skipRebase() {
    const repoStore = useRepoStore()
    const repoId = repoStore.activeRepoId
    if (!repoId) return
    busy.value = true
    try {
      await git.rebaseSkip(repoId)
    } finally {
      busy.value = false
      await refreshAfterHeadChange(repoId)
    }
  }

  async function abortRebase() {
    const repoStore = useRepoStore()
    const repoId = repoStore.activeRepoId
    if (!repoId) return
    busy.value = true
    try {
      await git.rebaseAbort(repoId)
    } finally {
      busy.value = false
      await refreshAfterHeadChange(repoId)
    }
  }

  // ── Cherry-pick / Revert ─────────────────────────────────────────────

  async function continueCherryPick() {
    const repoStore = useRepoStore()
    const repoId = repoStore.activeRepoId
    if (!repoId) return
    busy.value = true
    try {
      await git.cherryPickContinue(repoId)
    } finally {
      busy.value = false
      await refreshAfterHeadChange(repoId)
    }
  }

  async function abortCherryPick() {
    const repoStore = useRepoStore()
    const repoId = repoStore.activeRepoId
    if (!repoId) return
    busy.value = true
    try {
      await git.cherryPickAbort(repoId)
    } finally {
      busy.value = false
      await refreshAfterHeadChange(repoId)
    }
  }

  async function continueRevert() {
    const repoStore = useRepoStore()
    const repoId = repoStore.activeRepoId
    if (!repoId) return
    busy.value = true
    try {
      await git.revertContinue(repoId)
    } finally {
      busy.value = false
      await refreshAfterHeadChange(repoId)
    }
  }

  async function abortRevert() {
    const repoStore = useRepoStore()
    const repoId = repoStore.activeRepoId
    if (!repoId) return
    busy.value = true
    try {
      await git.revertAbort(repoId)
    } finally {
      busy.value = false
      await refreshAfterHeadChange(repoId)
    }
  }

  // ── Conflict ─────────────────────────────────────────────────────────

  async function loadConflictFile(filePath: string): Promise<ConflictFile | null> {
    const repoStore = useRepoStore()
    if (!repoStore.activeRepoId) return null
    const cached = conflictCache.value.get(filePath)
    if (cached) return cached
    try {
      const file = await git.getConflictFile(repoStore.activeRepoId, filePath)
      conflictCache.value.set(filePath, file)
      return file
    } catch (e: unknown) {
      lastError.value = String(e)
      return null
    }
  }

  async function resolveConflict(filePath: string, content: string) {
    const repoStore = useRepoStore()
    if (!repoStore.activeRepoId) return
    await git.markConflictResolved(repoStore.activeRepoId, filePath, content)
    conflictCache.value.delete(filePath)
    const workspaceStore = useWorkspaceStore()
    await workspaceStore.refresh()
  }

  async function useConflictSide(filePath: string, side: 'ours' | 'theirs') {
    const repoStore = useRepoStore()
    if (!repoStore.activeRepoId) return
    await git.checkoutConflictSide(repoStore.activeRepoId, filePath, side)
    conflictCache.value.delete(filePath)
    const workspaceStore = useWorkspaceStore()
    await workspaceStore.refresh()
  }

  // ── 拖拽触发的临时状态（在 HistoryView 和 DragActionDialog 间共享） ──
  const dragPayload = ref<{ sourceOid: string; targetOid: string } | null>(null)

  function reset() {
    repoState.value = null
    conflictCache.value = new Map()
    busy.value = false
    lastError.value = null
    dragPayload.value = null
  }

  return {
    repoState,
    busy,
    lastError,
    isOngoing,
    isMerging,
    isRebasing,
    isCherryPicking,
    isReverting,
    dragPayload,
    setRepoState,
    refreshFromServer,
    startMerge,
    continueMerge,
    abortMerge,
    planRebase,
    startRebase,
    continueRebase,
    skipRebase,
    abortRebase,
    continueCherryPick,
    abortCherryPick,
    continueRevert,
    abortRevert,
    loadConflictFile,
    resolveConflict,
    useConflictSide,
    reset,
  }
})
