<script setup lang="ts">
import { onMounted, watch } from 'vue'
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
      <AppSidebar />
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
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
</style>
