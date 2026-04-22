import { ref } from 'vue'
import { useGitCommands } from '@/composables/useGitCommands'

import type { RemoteInfo } from '@/types/git'

// 本 composable 只需要 ContextMenu 的 items 子集；内联类型避免跨 .vue
// 文件的 named type 导入在 vue-tsc 下不稳定。
type MenuItem = { label: string; action: string }

// 多处（sidebar / 其他面板）共用的"选 remote"交互：单 remote 直接返回、
// 多 remote 弹 ContextMenu 让用户点。AppToolbar 已有自己的 pickRemote，
// 保留不动；本 composable 只服务于新增的调用点。
//
// 用法：
//   const { pickRemote } = usePickRemote()
//   const remote = await pickRemote(repoId) // 可选 anchorRect 做定位
// App.vue 顶层挂一个 ContextMenu 绑定下面这些导出的 state。
const menuVisible = ref(false)
const menuX = ref(0)
const menuY = ref(0)
const menuItems = ref<MenuItem[]>([])
let resolver: ((remote: string | null) => void) | null = null

function closeMenuAndResolve(remote: string | null) {
  menuVisible.value = false
  const fn = resolver
  resolver = null
  fn?.(remote)
}

export function usePickRemote() {
  const git = useGitCommands()

  async function pickRemote(
    repoId: string,
    anchorRect?: DOMRect,
  ): Promise<string | null> {
    let remotes: RemoteInfo[]
    try {
      remotes = await git.listRemotes(repoId)
    } catch {
      return null
    }
    if (remotes.length === 0) return null
    if (remotes.length === 1) return remotes[0].name

    // 多 remote：弹菜单
    return new Promise<string | null>((resolve) => {
      const items = remotes.map((r) => ({ label: r.name, action: r.name }))
      items.unshift({ label: 'Fetch All', action: '--all' })
      menuItems.value = items
      if (anchorRect) {
        menuX.value = anchorRect.left
        menuY.value = anchorRect.bottom + 4
      } else {
        // 没有 anchor：屏幕中央兜底
        menuX.value = Math.round(window.innerWidth / 2 - 90)
        menuY.value = Math.round(window.innerHeight / 2 - 60)
      }
      resolver = resolve
      menuVisible.value = true
    })
  }

  function onMenuSelect(action: string) {
    closeMenuAndResolve(action)
  }

  function onMenuClose() {
    closeMenuAndResolve(null)
  }

  return {
    // state（供 App.vue 顶层 ContextMenu 绑定）
    menuVisible,
    menuX,
    menuY,
    menuItems,
    // actions
    pickRemote,
    onMenuSelect,
    onMenuClose,
  }
}
