import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useClipboardFeedback } from './useClipboardFeedback'

const mocks = vi.hoisted(() => ({
  writeText: vi.fn(),
  showToast: vi.fn(),
  showActionError: vi.fn(),
}))

vi.mock('@/composables/useGlobalToast', () => ({
  useGlobalToast: () => ({
    showToast: mocks.showToast,
    showActionError: mocks.showActionError,
  }),
}))

describe('useClipboardFeedback', () => {
  const t = (key: string) => key
  beforeEach(() => {
    mocks.writeText.mockReset().mockResolvedValue(undefined)
    mocks.showToast.mockReset()
    mocks.showActionError.mockReset()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: mocks.writeText },
    })
  })

  it('copies text and reports success', async () => {
    const { copyText } = useClipboardFeedback(t)

    await expect(copyText('full text')).resolves.toBe(true)

    expect(mocks.writeText).toHaveBeenCalledWith('full text')
    expect(mocks.showToast).toHaveBeenCalledWith('success', 'clipboard.copySuccess')
  })

  it('reports clipboard rejection without throwing it to the caller', async () => {
    const error = new Error('permission denied')
    mocks.writeText.mockRejectedValue(error)
    const { copyText } = useClipboardFeedback(t)

    await expect(copyText('full text')).resolves.toBe(false)

    expect(mocks.showActionError).toHaveBeenCalledWith(error, 'clipboard.copyFailed')
    expect(mocks.showToast).not.toHaveBeenCalled()
  })

  it('uses caller-provided feedback messages', async () => {
    const { copyText } = useClipboardFeedback(t)

    await copyText('hash', { successMessage: 'Hash copied', failureMessage: 'Hash failed' })

    expect(mocks.showToast).toHaveBeenCalledWith('success', 'Hash copied')
  })
})
