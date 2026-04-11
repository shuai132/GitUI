<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import AppSidebar from '@/components/layout/AppSidebar.vue'
import AppToolbar from '@/components/layout/AppToolbar.vue'
import AppStatusBar from '@/components/layout/AppStatusBar.vue'
import { useRepoStore } from '@/stores/repos'
import { useWorkspaceStore } from '@/stores/workspace'
import { useHistoryStore } from '@/stores/history'
import { useGitEvents } from '@/composables/useGitEvents'

const repoStore = useRepoStore()
const workspaceStore = useWorkspaceStore()
const historyStore = useHistoryStore()
const { onStatusChanged } = useGitEvents()

// 启动时从持久化存储恢复仓库列表
onMounted(() => {
  repoStore.loadPersisted()
})

// ── Sidebar width (可拖动 + 持久化) ──────────────────────────────────
const SIDEBAR_KEY = 'gitui.sidebar.width'
const sidebarWidth = ref<number>(Number(localStorage.getItem(SIDEBAR_KEY)) || 220)

function startSidebarResize(e: PointerEvent) {
  e.preventDefault()
  const startX = e.clientX
  const startW = sidebarWidth.value
  const onMove = (ev: PointerEvent) => {
    const delta = ev.clientX - startX
    sidebarWidth.value = Math.max(160, Math.min(480, startW + delta))
  }
  const onUp = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    localStorage.setItem(SIDEBAR_KEY, String(sidebarWidth.value))
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
  }
})

// Refresh workspace when active repo changes
watch(
  () => repoStore.activeRepoId,
  async (id) => {
    if (id) {
      await workspaceStore.refresh(id)
      await historyStore.loadLog()
      await historyStore.loadBranches()
    }
  }
)
</script>

<template>
  <div class="app-layout">
    <AppToolbar />
    <div class="app-body">
      <AppSidebar :style="{ width: sidebarWidth + 'px' }" />
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
