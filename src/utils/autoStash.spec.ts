import { describe, expect, it, vi } from 'vitest'
import { runWithAutoStash } from './autoStash'

describe('runWithAutoStash', () => {
  it('does not start the operation when creating the stash fails', async () => {
    const operation = vi.fn(async () => {})

    await expect(runWithAutoStash({
      stash: async () => { throw new Error('stash failed') },
      operation,
      getRepoState: async () => ({ kind: 'clean' }),
      restore: async () => {},
    })).rejects.toThrow('stash failed')

    expect(operation).not.toHaveBeenCalled()
  })

  it('keeps both the operation failure and an unknown repository state', async () => {
    const operationError = new Error('operation failed')
    const stateError = new Error('state failed')
    const restore = vi.fn(async () => {})

    const result = await runWithAutoStash({
      stash: async () => 'stash-oid',
      operation: async () => { throw operationError },
      getRepoState: async () => { throw stateError },
      restore,
    })

    expect(result).toEqual({
      operationSucceeded: false,
      operationError,
      restore: { kind: 'deferred', repoState: 'unknown', cause: stateError },
    })
    expect(restore).not.toHaveBeenCalled()
  })
})
