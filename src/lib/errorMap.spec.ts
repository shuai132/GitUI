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
})
