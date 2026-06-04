import { useDiffStore } from '@/stores/diff'
import { useHistoryStore } from '@/stores/history'
import { useRepoOpsStore } from '@/stores/repoOps'
import { useRepoStore } from '@/stores/repos'
import { useStashStore } from '@/stores/stash'
import { useSubmodulesStore } from '@/stores/submodules'
import { useWorkspaceStore } from '@/stores/workspace'
import { findWipFileBySelection } from '@/utils/wipSelection'

export function useRepositoryRefresh() {
  const repoStore = useRepoStore()
  const repoOpsStore = useRepoOpsStore()
  const workspaceStore = useWorkspaceStore()
  const historyStore = useHistoryStore()
  const stashStore = useStashStore()
  const submodulesStore = useSubmodulesStore()
  const diffStore = useDiffStore()

  async function refreshCurrentWipDiff() {
    if (!diffStore.currentPath) return

    const status = workspaceStore.status
    const allFiles = [
      ...(status?.staged ?? []),
      ...(status?.unstaged ?? []),
      ...(status?.untracked ?? []),
    ]
    const wipFile = findWipFileBySelection(
      allFiles,
      diffStore.currentPath,
      diffStore.currentStaged,
    )

    if (wipFile) {
      diffStore.currentStaged = wipFile.staged
      await diffStore.refresh()
    } else {
      diffStore.clear()
    }
  }

  async function refreshActiveRepository() {
    const repoId = repoStore.activeRepoId
    if (!repoId) return
    if (repoOpsStore.getBusy(repoId).refresh) return

    repoOpsStore.setBusy(repoId, 'refresh', true)
    try {
      await Promise.all([
        workspaceStore.refresh(repoId),
        historyStore.loadLog(),
        historyStore.loadBranches(),
        historyStore.loadTags(),
        stashStore.refresh(),
        submodulesStore.loadSubmodules(),
      ])

      if (repoStore.activeRepoId !== repoId) return
      await refreshCurrentWipDiff()
    } finally {
      repoOpsStore.setBusy(repoId, 'refresh', false)
    }
  }

  return {
    refreshActiveRepository,
    refreshCurrentWipDiff,
  }
}
