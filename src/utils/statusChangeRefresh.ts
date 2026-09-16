import type { StatusChangeKind } from '@/composables/useGitEvents'
import { GitCommandError } from '@/lib/gitCommandError'

export function shouldRefreshHistoryDomain(
  kind: StatusChangeKind,
  previousHead: string | null | undefined,
  nextHead: string | null | undefined,
): boolean {
  if (kind === 'refs' || kind === 'other_git') return true

  return (previousHead ?? null) !== (nextHead ?? null)
}

export function isTransientStatusError(error: unknown): boolean {
  const raw = error instanceof GitCommandError ? error.cause : error
  let message: string
  if (raw instanceof Error) {
    message = raw.message
  } else if (typeof raw === 'string') {
    message = raw
  } else if (raw && typeof raw === 'object' && 'message' in raw && typeof raw.message === 'string') {
    if ('kind' in raw && raw.kind !== 'Git' && raw.kind !== 'Io') return false
    message = raw.message
  } else {
    return false
  }
  if (/permission denied|access (?:is )?denied|read-only|no such file|not found/i.test(message)) return false
  return /\b(index is locked|index\.lock|could not lock|failed to lock|unable to create .*\.lock|resource (?:temporarily unavailable|busy)|sharing violation|used by another process)\b/i.test(message)
}

export type AutomaticRefreshOutcome = 'complete' | 'retry'

interface RefreshRequest {
  kinds: Set<StatusChangeKind>
  retries: number
}

const RETRY_DELAY_MS = 500
const FOCUS_INTERVAL_MS = 1000

/** 只调度自动刷新；手动刷新及 Git 操作自己的刷新仍由原调用方管理。 */
export function createStatusChangeRefreshQueue(
  refresh: (
    repoId: string,
    kinds: ReadonlySet<StatusChangeKind>,
    isCurrent: () => boolean,
  ) => Promise<AutomaticRefreshOutcome>,
  onError: (error: unknown) => void,
) {
  let activeRepoId: string | null = null
  let generation = 0
  let disposed = false
  let running = false
  let pending: RefreshRequest | null = null
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let focusTimer: ReturnType<typeof setTimeout> | undefined
  let lastFocusAt = -Infinity

  function waitingRequest() {
    return pending
  }

  async function drain() {
    if (disposed || running || retryTimer !== undefined || !pending || !activeRepoId) return
    const repoId = activeRepoId
    const session = generation
    const request = pending
    pending = null
    running = true
    const isCurrent = () => !disposed && session === generation && repoId === activeRepoId
    let outcome: AutomaticRefreshOutcome = 'complete'
    try {
      outcome = await refresh(repoId, request.kinds, isCurrent)
    } catch (error: unknown) {
      onError(error)
    } finally {
      running = false
    }

    if (isCurrent() && outcome === 'retry') {
      const waiting = waitingRequest()
      if (waiting) {
        // 新事件已在等待：保留失败批次所有数据域，直接随下一轮读取。
        for (const kind of request.kinds) waiting.kinds.add(kind)
      } else if (request.retries < 1) {
        pending = { kinds: request.kinds, retries: request.retries + 1 }
        retryTimer = setTimeout(() => {
          retryTimer = undefined
          void drain()
        }, RETRY_DELAY_MS)
      }
    }
    void drain()
  }

  function request(repoId: string, kind: StatusChangeKind) {
    if (disposed || repoId !== activeRepoId) return
    if (retryTimer !== undefined) {
      clearTimeout(retryTimer)
      retryTimer = undefined
    }
    if (!pending) pending = { kinds: new Set(), retries: 0 }
    pending.kinds.add(kind)
    pending.retries = 0
    void drain()
  }

  function cancelFocus() {
    if (focusTimer !== undefined) clearTimeout(focusTimer)
    focusTimer = undefined
  }

  function focus() {
    if (disposed || !activeRepoId || focusTimer !== undefined) return
    const repoId = activeRepoId
    const remaining = Math.max(0, FOCUS_INTERVAL_MS - (Date.now() - lastFocusAt))
    const refreshFocused = () => {
      focusTimer = undefined
      lastFocusAt = Date.now()
      request(repoId, 'other_git')
    }
    if (remaining === 0) refreshFocused()
    else focusTimer = setTimeout(refreshFocused, remaining)
  }

  function setRepository(repoId: string | null) {
    generation++
    activeRepoId = repoId
    pending = null
    if (retryTimer !== undefined) clearTimeout(retryTimer)
    retryTimer = undefined
    cancelFocus()
    lastFocusAt = -Infinity
  }

  function dispose() {
    disposed = true
    setRepository(null)
  }

  return { request, focus, cancelFocus, setRepository, dispose }
}
