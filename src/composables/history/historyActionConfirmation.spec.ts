import { describe, expect, it } from 'vitest'
import {
  isHistoryActionContextCurrent,
  type HistoryActionConfirmation,
} from './historyActionConfirmation'

const presentation = {
  title: 'Confirm',
  message: 'Message',
  confirmLabel: 'Continue',
  loadingLabel: 'Running',
  danger: false,
}

describe('isHistoryActionContextCurrent', () => {
  it('requires both repository and HEAD to match for commit actions', () => {
    const pending: HistoryActionConfirmation = {
      ...presentation,
      kind: 'cherry-pick',
      repoId: 'repo-a',
      expectedHeadOid: 'head-a',
      expectedHeadRef: 'refs/heads/main',
      commitOid: 'commit-a',
    }

    expect(isHistoryActionContextCurrent(
      pending,
      'repo-a',
      'head-a',
      'refs/heads/main',
    )).toBe(true)
    expect(isHistoryActionContextCurrent(
      pending,
      'repo-b',
      'head-a',
      'refs/heads/main',
    )).toBe(false)
    expect(isHistoryActionContextCurrent(
      pending,
      'repo-a',
      'head-b',
      'refs/heads/main',
    )).toBe(false)
    expect(isHistoryActionContextCurrent(
      pending,
      'repo-a',
      'head-a',
      'refs/heads/other',
    )).toBe(false)
  })

  it('keeps stash deletion independent of HEAD while still binding the repository', () => {
    const pending: HistoryActionConfirmation = {
      ...presentation,
      kind: 'stash-drop',
      repoId: 'repo-a',
      index: 2,
      commitOid: 'stash-a',
    }

    expect(isHistoryActionContextCurrent(pending, 'repo-a', 'head-b', 'HEAD')).toBe(true)
    expect(isHistoryActionContextCurrent(pending, null, 'head-b', 'HEAD')).toBe(false)
  })
})
