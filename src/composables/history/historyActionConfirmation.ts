export type HistoryCommitAction = 'checkout' | 'cherry-pick' | 'revert'
export type HistoryResetMode = 'soft' | 'mixed' | 'hard'

interface ConfirmationPresentation {
  title: string
  message: string
  confirmLabel: string
  loadingLabel: string
  danger: boolean
}

interface CommitActionConfirmation extends ConfirmationPresentation {
  kind: HistoryCommitAction
  repoId: string
  expectedHeadOid: string
  expectedHeadRef: string
  commitOid: string
}

interface ResetConfirmation extends ConfirmationPresentation {
  kind: 'reset'
  repoId: string
  expectedHeadOid: string
  expectedHeadRef: string
  commitOid: string
  mode: HistoryResetMode
}

interface StashDropConfirmation extends ConfirmationPresentation {
  kind: 'stash-drop'
  repoId: string
  index: number
  commitOid: string
}

export type HistoryActionConfirmation =
  | CommitActionConfirmation
  | ResetConfirmation
  | StashDropConfirmation

export function isHistoryActionContextCurrent(
  pending: HistoryActionConfirmation,
  activeRepoId: string | null,
  headCommitOid: string,
  headRef: string,
): boolean {
  if (pending.repoId !== activeRepoId) return false
  if (pending.kind === 'stash-drop') return true
  return pending.expectedHeadOid === headCommitOid && pending.expectedHeadRef === headRef
}
