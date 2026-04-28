import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import type { FileDiff, FileStatusKind } from '@/types/git'
import { useGitCommands } from '@/composables/useGitCommands'
import { useDiffStore } from '@/stores/diff'
import { useWorkspaceStore } from '@/stores/workspace'
import { buildHunkPatch } from '@/lib/hunkPatch'
import { findWipFileBySelection } from '@/utils/wipSelection'

export type WipHunkAction = 'stage' | 'unstage'

type UseWipHunkActionOptions = {
  repoId: MaybeRefOrGetter<string | undefined>
  diff: MaybeRefOrGetter<FileDiff | null | undefined>
  wip: MaybeRefOrGetter<{ staged: boolean; status?: FileStatusKind } | null | undefined>
}

export function useWipHunkAction(options: UseWipHunkActionOptions) {
  const { applyPatchToIndex, stageFile, unstageFile } = useGitCommands()
  const workspaceStore = useWorkspaceStore()
  const diffStore = useDiffStore()

  const action = computed<WipHunkAction | null>(() => {
    const diff = toValue(options.diff)
    const wip = toValue(options.wip)
    if (!diff || !wip || diff.is_binary || diff.hunks.length === 0) return null
    if (wip.status === 'renamed' || wip.status === 'conflicted') return null
    return wip.staged ? 'unstage' : 'stage'
  })

  async function applyWipHunk(hunkIndex: number) {
    const repoId = toValue(options.repoId)
    const diff = toValue(options.diff)
    const wip = toValue(options.wip)
    if (!repoId || !diff || !wip) return
    if (wip.status === 'renamed' || wip.status === 'conflicted') return

    if (isWholeFileIndexAction(wip.status)) {
      const filePath = diff.new_path ?? diff.old_path
      if (!filePath) return
      try {
        if (wip.staged) await unstageFile(repoId, filePath)
        else await stageFile(repoId, filePath)
        await workspaceStore.refresh(repoId)
        await refreshCurrentWipDiff()
      } catch (err) {
        console.error('Failed to apply WIP hunk:', err)
      }
      return
    }

    const patchText = buildHunkPatch(diff, hunkIndex, wip.staged ? 'reverse' : 'forward', {
      oldSideIsNull: wip.status === 'added' || wip.status === 'untracked',
      newSideIsNull: wip.status === 'deleted',
    })
    if (!patchText) return

    try {
      await applyPatchToIndex(repoId, patchText)
      await workspaceStore.refresh(repoId)
      await refreshCurrentWipDiff()
    } catch (err) {
      console.error('Failed to apply WIP hunk:', err)
    }
  }

  async function refreshCurrentWipDiff() {
    if (!diffStore.currentPath) return

    const s = workspaceStore.status
    const allFiles = [
      ...(s?.staged ?? []),
      ...(s?.unstaged ?? []),
      ...(s?.untracked ?? []),
    ]
    const wipFile = findWipFileBySelection(
      allFiles,
      diffStore.currentPath,
      diffStore.currentStaged,
    )
    if (!wipFile) {
      diffStore.clear()
      return
    }

    diffStore.currentStaged = wipFile.staged
    await diffStore.refresh()
  }

  return {
    action,
    applyWipHunk,
  }
}

function isWholeFileIndexAction(status: FileStatusKind | undefined): boolean {
  return status === 'added' || status === 'untracked' || status === 'deleted'
}
