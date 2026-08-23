import { describe, expect, it } from 'vitest'
import { mapGitError } from './errorMap'

describe('mapGitError commit undo', () => {
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
})
