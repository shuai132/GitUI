import { computed, type Ref } from 'vue'
import type { useDiffStore } from '@/stores/diff'
import type { useHistoryStore } from '@/stores/history'
import type { useWorkspaceStore } from '@/stores/workspace'

type FileStats = {
  modified: number
  deleted: number
  added: number
}

export function useHistoryDiffState({
  selectedWip,
  historyStore,
  diffStore,
  workspaceStore,
}: {
  selectedWip: Ref<boolean>
  historyStore: ReturnType<typeof useHistoryStore>
  diffStore: ReturnType<typeof useDiffStore>
  workspaceStore: ReturnType<typeof useWorkspaceStore>
}) {
  const wipStats = computed<FileStats>(() => {
    const status = workspaceStore.status
    if (!status) return { modified: 0, deleted: 0, added: 0 }

    let modified = 0
    let deleted = 0
    let added = 0

    const allFiles = [...status.staged, ...status.unstaged, ...status.untracked]
    for (const file of allFiles) {
      if (file.status === 'deleted') {
        deleted++
      } else if (file.status === 'added' || file.status === 'untracked') {
        added++
      } else {
        modified++
      }
    }

    return { modified, deleted, added }
  })

  const commitStats = computed<FileStats>(() => {
    const diffs = historyStore.selectedCommit?.diffs ?? []
    let modified = 0
    let deleted = 0
    let added = 0

    for (const diff of diffs) {
      if (!diff.new_path || diff.new_path === '/dev/null') {
        deleted++
      } else if (!diff.old_path || diff.old_path === '/dev/null') {
        added++
      } else {
        modified++
      }
    }

    return { modified, deleted, added }
  })

  const currentDiff = computed(() => {
    if (selectedWip.value) return diffStore.currentDiff
    const commit = historyStore.selectedCommit
    if (!commit) return null
    return commit.diffs[historyStore.selectedFileDiffIndex] ?? null
  })

  const currentConflictFilePath = computed<string | null>(() => {
    if (!selectedWip.value) return null
    const path = diffStore.currentPath
    if (!path) return null
    const status = workspaceStore.status
    if (!status) return null
    const allFiles = [...status.staged, ...status.unstaged, ...status.untracked]
    const file = allFiles.find((item) => item.path === path)
    return file?.status === 'conflicted' ? path : null
  })

  return {
    wipStats,
    commitStats,
    currentDiff,
    currentConflictFilePath,
  }
}
