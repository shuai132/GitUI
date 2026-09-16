import { onMounted, onUnmounted, watch } from 'vue'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { UnlistenFn } from '@tauri-apps/api/event'
import { useGitEvents } from '@/composables/useGitEvents'
import { useRepoStore } from '@/stores/repos'
import { useWorkspaceStore } from '@/stores/workspace'
import { useHistoryStore } from '@/stores/history'
import { useSubmodulesStore } from '@/stores/submodules'
import { useStashStore } from '@/stores/stash'
import { useDiffStore } from '@/stores/diff'
import { useDebugStore } from '@/stores/debug'
import { findWipFileBySelection } from '@/utils/wipSelection'
import {
  createStatusChangeRefreshQueue,
  isTransientStatusError,
  shouldRefreshHistoryDomain,
} from '@/utils/statusChangeRefresh'

export function useAutomaticRepositoryRefresh() {
  const repoStore = useRepoStore()
  const workspaceStore = useWorkspaceStore()
  const historyStore = useHistoryStore()
  const submodulesStore = useSubmodulesStore()
  const stashStore = useStashStore()
  const diffStore = useDiffStore()
  const debugStore = useDebugStore()

  function log(level: string, message: string) {
    debugStore.pushLog(level, 'auto-refresh', message, Date.now())
  }

  const queue = createStatusChangeRefreshQueue(async (repoId, kinds, isCurrent) => {
    const started = performance.now()
    const previousHead = workspaceStore.status?.head_commit ?? null
    const result = await workspaceStore.refresh(repoId)
    if (!isCurrent()) return 'complete'
    if (result.outcome === 'failed') {
      const retry = isTransientStatusError(result.error)
      log('warn', `repo=${repoId} status failed; retryable=${retry}`)
      return retry ? 'retry' : 'complete'
    }
    if (result.outcome === 'superseded') {
      // 手动刷新或 Git 操作的请求可能覆盖本轮；不能把尚未读到的状态当作成功。
      return 'retry'
    }

    const nextHead = workspaceStore.status?.head_commit ?? null
    const tasks: Promise<unknown>[] = []
    if (kinds.has('config') || kinds.has('other_git')) {
      tasks.push(submodulesStore.loadSubmodules())
    }
    if ([...kinds].some((kind) => shouldRefreshHistoryDomain(kind, previousHead, nextHead))) {
      tasks.push(
        historyStore.loadLog(),
        historyStore.loadBranches(),
        historyStore.loadTags(),
        stashStore.refresh(),
      )
    } else if (kinds.has('config')) {
      tasks.push(historyStore.loadBranches())
    }

    // 只有成功取得的新 status 才能决定 WIP 选择是否消失或跨暂存区移动。
    if (diffStore.currentPath) {
      const status = workspaceStore.status
      const files = [
        ...(status?.staged ?? []),
        ...(status?.unstaged ?? []),
        ...(status?.untracked ?? []),
      ]
      const file = findWipFileBySelection(files, diffStore.currentPath, diffStore.currentStaged)
      if (file) {
        diffStore.currentStaged = file.staged
        tasks.push(diffStore.refresh())
      } else {
        diffStore.clear()
      }
    }

    const results = await Promise.allSettled(tasks)
    for (const settled of results) {
      if (settled.status === 'rejected') log('warn', String(settled.reason))
    }
    log('debug', `repo=${repoId} kinds=${[...kinds].join(',')} completed in ${Math.round(performance.now() - started)}ms`)
    return 'complete'
  }, (error) => log('warn', `refresh failed: ${String(error)}`))

  watch(() => repoStore.activeRepoId, (id) => queue.setRepository(id), {
    immediate: true,
    flush: 'sync',
  })
  useGitEvents().onStatusChanged(({ repo_id, kind }) => queue.request(repo_id, kind))

  let disposed = false
  let unlistenFocus: UnlistenFn | undefined
  onMounted(() => {
    getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (focused) queue.focus()
      else queue.cancelFocus()
    }).then((unlisten) => {
      if (disposed) unlisten()
      else unlistenFocus = unlisten
    }).catch((error: unknown) => log('warn', `focus listener failed: ${String(error)}`))
  })
  onUnmounted(() => {
    disposed = true
    queue.dispose()
    unlistenFocus?.()
  })
}
