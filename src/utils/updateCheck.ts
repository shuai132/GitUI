export const LAST_UPDATE_CHECK_KEY = 'gitui.last_update_check'
export const LAST_UPDATE_CHECK_EVENT = 'gitui:last-update-check-changed'

export type UpdateChannel = 'release' | 'development'

export interface ChannelUpdate<T> {
  channel: UpdateChannel
  update: T
}

interface StartupUpdateChecks<T> {
  development: (() => Promise<T | null>) | null
  release: (() => Promise<T | null>) | null
  onError?: (channel: UpdateChannel, error: unknown) => void
}

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
  const message = updateCheckErrorMessage(err).toLowerCase()
  return NETWORK_ERROR_PATTERNS.some((pattern) => message.includes(pattern))
}

export function updateCheckErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  if (err && typeof err === 'object' && 'message' in err && typeof err.message === 'string') {
    return err.message
  }
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}

/**
 * 启动检查按开发版优先、正式版兜底的顺序执行，最多返回一个更新。
 * 单个通道失败不会阻止后续通道继续检查。
 */
export async function findStartupUpdate<T>(
  checks: StartupUpdateChecks<T>,
): Promise<ChannelUpdate<T> | null> {
  const channels: Array<[UpdateChannel, (() => Promise<T | null>) | null]> = [
    ['development', checks.development],
    ['release', checks.release],
  ]

  for (const [channel, checkChannel] of channels) {
    if (!checkChannel) continue
    try {
      const update = await checkChannel()
      if (update) return { channel, update }
    } catch (error: unknown) {
      checks.onError?.(channel, error)
    }
  }
  return null
}

function notifyLastUpdateCheckChanged() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(LAST_UPDATE_CHECK_EVENT))
}
