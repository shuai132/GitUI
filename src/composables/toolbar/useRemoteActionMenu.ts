import { computed, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRepoStore } from '@/stores/repos'
import { useGitCommands } from '@/composables/useGitCommands'
import type { RemoteInfo } from '@/types/git'
import type { ContextMenuItem } from '@/components/common/ContextMenu.vue'

export type PullMode = 'ff' | 'ff_only' | 'rebase'
export type PushMode = 'normal' | 'force_with_lease' | 'force'

export function useRemoteActionMenu() {
  const repoStore = useRepoStore()
  const git = useGitCommands()
  const { t } = useI18n()

  const remoteMenu = reactive({
    visible: false,
    x: 0,
    y: 0,
    items: [] as ContextMenuItem[],
    resolve: null as ((remote: string | null) => void) | null,
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
  ])

  const pushModeMenuItems = computed<ContextMenuItem[]>(() => [
    { label: t('toolbar.pushMode.forceWithLease'), action: 'force_with_lease' },
    { label: t('toolbar.pushMode.force'), action: 'force' },
  ])

  async function pickRemote(anchorRect?: DOMRect, showFetchAll = false): Promise<string | null> {
    const id = repoStore.activeRepoId
    if (!id) return null
    let remotes: RemoteInfo[]
    try {
      remotes = await git.listRemotes(id)
    } catch {
      return null
    }
    if (remotes.length === 0) return null
    if (remotes.length === 1) return remotes[0].name

    return new Promise<string | null>((resolve) => {
      const items = remotes.map((r) => ({ label: r.name, action: r.name }))
      if (showFetchAll) {
        items.unshift({ label: 'Fetch All', action: '--all' })
      }
      remoteMenu.items = items
      if (anchorRect) {
        remoteMenu.x = anchorRect.left
        remoteMenu.y = anchorRect.bottom + 4
      } else {
        remoteMenu.x = 80
        remoteMenu.y = 80
      }
      remoteMenu.resolve = resolve
      remoteMenu.visible = true
    })
  }

  function onRemoteMenuSelect(action: string) {
    remoteMenu.visible = false
    const fn = remoteMenu.resolve
    remoteMenu.resolve = null
    fn?.(action)
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
