import { computed, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRepoStore } from '@/stores/repos'
import { useUiStore } from '@/stores/ui'
import { useGitCommands } from '@/composables/useGitCommands'
import { useGlobalToast } from '@/composables/useGlobalToast'
import type { RemoteInfo } from '@/types/git'
import type { ContextMenuItem } from '@/components/common/ContextMenu.vue'

export type PullMode = 'ff' | 'ff_only' | 'rebase'
export type PushMode = 'normal' | 'force_with_lease' | 'force'

interface PickRemoteOptions {
  forceMenu?: boolean
  resolveSelection?: boolean
}

export function useRemoteActionMenu() {
  const repoStore = useRepoStore()
  const uiStore = useUiStore()
  const git = useGitCommands()
  const { t } = useI18n()
  const { showToast } = useGlobalToast()

  const remoteMenu = reactive({
    visible: false,
    x: 0,
    y: 0,
    items: [] as ContextMenuItem[],
    resolve: null as ((remote: string | null) => void) | null,
    resolveSelection: true,
  })

  const pullModeMenu = reactive({
    visible: false,
    x: 0,
    y: 0,
  })
  const pullChevronRect = ref<DOMRect | null>(null)

  const pushModeMenu = reactive({
    visible: false,
    x: 0,
    y: 0,
  })
  const pushChevronRect = ref<DOMRect | null>(null)

  const pullModeMenuItems = computed<ContextMenuItem[]>(() => [
    { label: t('toolbar.pullMode.ff'), action: 'ff' },
    { label: t('toolbar.pullMode.ffOnly'), action: 'ff_only' },
    { label: t('toolbar.pullMode.rebase'), action: 'rebase' },
    { separator: true },
    { label: t('toolbar.remoteMenu.manageDefault'), action: 'manage_default_remote' },
  ])

  const pushModeMenuItems = computed<ContextMenuItem[]>(() => [
    { label: t('toolbar.pushMode.forceWithLease'), action: 'force_with_lease' },
    { label: t('toolbar.pushMode.force'), action: 'force' },
    { separator: true },
    { label: t('toolbar.remoteMenu.manageDefault'), action: 'manage_default_remote' },
  ])

  function activeRepoPath(): string | null {
    return repoStore.activeRepo()?.path ?? null
  }

  function remoteAction(remoteName: string): string {
    return `remote:${encodeURIComponent(remoteName)}`
  }

  function defaultAction(kind: 'set' | 'clear', remoteName: string): string {
    return `default:${kind}:${encodeURIComponent(remoteName)}`
  }

  function remoteFromAction(action: string, prefix: string): string | null {
    if (!action.startsWith(prefix)) return null
    try {
      return decodeURIComponent(action.slice(prefix.length))
    } catch {
      return null
    }
  }

  function defaultFromAction(action: string): { kind: 'set' | 'clear'; remote: string } | null {
    const setPrefix = 'default:set:'
    const clearPrefix = 'default:clear:'
    const setRemote = remoteFromAction(action, setPrefix)
    if (setRemote) return { kind: 'set', remote: setRemote }
    const clearRemote = remoteFromAction(action, clearPrefix)
    if (clearRemote) return { kind: 'clear', remote: clearRemote }
    return null
  }

  function buildRemoteMenuItems(remotes: RemoteInfo[], showFetchAll: boolean): ContextMenuItem[] {
    const repoPath = activeRepoPath()
    const defaultRemote = uiStore.getDefaultRemote(repoPath)
    const items = remotes.map((r): ContextMenuItem => {
      const isDefault = r.name === defaultRemote
      if (showFetchAll) {
        return {
          label: r.name,
          action: remoteAction(r.name),
        }
      }
      return {
        label: r.name,
        action: remoteAction(r.name),
        trailingLabel: isDefault
          ? t('toolbar.remoteMenu.clearDefault')
          : t('toolbar.remoteMenu.setDefault'),
        trailingAction: defaultAction(isDefault ? 'clear' : 'set', r.name),
      }
    })
    if (showFetchAll) {
      items.unshift({ label: 'Fetch All', action: '--all' })
    }
    return items
  }

  async function pickRemote(
    anchorRect?: DOMRect,
    showFetchAll = false,
    options: PickRemoteOptions = {},
  ): Promise<string | null> {
    const id = repoStore.activeRepoId
    if (!id) return null
    let remotes: RemoteInfo[]
    try {
      remotes = await git.listRemotes(id)
    } catch {
      return null
    }
    if (remotes.length === 0) return null
    const repoPath = activeRepoPath()
    const defaultRemote = uiStore.getDefaultRemote(repoPath)

    if (!showFetchAll && !options.forceMenu && defaultRemote) {
      if (remotes.some((r) => r.name === defaultRemote)) {
        return defaultRemote
      }
      uiStore.clearDefaultRemoteForRepo(repoPath)
    }

    if (!options.forceMenu && remotes.length === 1) return remotes[0].name

    return new Promise<string | null>((resolve) => {
      remoteMenu.items = buildRemoteMenuItems(remotes, showFetchAll)
      if (anchorRect) {
        remoteMenu.x = anchorRect.left
        remoteMenu.y = anchorRect.bottom + 4
      } else {
        remoteMenu.x = 80
        remoteMenu.y = 80
      }
      remoteMenu.resolve = resolve
      remoteMenu.resolveSelection = options.resolveSelection ?? true
      remoteMenu.visible = true
    })
  }

  function onRemoteMenuSelect(action: string) {
    const defaultChange = defaultFromAction(action)
    if (defaultChange) {
      const repoPath = activeRepoPath()
      if (defaultChange.kind === 'set') {
        uiStore.setDefaultRemoteForRepo(repoPath, defaultChange.remote)
        showToast('success', t('toolbar.remoteMenu.defaultUpdated', { remote: defaultChange.remote }))
      } else {
        uiStore.clearDefaultRemoteForRepo(repoPath)
        showToast('success', t('toolbar.remoteMenu.defaultCleared'))
      }
      remoteMenu.visible = false
      const fn = remoteMenu.resolve
      remoteMenu.resolve = null
      fn?.(null)
      return
    }

    remoteMenu.visible = false
    const fn = remoteMenu.resolve
    remoteMenu.resolve = null
    const selectedRemote = remoteFromAction(action, 'remote:')
    if (selectedRemote) {
      fn?.(remoteMenu.resolveSelection ? selectedRemote : null)
      return
    }
    fn?.(remoteMenu.resolveSelection ? action : null)
  }

  function onRemoteMenuClose() {
    remoteMenu.visible = false
    const fn = remoteMenu.resolve
    remoteMenu.resolve = null
    fn?.(null)
  }

  function onPullChevronClick(e: MouseEvent) {
    e.stopPropagation()
    if (pullModeMenu.visible) {
      pullModeMenu.visible = false
      return
    }
    const el = e.currentTarget as HTMLElement
    const rect = el.getBoundingClientRect()
    pullChevronRect.value = rect
    pullModeMenu.x = rect.left
    pullModeMenu.y = rect.bottom + 4
    pullModeMenu.visible = true
  }

  function closePullModeMenu() {
    pullModeMenu.visible = false
  }

  function onPushChevronClick(e: MouseEvent) {
    e.stopPropagation()
    if (pushModeMenu.visible) {
      pushModeMenu.visible = false
      return
    }
    const el = e.currentTarget as HTMLElement
    const rect = el.getBoundingClientRect()
    pushChevronRect.value = rect
    pushModeMenu.x = rect.left
    pushModeMenu.y = rect.bottom + 4
    pushModeMenu.visible = true
  }

  function closePushModeMenu() {
    pushModeMenu.visible = false
  }

  return {
    remoteMenu,
    pickRemote,
    onRemoteMenuSelect,
    onRemoteMenuClose,
    pullModeMenu,
    pullModeMenuItems,
    pullChevronRect,
    onPullChevronClick,
    closePullModeMenu,
    pushModeMenu,
    pushModeMenuItems,
    pushChevronRect,
    onPushChevronClick,
    closePushModeMenu,
  }
}
