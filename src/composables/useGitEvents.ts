import { onUnmounted } from 'vue'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

export function useGitEvents() {
  const unlisteners: UnlistenFn[] = []

  const onStatusChanged = (handler: (repoId: string) => void) => {
    listen<string>('repo://status-changed', (event) => {
      handler(event.payload)
    }).then((unlisten) => {
      unlisteners.push(unlisten)
    })
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
    ).then((unlisten) => {
      unlisteners.push(unlisten)
    })
  }

  const onError = (handler: (payload: { repoId: string; msg: string }) => void) => {
    listen<{ repoId: string; msg: string }>('repo://error', (event) => {
      handler(event.payload)
    }).then((unlisten) => {
      unlisteners.push(unlisten)
    })
  }

  const onRemoteUpdated = (handler: (repoId: string) => void) => {
    listen<string>('repo://remote-updated', (event) => {
      handler(event.payload)
    }).then((unlisten) => {
      unlisteners.push(unlisten)
    })
  }

  // macOS `open -a GitUI <path>` 热启动：app 已在运行时打开新路径
  const onOpenPath = (handler: (path: string) => void) => {
    listen<string>('repo://open-path', (event) => {
      handler(event.payload)
    }).then((unlisten) => {
      unlisteners.push(unlisten)
    })
  }

  onUnmounted(() => {
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
