import { describe, expect, it, vi } from 'vitest'
import { runPullWithAutoStash } from './pullAutoStash'

describe('runPullWithAutoStash', () => {
  it('stashes, pulls, checks the repository, then restores', async () => {
    const order: string[] = []
    const result = await runPullWithAutoStash({
      stash: async () => { order.push('stash'); return 'stash-oid' },
      pull: async () => { order.push('pull') },
      getRepoState: async () => {
        order.push('state')
        return { kind: 'clean' }
      },
      restore: async (stashOid) => { order.push(`restore:${stashOid}`) },
    })

    expect(order).toEqual(['stash', 'pull', 'state', 'restore:stash-oid'])
    expect(result).toEqual({
      pullSucceeded: true,
      pullError: null,
      restore: { kind: 'restored' },
    })
  })

  it('restores original changes after a clean pull failure', async () => {
    const pullError = new Error('network failed')
    const restore = vi.fn(async () => {})
    const result = await runPullWithAutoStash({
      stash: async () => 'stash-oid',
      pull: async () => { throw pullError },
      getRepoState: async () => ({ kind: 'clean' }),
      restore,
    })

    expect(restore).toHaveBeenCalledOnce()
    expect(result.pullSucceeded).toBe(false)
    expect(result.pullError).toBe(pullError)
    expect(result.restore).toEqual({ kind: 'restored' })
  })

  it('keeps the stash when pull leaves a merge in progress', async () => {
    const restore = vi.fn(async () => {})
    const result = await runPullWithAutoStash({
      stash: async () => 'stash-oid',
      pull: async () => { throw new Error('merge conflict') },
      getRepoState: async () => ({ kind: 'merge' }),
      restore,
    })

    expect(restore).not.toHaveBeenCalled()
    expect(result.restore).toEqual({ kind: 'deferred', repoState: 'merge' })
  })

  it('keeps the stash when repository state cannot be confirmed', async () => {
    const stateError = new Error('state unavailable')
    const restore = vi.fn(async () => {})
    const result = await runPullWithAutoStash({
      stash: async () => 'stash-oid',
      pull: async () => {},
      getRepoState: async () => { throw stateError },
      restore,
    })

    expect(restore).not.toHaveBeenCalled()
    expect(result.restore).toEqual({
      kind: 'deferred',
      repoState: 'unknown',
      cause: stateError,
    })
  })

  it('reports a restore failure without hiding the successful pull', async () => {
    const restoreError = new Error('stash conflict')
    const result = await runPullWithAutoStash({
      stash: async () => 'stash-oid',
      pull: async () => {},
      getRepoState: async () => ({ kind: 'clean' }),
      restore: async () => { throw restoreError },
    })

    expect(result).toEqual({
      pullSucceeded: true,
      pullError: null,
      restore: { kind: 'failed', cause: restoreError },
    })
  })
})
