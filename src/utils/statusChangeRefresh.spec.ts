import { describe, expect, it } from 'vitest'
import { shouldRefreshHistoryDomain } from './statusChangeRefresh'

describe('shouldRefreshHistoryDomain', () => {
  it('refreshes history for refs and conservative git events', () => {
    expect(shouldRefreshHistoryDomain('refs', 'a', 'a')).toBe(true)
    expect(shouldRefreshHistoryDomain('other_git', 'a', 'a')).toBe(true)
  })

  it('does not refresh history for ordinary worktree or index events when HEAD is stable', () => {
    expect(shouldRefreshHistoryDomain('worktree', 'a', 'a')).toBe(false)
    expect(shouldRefreshHistoryDomain('index', 'a', 'a')).toBe(false)
    expect(shouldRefreshHistoryDomain('config', 'a', 'a')).toBe(false)
  })

  it('refreshes history for any event kind when workspace status observes a HEAD change', () => {
    expect(shouldRefreshHistoryDomain('worktree', 'a', 'b')).toBe(true)
    expect(shouldRefreshHistoryDomain('index', 'a', 'b')).toBe(true)
    expect(shouldRefreshHistoryDomain('config', null, 'b')).toBe(true)
  })
})
