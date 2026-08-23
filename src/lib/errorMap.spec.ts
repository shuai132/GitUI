import { describe, expect, it } from 'vitest'
import { mapGitError } from './errorMap'

describe('mapGitError', () => {
  it('maps a published commit to the shared-history guidance', () => {
    expect(mapGitError('undo_last_commit', {
      kind: 'OperationFailed',
      message: '提交已发布到上游，请使用 Revert 保留共享历史',
    })).toMatchObject({ key: 'errors.commit.undoPublished' })
  })

  it('maps stale undo state without exposing a backend-language message', () => {
    expect(mapGitError('undo_last_commit', {
      kind: 'OperationFailed',
      message: 'HEAD 已变化，不能撤销过期的提交',
    })).toMatchObject({ key: 'errors.commit.undoUnavailable' })
  })

  it('maps an unfinished operation to actionable Pull guidance', () => {
    expect(mapGitError('pull_branch', {
      kind: 'OperationFailed',
      message: 'Cannot pull: repository has an unfinished Git operation. Resolve or abort it first.',
    })).toMatchObject({ key: 'errors.pull.ongoingOperation' })
  })

  it('maps a stale stash identity to a safe retry message', () => {
    expect(mapGitError('stash_pop', {
      kind: 'OperationFailed',
      message: 'Stash target changed: expected old, current new',
    })).toMatchObject({ key: 'errors.stash.targetChanged' })
  })

  it('maps a stale confirmed history action to a safe retry message', () => {
    expect(mapGitError('reset_to_commit', {
      kind: 'OperationFailed',
      message: 'Confirmed Git action context changed: expected HEAD old, current new',
    })).toMatchObject({ key: 'errors.history.contextChanged' })
  })

  it('maps a changed reflog removal preview to review guidance', () => {
    expect(mapGitError('drop_unreachable_commit', {
      kind: 'OperationFailed',
      message: 'Reflog removal context changed; preview the affected entries again',
    })).toMatchObject({ key: 'errors.reflog.contextChanged' })
  })
})
