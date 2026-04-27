import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import type { FileDiff } from '@/types/git'
import { useGitCommands } from '@/composables/useGitCommands'

type UseRevertHunkOptions = {
  repoId: MaybeRefOrGetter<string | undefined>
  diff: MaybeRefOrGetter<FileDiff | null | undefined>
  wip: MaybeRefOrGetter<{ staged: boolean } | null | undefined>
}

export function useRevertHunk(options: UseRevertHunkOptions) {
  const { applyPatch } = useGitCommands()

  const allowRevert = computed(() => !toValue(options.wip) && toValue(options.diff) != null)

  async function revertHunk(hunkIndex: number) {
    const repoId = toValue(options.repoId)
    const diff = toValue(options.diff)
    if (!repoId || !diff) return

    const hunk = diff.hunks[hunkIndex]
    if (!hunk) return

    const oldPath = diff.old_path ?? diff.new_path
    const newPath = diff.new_path ?? diff.old_path

    const lines: string[] = []
    lines.push(`diff --git a/${oldPath} b/${newPath}\n`)
    lines.push(`--- a/${oldPath}\n`)
    lines.push(`+++ b/${newPath}\n`)

    const match = hunk.header.match(/^@@[^@]+@@(.*)$/)
    const ctx = match ? match[1] : ''
    lines.push(`@@ -${hunk.new_start},${hunk.new_lines} +${hunk.old_start},${hunk.old_lines} @@${ctx}`)
    if (!lines[lines.length - 1].endsWith('\n')) {
      lines[lines.length - 1] += '\n'
    }

    for (const line of hunk.lines) {
      let prefix = ' '
      if (line.origin === '-') prefix = '+'
      else if (line.origin === '+') prefix = '-'

      const content = line.content.endsWith('\n') ? line.content : `${line.content}\n`
      lines.push(`${prefix}${content}`)
    }

    try {
      await applyPatch(repoId, lines.join(''))
    } catch (err) {
      console.error('Failed to revert hunk:', err)
    }
  }

  return {
    allowRevert,
    revertHunk,
  }
}
