<script setup lang="ts">
import { onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import AppSidebar from '@/components/layout/AppSidebar.vue'
import AppToolbar from '@/components/layout/AppToolbar.vue'
import AppStatusBar from '@/components/layout/AppStatusBar.vue'
import { useRepoStore } from '@/stores/repos'
import { useWorkspaceStore } from '@/stores/workspace'
import { useHistoryStore } from '@/stores/history'
import { useSubmodulesStore } from '@/stores/submodules'
import { useStashStore } from '@/stores/stash'
import { useDiffStore } from '@/stores/diff'
import { useUiStore } from '@/stores/ui'
import { useGitEvents } from '@/composables/useGitEvents'

const router = useRouter()
const repoStore = useRepoStore()
const workspaceStore = useWorkspaceStore()
const historyStore = useHistoryStore()
const submodulesStore = useSubmodulesStore()
const stashStore = useStashStore()
const diffStore = useDiffStore()
const uiStore = useUiStore()
const { onStatusChanged } = useGitEvents()

// 启动时从持久化存储恢复仓库列表
onMounted(() => {
  repoStore.loadPersisted()
})

// ── Sidebar width (可拖动) ───────────────────────────────────────────
// 持久化由 uiStore 托管，这里只负责拖动期间的响应式更新
function startSidebarResize(e: PointerEvent) {
  e.preventDefault()
  const startX = e.clientX
  const startW = uiStore.sidebarWidth
  const onMove = (ev: PointerEvent) => {
    const delta = ev.clientX - startX
    uiStore.sidebarWidth = Math.max(160, Math.min(480, startW + delta))
  }
  const onUp = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    uiStore.persistSidebarWidth()
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
}

// Listen for file system changes and refresh status
onStatusChanged((repoId) => {
  if (repoId === repoStore.activeRepoId) {
    workspaceStore.refresh(repoId)
    submodulesStore.loadSubmodules()
    // WIP 模式下右侧 diff 也要跟着工作区内容自动刷新；
    // diffStore.refresh 在 currentPath === null 时是 no-op，非 WIP 场景安全。
    diffStore.refresh()
    // 外部 git 操作（命令行 commit/push/fetch/switch/stash 等）也会触发此事件，
    // 需要同步刷新 history、branches 和 stash
    historyStore.loadLog()
    historyStore.loadBranches()
    stashStore.refresh()
  }
})

// Refresh workspace when active repo changes
watch(
  () => repoStore.activeRepoId,
  async (id) => {
    if (id) {
      router.push('/history')
      await workspaceStore.refresh(id)
      await historyStore.loadLog()
      await historyStore.loadBranches()
      await submodulesStore.loadSubmodules()
      await stashStore.refresh()
    } else {
      submodulesStore.reset()
      stashStore.reset()
    }
  }
)
</script>

<template>
  <div class="app-layout">
    <AppToolbar />
    <div class="app-body">
      <AppSidebar :style="{ width: uiStore.sidebarWidth + 'px' }" />
      <div class="sidebar-resize" @pointerdown="startSidebarResize" />
      <main class="app-main">
        <RouterView />
      </main>
    </div>
    <AppStatusBar />
  </div>
</template>

<style scoped>
.app-layout {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
  background: var(--bg-primary);
}

.app-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.app-main {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* Sidebar resize handle: 覆盖在 sidebar 右边界上 */
.sidebar-resize {
  width: 6px;
  margin-left: -3px;
  cursor: col-resize;
  flex-shrink: 0;
  z-index: 10;
  background: transparent;
  transition: background 0.15s;
}
.sidebar-resize:hover,
.sidebar-resize:active {
  background: rgba(138, 173, 244, 0.3);
}
</style>
