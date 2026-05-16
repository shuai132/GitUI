export const LAST_UPDATE_CHECK_KEY = 'gitui.last_update_check'
export const LAST_UPDATE_CHECK_EVENT = 'gitui:last-update-check-changed'

const NETWORK_ERROR_PATTERNS = [
  'network',
  'timeout',
  'timed out',
  'offline',
  'dns',
  'connection',
  'failed to fetch',
  'could not resolve',
  'host not found',
  'temporary failure',
]

export function readLastUpdateCheckTime(): number | null {
  try {
    const raw = localStorage.getItem(LAST_UPDATE_CHECK_KEY)
    if (!raw) return null
    const value = Number(raw)
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : null
  } catch {
    return null
  }
}

export function recordLastUpdateCheckTime(nowSeconds = Math.floor(Date.now() / 1000)): number {
  const value = Math.floor(nowSeconds)
  try {
    localStorage.setItem(LAST_UPDATE_CHECK_KEY, String(value))
  } catch {
    // Ignore quota / privacy-mode failures; callers can still use the returned value.
  }
  notifyLastUpdateCheckChanged()
  return value
}

export function isNetworkUpdateCheckError(err: unknown): boolean {
  const message = errorMessage(err).toLowerCase()
  return NETWORK_ERROR_PATTERNS.some((pattern) => message.includes(pattern))
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}

function notifyLastUpdateCheckChanged() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(LAST_UPDATE_CHECK_EVENT))
}
