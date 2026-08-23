import type { StashEntry, WorkspaceStatus } from '@/types/git'

export function countChangedWorkspacePaths(status: WorkspaceStatus | null): number {
  if (!status) return 0
  return new Set([
    ...status.staged,
    ...status.unstaged,
    ...status.untracked,
  ].map((file) => file.path)).size
}

export function isSameStashTarget(
  entries: StashEntry[],
  index: number,
  commitOid: string,
): boolean {
  const current = entries.find((stash) => stash.index === index)
  return current?.commit_oid === commitOid
}
