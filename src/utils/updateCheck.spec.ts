import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  LAST_UPDATE_CHECK_EVENT,
  LAST_UPDATE_CHECK_KEY,
  findStartupUpdate,
  isNetworkUpdateCheckError,
  readLastUpdateCheckTime,
  recordLastUpdateCheckTime,
  updateCheckErrorMessage,
} from './updateCheck'

describe('updateCheck', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('reads and writes the last successful check time', () => {
    const listener = vi.fn()
    window.addEventListener(LAST_UPDATE_CHECK_EVENT, listener)

    const value = recordLastUpdateCheckTime(1_762_000_000)

    expect(value).toBe(1_762_000_000)
    expect(readLastUpdateCheckTime()).toBe(1_762_000_000)
    expect(localStorage.getItem(LAST_UPDATE_CHECK_KEY)).toBe('1762000000')
    expect(listener).toHaveBeenCalledTimes(1)

    window.removeEventListener(LAST_UPDATE_CHECK_EVENT, listener)
  })

  it('returns null when the saved check time is missing or invalid', () => {
    expect(readLastUpdateCheckTime()).toBeNull()

    localStorage.setItem(LAST_UPDATE_CHECK_KEY, 'not-a-number')
    expect(readLastUpdateCheckTime()).toBeNull()

    localStorage.setItem(LAST_UPDATE_CHECK_KEY, '-1')
    expect(readLastUpdateCheckTime()).toBeNull()
  })

  it('recognizes common network failures', () => {
    expect(isNetworkUpdateCheckError(new Error('Network request failed'))).toBe(true)
    expect(isNetworkUpdateCheckError('operation timed out')).toBe(true)
    expect(isNetworkUpdateCheckError('could not resolve host')).toBe(true)
    expect(isNetworkUpdateCheckError({ message: 'failed to fetch latest.json' })).toBe(true)
  })

  it('does not classify non-network updater failures as network errors', () => {
    expect(isNetworkUpdateCheckError(new Error('invalid update signature'))).toBe(false)
    expect(isNetworkUpdateCheckError('manifest version is not valid')).toBe(false)
  })

  it('extracts the message from structured Tauri command errors', () => {
    expect(updateCheckErrorMessage({
      kind: 'OperationFailed',
      message: 'failed to request the development update manifest',
    })).toBe('failed to request the development update manifest')
  })

  it('prefers a development update and skips the release check', async () => {
    const checkDevelopment = vi.fn().mockResolvedValue({ version: '1.1.0-dev.12' })
    const checkRelease = vi.fn().mockResolvedValue({ version: '1.0.1' })

    await expect(findStartupUpdate({
      development: checkDevelopment,
      release: checkRelease,
    })).resolves.toEqual({
      channel: 'development',
      update: { version: '1.1.0-dev.12' },
    })
    expect(checkRelease).not.toHaveBeenCalled()
  })

  it('falls back to the release channel when development has no update', async () => {
    const checkDevelopment = vi.fn().mockResolvedValue(null)
    const checkRelease = vi.fn().mockResolvedValue({ version: '1.0.1' })

    await expect(findStartupUpdate({
      development: checkDevelopment,
      release: checkRelease,
    })).resolves.toEqual({
      channel: 'release',
      update: { version: '1.0.1' },
    })
    expect(checkDevelopment).toHaveBeenCalledOnce()
    expect(checkRelease).toHaveBeenCalledOnce()
  })

  it('reports a development error and continues with the release check', async () => {
    const failure = new Error('development endpoint unavailable')
    const onError = vi.fn()
    const checkRelease = vi.fn().mockResolvedValue({ version: '1.0.1' })

    await expect(findStartupUpdate({
      development: vi.fn().mockRejectedValue(failure),
      release: checkRelease,
      onError,
    })).resolves.toEqual({
      channel: 'release',
      update: { version: '1.0.1' },
    })
    expect(onError).toHaveBeenCalledWith('development', failure)
    expect(checkRelease).toHaveBeenCalledOnce()
  })

  it('does not run checks for disabled channels', async () => {
    await expect(findStartupUpdate({
      development: null,
      release: null,
    })).resolves.toBeNull()
  })
})
