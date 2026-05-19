<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRepoStore } from '@/stores/repos'
import { useUiStore } from '@/stores/ui'
import { scrollElementByWheel } from '@/utils/wheelScroll'
import SidebarLocalBranches from '../sidebar/SidebarLocalBranches.vue'
import SidebarTags from '../sidebar/SidebarTags.vue'
import SidebarStash from '../sidebar/SidebarStash.vue'
import SidebarSubmodules from '../sidebar/SidebarSubmodules.vue'
import SidebarRemote from '../sidebar/SidebarRemote.vue'
import SidebarAllRepos from '../sidebar/SidebarAllRepos.vue'

const { t } = useI18n()
const repoStore = useRepoStore()
const uiStore = useUiStore()
const sidebarScrollRef = ref<HTMLElement | null>(null)

function onSidebarWheel(e: WheelEvent) {
  scrollElementByWheel(e, sidebarScrollRef.value, { lineSize: 22 })
}

function collapseSidebar() {
  uiStore.sidebarWidth = 0
  uiStore.persistSidebarWidth()
}
</script>

<template>
  <aside class="sidebar" :class="{ 'sidebar--collapsed': uiStore.sidebarWidth === 0 }">
    <!-- Repo header -->
    <div class="repo-header">
      <div class="repo-name" :title="repoStore.activeRepo()?.path">
        {{ repoStore.activeRepo()?.name ?? t('sidebar.repo.noRepo') }}
      </div>
      <button
        class="sidebar-collapse-btn"
        type="button"
        :title="t('app.sidebar.collapseHint')"
        @click="collapseSidebar"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
          <path d="M15 18l-6-6 6-6" />
          <path d="M20 4v16" />
        </svg>
      </button>
    </div>

    <div class="sidebar-scroll" ref="sidebarScrollRef" @wheel="onSidebarWheel">
      <SidebarLocalBranches />
      <SidebarTags />
      <SidebarStash />
      <SidebarSubmodules />
      <SidebarRemote />
    </div>

    <SidebarAllRepos />
  </aside>
</template>

<style scoped>
.sidebar {
  width: 220px;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  flex-shrink: 0;
}

.sidebar--collapsed {
  border-right: 0;
}

.repo-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 8px 7px 12px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  min-height: 38px;
}

.repo-name {
  flex: 1;
  min-width: 0;
  font-size: var(--font-base);
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sidebar-collapse-btn {
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border: 1px solid transparent;
  border-radius: 5px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.sidebar-collapse-btn:hover {
  color: var(--text-primary);
  background: var(--bg-overlay);
  border-color: var(--border);
}

.sidebar-scroll {
  flex: 1;
  overflow-y: auto;
  padding-bottom: 8px;
}
</style>
