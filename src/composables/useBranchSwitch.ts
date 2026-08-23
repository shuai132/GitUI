import { ref } from 'vue'
import { t } from '@/i18n'
import { useHistoryStore } from '@/stores/history'
import { useStashStore } from '@/stores/stash'
import { useWorkspaceStore } from '@/stores/workspace'
import { useRepoStore } from '@/stores/repos'

export type BranchSwitchMode = 'carry' | 'stash' | 'discard'

export function useBranchSwitch() {
  const historyStore = useHistoryStore()
  const stashStore = useStashStore()
  const workspaceStore = useWorkspaceStore()
  const repoStore = useRepoStore()

  const dialogVisible = ref(false)
  const targetBranch = ref('')
  const sourceBranch = ref('HEAD')
  const changeCount = ref(0)
  const loading = ref(false)
  const activeMode = ref<BranchSwitchMode | null>(null)
  const changesStashed = ref(false)
  const changesDiscarded = ref(false)
  const error = ref<string | null>(null)
  const requestRepoId = ref<string | null>(null)
  const sourceHeadBranch = ref<string | undefined>()
  const sourceHeadOid = ref<string | undefined>()
  const targetBranchOid = ref<string | null>(null)
  const changedPaths = ref<string[]>([])

  function currentChangedPaths(): Set<string> {
    const status = workspaceStore.status
    return new Set([
      ...(status?.staged ?? []),
      ...(status?.unstaged ?? []),
      ...(status?.untracked ?? []),
    ].map((file) => file.path))
  }

  function samePaths(expected: readonly string[], current: Set<string>): boolean {
    return expected.length === current.size && expected.every((path) => current.has(path))
  }

  function contextIsCurrent(requireOriginalChanges: boolean): boolean {
    const repoId = requestRepoId.value
    const status = workspaceStore.status
    const currentTarget = historyStore.branches.find(
      (branch) => !branch.is_remote && branch.name === targetBranch.value,
    )
    return !!repoId &&
      repoStore.activeRepoId === repoId &&
      status?.head_branch === sourceHeadBranch.value &&
      status?.head_commit === sourceHeadOid.value &&
      (currentTarget?.commit_oid ?? null) === targetBranchOid.value &&
      (!requireOriginalChanges || samePaths(changedPaths.value, currentChangedPaths()))
  }

  async function runSwitch(mode: BranchSwitchMode, prompted: boolean) {
    if (!targetBranch.value || loading.value) return
    const repoId = requestRepoId.value
    if (!repoId || !contextIsCurrent(!changesStashed.value && !changesDiscarded.value)) {
      error.value = t('sidebar.branch.switchDialog.contextChanged')
      return
    }
    loading.value = true
    activeMode.value = mode
    error.value = null
    try {
      if (mode === 'stash' && !changesStashed.value) {
        await stashStore.push(t('sidebar.branch.switchDialog.stashMessage', {
          source: sourceBranch.value,
          target: targetBranch.value,
        }), repoId)
        changesStashed.value = true
      }
      if (mode === 'discard' && !changesDiscarded.value) {
        await workspaceStore.discardAll(repoId, sourceHeadOid.value, changedPaths.value)
        changesDiscarded.value = true
      }
      if (!contextIsCurrent(false)) {
        throw new Error(t('sidebar.branch.switchDialog.contextChanged'))
      }
      await historyStore.switchBranchInRepo(repoId, targetBranch.value)
      await workspaceStore.refresh(repoId)
      dialogVisible.value = false
      targetBranch.value = ''
      requestRepoId.value = null
      sourceHeadBranch.value = undefined
      sourceHeadOid.value = undefined
      targetBranchOid.value = null
      changedPaths.value = []
      changesStashed.value = false
      changesDiscarded.value = false
    } catch (cause) {
      if (!prompted) throw cause
      if (changesStashed.value) {
        error.value = t('sidebar.branch.switchDialog.failedAfterStash', {
          detail: String(cause),
        })
      } else if (changesDiscarded.value) {
        error.value = t('sidebar.branch.switchDialog.failedAfterDiscard', {
          detail: String(cause),
        })
      } else if (mode === 'stash') {
        error.value = t('sidebar.branch.switchDialog.stashFailed', { detail: String(cause) })
      } else if (mode === 'discard') {
        error.value = t('sidebar.branch.switchDialog.discardFailed', { detail: String(cause) })
      } else {
        error.value = t('sidebar.branch.switchDialog.carryFailed', { detail: String(cause) })
      }
    } finally {
      activeMode.value = null
      loading.value = false
    }
  }

  async function requestSwitch(name: string) {
    if (!name || loading.value) return
    const repoId = repoStore.activeRepoId
    if (!repoId) return
    targetBranch.value = name
    requestRepoId.value = repoId
    sourceHeadBranch.value = workspaceStore.status?.head_branch
    sourceBranch.value = sourceHeadBranch.value ?? 'HEAD'
    sourceHeadOid.value = workspaceStore.status?.head_commit
    targetBranchOid.value = historyStore.branches.find(
      (branch) => !branch.is_remote && branch.name === name,
    )?.commit_oid ?? null
    changedPaths.value = Array.from(currentChangedPaths())
    changeCount.value = changedPaths.value.length
    changesStashed.value = false
    changesDiscarded.value = false
    error.value = null

    if (changeCount.value === 0) {
      await runSwitch('carry', false)
      return
    }
    dialogVisible.value = true
  }

  async function confirmSwitch(mode: BranchSwitchMode) {
    await runSwitch(mode, true)
  }

  function cancelSwitch() {
    if (loading.value) return
    dialogVisible.value = false
    targetBranch.value = ''
    requestRepoId.value = null
    sourceHeadBranch.value = undefined
    sourceHeadOid.value = undefined
    targetBranchOid.value = null
    changedPaths.value = []
    changesStashed.value = false
    changesDiscarded.value = false
    error.value = null
  }

  return {
    dialogVisible,
    targetBranch,
    sourceBranch,
    changeCount,
    loading,
    activeMode,
    changesStashed,
    changesDiscarded,
    error,
    requestSwitch,
    confirmSwitch,
    cancelSwitch,
  }
}
