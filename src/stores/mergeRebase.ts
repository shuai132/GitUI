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
import { useWorkspaceStore } from './workspace'
import { t } from '@/i18n'

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

  async function refreshAfterHeadChange(repoId: string) {
    if (useRepoStore().activeRepoId !== repoId) return
    const historyStore = useHistoryStore()
    const workspaceStore = useWorkspaceStore()
    // workspace.refresh 内部会更新 repoState（通过 setRepoState 钩子）
    await Promise.all([
      historyStore.loadLog(),
      historyStore.loadBranches(),
      workspaceStore.refresh(repoId),
    ])
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
    let stashed = false
    try {
      if (autoStash && hasWorktreeChanges(repoId)) {
        await git.stashPush(repoId, 'gitui: auto-stash before merge')
        stashed = true
      }
      await git.mergeBranch(
        repoId,
        sourceBranch,
        strategy,
        message,
        expectedHead,
        expectedHeadRef,
        expectedSource,
      )
    } finally {
      busy.value = false
      if (stashed) {
        try {
          await git.stashPop(repoId, 0)
        } catch (e) {
          lastError.value = t('errors.autoStash.popFailed', { detail: String(e) })
        }
      }
      await refreshAfterHeadChange(repoId)
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
    let stashed = false
    try {
      if (autoStash && hasWorktreeChanges(repoId)) {
        await git.stashPush(repoId, 'gitui: auto-stash before rebase')
        stashed = true
      }
      await git.rebaseStart(
        repoId,
        upstream,
        onto,
        todo,
        expectedHead,
        expectedHeadRef,
        expectedUpstream,
        expectedOnto,
      )
    } finally {
      busy.value = false
      if (stashed) {
        try {
          await git.stashPop(repoId, 0)
        } catch (e) {
          lastError.value = t('errors.autoStash.popFailed', { detail: String(e) })
        }
      }
      await refreshAfterHeadChange(repoId)
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
