import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import type { FileDiff } from '@/types/git'
import { useGitCommands } from '@/composables/useGitCommands'
import { useGlobalToast } from '@/composables/useGlobalToast'
import { buildHunkPatch } from '@/lib/hunkPatch'

type UseRevertHunkOptions = {
  repoId: MaybeRefOrGetter<string | undefined>
  diff: MaybeRefOrGetter<FileDiff | null | undefined>
  wip: MaybeRefOrGetter<{ staged: boolean } | null | undefined>
}

export function useRevertHunk(options: UseRevertHunkOptions) {
  const { applyPatch } = useGitCommands()
  const { showActionError } = useGlobalToast()

  const allowRevert = computed(() => !toValue(options.wip) && toValue(options.diff) != null)

  async function revertHunk(hunkIndex: number) {
    const repoId = toValue(options.repoId)
    const diff = toValue(options.diff)
    if (!repoId || !diff) return

    const patchText = buildHunkPatch(diff, hunkIndex, 'reverse')
    if (!patchText) return

    try {
      await applyPatch(repoId, patchText)
    } catch (err) {
      showActionError(err)
    }
  }

  return {
    allowRevert,
    revertHunk,
  }
}
