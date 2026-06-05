import type { StatusChangeKind } from '@/composables/useGitEvents'

export function shouldRefreshHistoryDomain(
  kind: StatusChangeKind,
  previousHead: string | null | undefined,
  nextHead: string | null | undefined,
): boolean {
  if (kind === 'refs' || kind === 'other_git') return true

  return (previousHead ?? null) !== (nextHead ?? null)
}
