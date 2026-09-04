import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  LAST_UPDATE_CHECK_EVENT,
  LAST_UPDATE_CHECK_KEY,
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
})
