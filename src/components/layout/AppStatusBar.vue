<script setup lang="ts">
import { computed } from 'vue'
import { useWorkspaceStore } from '@/stores/workspace'
import { useRepoStore } from '@/stores/repos'

const workspaceStore = useWorkspaceStore()
const repoStore = useRepoStore()

const branch = computed(() => workspaceStore.status?.head_branch ?? 'HEAD')
const isDetached = computed(() => workspaceStore.status?.is_detached ?? false)
const stagedCount = computed(() => workspaceStore.status?.staged.length ?? 0)
const unstagedCount = computed(() => workspaceStore.status?.unstaged.length ?? 0)
</script>

<template>
  <div class="statusbar">
    <div class="status-left">
      <span class="branch-indicator" v-if="repoStore.activeRepoId">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="6" y1="3" x2="6" y2="15"/>
          <circle cx="18" cy="6" r="3"/>
          <circle cx="6" cy="18" r="3"/>
          <path d="M18 9a9 9 0 0 1-9 9"/>
        </svg>
        <span :class="{ detached: isDetached }">{{ branch }}</span>
      </span>
    </div>
    <div class="status-right">
      <span v-if="stagedCount > 0" class="status-indicator staged">{{ stagedCount }} staged</span>
      <span v-if="unstagedCount > 0" class="status-indicator unstaged">{{ unstagedCount }} changed</span>
    </div>
  </div>
</template>

<style scoped>
.statusbar {
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  background: var(--bg-secondary);
  border-top: 1px solid var(--border);
  font-size: var(--font-sm);
  color: var(--text-muted);
  flex-shrink: 0;
}

.status-left, .status-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.branch-indicator {
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--text-secondary);
}

.branch-indicator .detached {
  color: var(--accent-yellow);
}

.status-indicator {
  font-size: var(--font-xs);
}

.staged {
  color: var(--accent-green);
}

.unstaged {
  color: var(--accent-yellow);
}
</style>
