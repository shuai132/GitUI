export interface PendingWorkspaceDiscard {
  repoId: string
  kind: 'file' | 'selected'
  paths: string[]
}

export interface DiscardPathPreview {
  visiblePaths: string[]
  remainingCount: number
}

export function createDiscardPathPreview(
  paths: readonly string[],
  limit = 5,
): DiscardPathPreview {
  const visiblePaths = paths.slice(0, Math.max(0, limit))
  return {
    visiblePaths,
    remainingCount: Math.max(0, paths.length - visiblePaths.length),
  }
}

export function isWorkspaceDiscardContextCurrent(
  request: PendingWorkspaceDiscard,
  activeRepoId: string | null,
): boolean {
  return request.repoId === activeRepoId
}
