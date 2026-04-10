<script setup lang="ts">
import { useRepoStore } from '@/stores/repos'

const repoStore = useRepoStore()

async function openRepo() {
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
</script>

<template>
  <aside class="sidebar">
    <div class="sidebar-header">
      <span class="sidebar-title">仓库</span>
      <button class="btn-add" title="添加仓库" @click="openRepo">+</button>
    </div>
    <div class="repo-list">
      <div
        v-for="repo in repoStore.repos"
        :key="repo.id"
        class="repo-item"
        :class="{ active: repo.id === repoStore.activeRepoId }"
        @click="repoStore.setActive(repo.id)"
      >
        <div class="repo-icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
          </svg>
        </div>
        <span class="repo-name">{{ repo.name }}</span>
      </div>

      <div v-if="repoStore.repos.length === 0" class="empty-hint">
        <p>点击 + 添加仓库</p>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  width: 200px;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
}

.sidebar-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
}

.btn-add {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-secondary);
  font-size: 18px;
  line-height: 1;
  padding: 0 4px;
  border-radius: 3px;
  transition: background 0.15s, color 0.15s;
}

.btn-add:hover {
  background: var(--bg-overlay);
  color: var(--text-primary);
}

.repo-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}

.repo-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  cursor: pointer;
  border-radius: 0;
  transition: background 0.1s;
}

.repo-item:hover {
  background: var(--bg-overlay);
}

.repo-item.active {
  background: var(--bg-surface);
  color: var(--accent-blue);
}

.repo-icon {
  color: var(--text-muted);
  flex-shrink: 0;
}

.repo-item.active .repo-icon {
  color: var(--accent-blue);
}

.repo-name {
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.empty-hint {
  padding: 16px 12px;
  text-align: center;
  color: var(--text-muted);
  font-size: 12px;
}
</style>
