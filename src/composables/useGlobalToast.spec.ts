import { afterEach, describe, expect, it, vi } from 'vitest'
import { GitCommandError } from '@/lib/gitCommandError'
import { useGlobalToast } from './useGlobalToast'

describe('useGlobalToast action error routing', () => {
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    useGlobalToast().toast.value = null
  })

  it('does not duplicate an IPC error already routed through errorsStore', () => {
    vi.useFakeTimers()
    const { toast, showActionError } = useGlobalToast()

    expect(showActionError(new GitCommandError('mapped failure'))).toBe(false)
    expect(toast.value).toBeNull()
  })

  it('shows a contextual fallback for a non-IPC action error', () => {
    vi.useFakeTimers()
    const { toast, showActionError } = useGlobalToast()

    expect(showActionError(new Error('clipboard denied'), 'Copy failed')).toBe(true)
    expect(toast.value).toEqual({ type: 'error', message: 'Copy failed' })
  })
})
