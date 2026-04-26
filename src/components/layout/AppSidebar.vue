<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useRepoStore } from '@/stores/repos'
import { useRepoCreation } from '@/composables/useRepoCreation'
import SidebarLocalBranches from '../sidebar/SidebarLocalBranches.vue'
import SidebarTags from '../sidebar/SidebarTags.vue'
import SidebarStash from '../sidebar/SidebarStash.vue'
import SidebarSubmodules from '../sidebar/SidebarSubmodules.vue'
import SidebarRemote from '../sidebar/SidebarRemote.vue'
import SidebarAllRepos from '../sidebar/SidebarAllRepos.vue'

const { t } = useI18n()
const repoStore = useRepoStore()
const repoCreation = useRepoCreation()

function showAddRepoMenu(e: MouseEvent) {
  repoCreation.showMenuAt(e.currentTarget as HTMLElement)
}
</script>

<template>
  <aside class="sidebar">
    <!-- Repo header -->
    <div class="repo-header">
      <div class="repo-name" :title="repoStore.activeRepo()?.path">
        {{ repoStore.activeRepo()?.name ?? t('sidebar.repo.noRepo') }}
      </div>
      <button
        class="btn-add"
        :title="t('repo.menu.title')"
        data-menu-anchor
        @click="showAddRepoMenu($event)"
      >+</button>
    </div>

    <div class="sidebar-scroll">
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

.repo-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px 8px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.repo-name {
  font-size: var(--font-base);
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.btn-add {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-muted);
  font-size: var(--font-xl);
  line-height: 1;
  padding: 0 4px;
  border-radius: 3px;
  transition: color 0.15s;
}

.btn-add:hover {
  color: var(--text-primary);
}

.sidebar-scroll {
  flex: 1;
  overflow-y: auto;
  padding-bottom: 8px;
}
</style>
