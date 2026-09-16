import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GitCommandError } from '@/lib/gitCommandError'
import {
  createStatusChangeRefreshQueue,
  isTransientStatusError,
  shouldRefreshHistoryDomain,
  type AutomaticRefreshOutcome,
} from './statusChangeRefresh'

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

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}

describe('automatic refresh queue', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function setup() {
    const refresh = vi.fn<Parameters<typeof createStatusChangeRefreshQueue>[0]>()
      .mockResolvedValue('complete')
    const onError = vi.fn()
    const queue = createStatusChangeRefreshQueue(refresh, onError)
    queue.setRepository('a')
    return { refresh, queue, onError }
  }

  it('serializes refreshes and preserves every pending domain in one follow-up', async () => {
    const { refresh, queue } = setup()
    const first = deferred<AutomaticRefreshOutcome>()
    refresh.mockReturnValueOnce(first.promise)
    queue.request('a', 'worktree')
    queue.request('a', 'refs')
    queue.request('a', 'config')
    queue.request('a', 'worktree')
    queue.request('a', 'worktree')
    expect(refresh).toHaveBeenCalledTimes(1)

    first.resolve('complete')
    await vi.advanceTimersByTimeAsync(0)
    expect(refresh).toHaveBeenCalledTimes(2)
    expect(refresh.mock.calls[1][1]).toEqual(new Set(['refs', 'config', 'worktree']))
    await vi.advanceTimersByTimeAsync(10_000)
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('retries once after a delay and does not poll a persistently failing repository', async () => {
    const { refresh, queue } = setup()
    refresh.mockResolvedValue('retry')
    queue.request('a', 'refs')
    await vi.advanceTimersByTimeAsync(499)
    expect(refresh).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(refresh).toHaveBeenCalledTimes(2)
    expect(refresh.mock.calls[1][1]).toEqual(new Set(['refs']))
    await vi.advanceTimersByTimeAsync(10_000)
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('merges a new event into the waiting retry without dropping reference changes', async () => {
    const { refresh, queue } = setup()
    refresh.mockResolvedValueOnce('retry')
    queue.request('a', 'refs')
    await vi.advanceTimersByTimeAsync(0)
    queue.request('a', 'config')
    await vi.advanceTimersByTimeAsync(1000)
    expect(refresh).toHaveBeenCalledTimes(2)
    expect(refresh.mock.calls[1][1]).toEqual(new Set(['refs', 'config']))
  })

  it('invalidates old work even when switching away and back to the same repository', async () => {
    const { refresh, queue } = setup()
    const first = deferred<AutomaticRefreshOutcome>()
    refresh.mockReturnValueOnce(first.promise)
    queue.request('a', 'refs')
    const isOldCurrent = refresh.mock.calls[0][2]
    queue.request('a', 'config')
    queue.setRepository('b')
    queue.request('a', 'other_git')
    queue.request('b', 'config')
    queue.setRepository('a')
    queue.request('a', 'index')
    expect(isOldCurrent()).toBe(false)
    first.resolve('retry')
    await vi.advanceTimersByTimeAsync(1000)
    expect(refresh).toHaveBeenCalledTimes(2)
    expect(refresh.mock.calls[1][0]).toBe('a')
    expect(refresh.mock.calls[1][1]).toEqual(new Set(['index']))
  })

  it('cancels delayed retries on repository switches and disposal', async () => {
    const { refresh, queue } = setup()
    refresh.mockResolvedValue('retry')
    queue.request('a', 'refs')
    await vi.advanceTimersByTimeAsync(0)
    queue.setRepository('b')
    await vi.advanceTimersByTimeAsync(1000)
    expect(refresh).toHaveBeenCalledTimes(1)
    queue.request('b', 'refs')
    await vi.advanceTimersByTimeAsync(0)
    queue.dispose()
    queue.request('b', 'refs')
    queue.focus()
    await vi.advanceTimersByTimeAsync(1000)
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('rate limits focus recovery and cancels trailing focus work on blur', async () => {
    const { refresh, queue } = setup()
    queue.focus()
    await vi.advanceTimersByTimeAsync(0)
    queue.focus()
    queue.focus()
    await vi.advanceTimersByTimeAsync(999)
    expect(refresh).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(refresh).toHaveBeenCalledTimes(2)
    expect(refresh.mock.calls[1][1]).toEqual(new Set(['other_git']))
    queue.focus()
    queue.cancelFocus()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('does not let an unexpected failure strand later events', async () => {
    const { refresh, queue, onError } = setup()
    const error = new Error('unexpected')
    refresh.mockRejectedValueOnce(error)
    queue.request('a', 'refs')
    queue.request('a', 'config')
    await vi.advanceTimersByTimeAsync(0)
    expect(onError).toHaveBeenCalledWith(error)
    expect(refresh).toHaveBeenCalledTimes(2)
  })
})

describe('isTransientStatusError', () => {
  it('uses the original IPC error even when the user-facing message is translated', () => {
    expect(isTransientStatusError(new GitCommandError('读取失败', {
      kind: 'Git', message: 'the index is locked',
    }))).toBe(true)
    expect(isTransientStatusError({ kind: 'Io', message: 'Resource temporarily unavailable' })).toBe(true)
    expect(isTransientStatusError(new Error("failed to create '.git/index.lock': File exists"))).toBe(true)
  })

  it('does not retry permanent errors or classify arbitrary lock-named paths as transient', () => {
    expect(isTransientStatusError({ kind: 'RepoNotFound', message: 'index.lock' })).toBe(false)
    expect(isTransientStatusError(new Error('Permission denied: .git/index.lock'))).toBe(false)
    expect(isTransientStatusError(new Error('repository not found'))).toBe(false)
    expect(isTransientStatusError(new Error('corrupt index'))).toBe(false)
    expect(isTransientStatusError(null)).toBe(false)
  })
})
