<script setup lang="ts">
import { useRouter, useRoute } from 'vue-router'
import { useRepoStore } from '@/stores/repos'

const router = useRouter()
const route = useRoute()
const repoStore = useRepoStore()

async function openFolder() {
  // Use Tauri dialog to open directory
  try {
    const { open: openDialog } = await import('@tauri-apps/plugin-dialog')
    const selected = await openDialog({ directory: true })
    if (selected) {
      await repoStore.openRepo(selected as string)
    }
  } catch (e) {
    console.error(e)
  }
}

const tabs = [
  { name: 'workspace', label: '工作区', route: '/workspace' },
  { name: 'history', label: '历史', route: '/history' },
  { name: 'branches', label: '分支', route: '/branches' },
]
</script>

<template>
  <div class="toolbar">
    <div class="toolbar-left">
      <button class="btn-icon" title="打开仓库" @click="openFolder">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
      </button>
    </div>

    <div class="toolbar-tabs">
      <button
        v-for="tab in tabs"
        :key="tab.name"
        class="tab-btn"
        :class="{ active: route.path === tab.route }"
        @click="router.push(tab.route)"
      >
        {{ tab.label }}
      </button>
    </div>

    <div class="toolbar-right">
      <span class="repo-name">{{ repoStore.activeRepo()?.name ?? '无仓库' }}</span>
    </div>
  </div>
</template>

<style scoped>
.toolbar {
  height: 40px;
  display: flex;
  align-items: center;
  padding: 0 8px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  gap: 8px;
  flex-shrink: 0;
}

.toolbar-left {
  display: flex;
  gap: 4px;
}

.toolbar-tabs {
  display: flex;
  gap: 2px;
  flex: 1;
  justify-content: center;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-muted);
}

.repo-name {
  font-weight: 500;
  color: var(--text-secondary);
}

.btn-icon {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-secondary);
  padding: 4px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s;
}

.btn-icon:hover {
  background: var(--bg-overlay);
  color: var(--text-primary);
}

.tab-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-secondary);
  padding: 4px 12px;
  border-radius: 4px;
  font-size: 12px;
  font-family: inherit;
  transition: background 0.15s, color 0.15s;
}

.tab-btn:hover {
  background: var(--bg-overlay);
  color: var(--text-primary);
}

.tab-btn.active {
  background: var(--bg-overlay);
  color: var(--accent-blue);
}
</style>
