import { onUnmounted } from 'vue'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

export type StatusChangeKind = 'worktree' | 'index' | 'refs' | 'config' | 'other_git'

export interface StatusChangedPayload {
  repo_id: string
  kind: StatusChangeKind
}

export function useGitEvents() {
  const unlisteners: UnlistenFn[] = []
  let disposed = false

  function keepListener(unlisten: UnlistenFn) {
    if (disposed) unlisten()
    else unlisteners.push(unlisten)
  }

  const onStatusChanged = (handler: (payload: StatusChangedPayload) => void) => {
    listen<StatusChangedPayload>('repo://status-changed', (event) => {
      handler(event.payload)
    }).then(keepListener)
  }

  const onOperationProgress = (
    handler: (payload: {
      op: string
      stage: string
      progress: number
      message?: string
    }) => void
  ) => {
    listen<{ op: string; stage: string; progress: number; message?: string }>(
      'repo://operation-progress',
      (event) => {
        handler(event.payload)
      }
    ).then(keepListener)
  }

  const onError = (handler: (payload: { repoId: string; msg: string }) => void) => {
    listen<{ repoId: string; msg: string }>('repo://error', (event) => {
      handler(event.payload)
    }).then(keepListener)
  }

  const onRemoteUpdated = (handler: (repoId: string) => void) => {
    listen<string>('repo://remote-updated', (event) => {
      handler(event.payload)
    }).then(keepListener)
  }

  // macOS `open -a GitUI <path>` 热启动：app 已在运行时打开新路径
  const onOpenPath = (handler: (path: string) => void) => {
    listen<string>('repo://open-path', (event) => {
      handler(event.payload)
    }).then(keepListener)
  }

  onUnmounted(() => {
    disposed = true
    unlisteners.forEach((fn) => fn())
  })

  return {
    onStatusChanged,
    onOperationProgress,
    onError,
    onRemoteUpdated,
    onOpenPath,
  }
}
