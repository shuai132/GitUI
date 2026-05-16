<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRepoStore } from '@/stores/repos'
import { scrollElementByWheel } from '@/utils/wheelScroll'
import SidebarLocalBranches from '../sidebar/SidebarLocalBranches.vue'
import SidebarTags from '../sidebar/SidebarTags.vue'
import SidebarStash from '../sidebar/SidebarStash.vue'
import SidebarSubmodules from '../sidebar/SidebarSubmodules.vue'
import SidebarRemote from '../sidebar/SidebarRemote.vue'
import SidebarAllRepos from '../sidebar/SidebarAllRepos.vue'

const { t } = useI18n()
const repoStore = useRepoStore()
const sidebarScrollRef = ref<HTMLElement | null>(null)

function onSidebarWheel(e: WheelEvent) {
  scrollElementByWheel(e, sidebarScrollRef.value, { lineSize: 22 })
}
</script>

<template>
  <aside class="sidebar">
    <!-- Repo header -->
    <div class="repo-header">
      <div class="repo-name" :title="repoStore.activeRepo()?.path">
        {{ repoStore.activeRepo()?.name ?? t('sidebar.repo.noRepo') }}
      </div>
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

.repo-header {
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

.sidebar-scroll {
  flex: 1;
  overflow-y: auto;
  padding-bottom: 8px;
}
</style>
