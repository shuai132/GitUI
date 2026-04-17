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

  async function refreshAfterHeadChange() {
    const historyStore = useHistoryStore()
    const workspaceStore = useWorkspaceStore()
    // workspace.refresh 内部会更新 repoState（通过 setRepoState 钩子）
    await Promise.all([
      historyStore.loadLog(),
      historyStore.loadBranches(),
      workspaceStore.refresh(),
    ])
  }

  // ── Merge ────────────────────────────────────────────────────────────

  async function startMerge(
    sourceBranch: string,
    strategy: MergeStrategy,
    message: string | null,
    autoStash = false,
  ) {
    const repoStore = useRepoStore()
    const id = repoStore.activeRepoId
    if (!id) return
    busy.value = true
    let stashed = false
    try {
      if (autoStash && hasWorktreeChanges()) {
        await git.stashPush(id, 'gitui: auto-stash before merge')
        stashed = true
      }
      await git.mergeBranch(id, sourceBranch, strategy, message)
    } finally {
      busy.value = false
      await refreshAfterHeadChange()
      if (stashed) {
        try {
          await git.stashPop(id, 0)
        } catch (e) {
          lastError.value = `自动 stash pop 失败，请手动处理：${String(e)}`
        }
      }
    }
  }

  function hasWorktreeChanges(): boolean {
    const s = useWorkspaceStore().status
    if (!s) return false
    return (s.staged?.length ?? 0) + (s.unstaged?.length ?? 0) + (s.untracked?.length ?? 0) > 0
  }

  async function continueMerge(message: string) {
    const repoStore = useRepoStore()
    if (!repoStore.activeRepoId) return
    busy.value = true
    try {
      await git.mergeContinue(repoStore.activeRepoId, message)
    } finally {
      busy.value = false
      await refreshAfterHeadChange()
    }
  }

  async function abortMerge() {
    const repoStore = useRepoStore()
    if (!repoStore.activeRepoId) return
    busy.value = true
    try {
      await git.mergeAbort(repoStore.activeRepoId)
    } finally {
      busy.value = false
      await refreshAfterHeadChange()
    }
  }

  // ── Rebase ───────────────────────────────────────────────────────────

  async function planRebase(upstream: string, onto: string | null) {
    const repoStore = useRepoStore()
    if (!repoStore.activeRepoId) return []
    return git.rebasePlan(repoStore.activeRepoId, upstream, onto)
  }

  async function startRebase(
    upstream: string,
    onto: string | null,
    todo: RebaseTodoItem[] | null,
    autoStash = false,
  ) {
    const repoStore = useRepoStore()
    const id = repoStore.activeRepoId
    if (!id) return
    busy.value = true
    let stashed = false
    try {
      if (autoStash && hasWorktreeChanges()) {
        await git.stashPush(id, 'gitui: auto-stash before rebase')
        stashed = true
      }
      await git.rebaseStart(id, upstream, onto, todo)
    } finally {
      busy.value = false
      await refreshAfterHeadChange()
      if (stashed) {
        try {
          await git.stashPop(id, 0)
        } catch (e) {
          lastError.value = `自动 stash pop 失败，请手动处理：${String(e)}`
        }
      }
    }
  }

  async function continueRebase(amendedMessage: string | null) {
    const repoStore = useRepoStore()
    if (!repoStore.activeRepoId) return
    busy.value = true
    try {
      await git.rebaseContinue(repoStore.activeRepoId, amendedMessage)
    } finally {
      busy.value = false
      await refreshAfterHeadChange()
    }
  }

  async function skipRebase() {
    const repoStore = useRepoStore()
    if (!repoStore.activeRepoId) return
    busy.value = true
    try {
      await git.rebaseSkip(repoStore.activeRepoId)
    } finally {
      busy.value = false
      await refreshAfterHeadChange()
    }
  }

  async function abortRebase() {
    const repoStore = useRepoStore()
    if (!repoStore.activeRepoId) return
    busy.value = true
    try {
      await git.rebaseAbort(repoStore.activeRepoId)
    } finally {
      busy.value = false
      await refreshAfterHeadChange()
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
    loadConflictFile,
    resolveConflict,
    useConflictSide,
    reset,
  }
})
