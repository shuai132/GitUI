import { describe, expect, it } from 'vitest'
import {
  createDiscardPathPreview,
  isWorkspaceDiscardContextCurrent,
  type PendingWorkspaceDiscard,
} from './workspaceDiscardConfirmation'

describe('createDiscardPathPreview', () => {
  it('shows short selections in full', () => {
    expect(createDiscardPathPreview(['a.ts', 'b.ts'])).toEqual({
      visiblePaths: ['a.ts', 'b.ts'],
      remainingCount: 0,
    })
  })

  it('limits long selections and reports the remaining count', () => {
    expect(createDiscardPathPreview(['1', '2', '3', '4', '5', '6', '7'])).toEqual({
      visiblePaths: ['1', '2', '3', '4', '5'],
      remainingCount: 2,
    })
  })
})

describe('isWorkspaceDiscardContextCurrent', () => {
  const request: PendingWorkspaceDiscard = {
    repoId: 'repo-a',
    kind: 'selected',
    paths: ['a.ts'],
  }

  it('binds the captured paths to the repository that was confirmed', () => {
    expect(isWorkspaceDiscardContextCurrent(request, 'repo-a')).toBe(true)
    expect(isWorkspaceDiscardContextCurrent(request, 'repo-b')).toBe(false)
    expect(isWorkspaceDiscardContextCurrent(request, null)).toBe(false)
  })
})
