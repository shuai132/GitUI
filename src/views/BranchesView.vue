<script setup lang="ts">
import { useRepoStore } from '@/stores/repos'
import BranchList from '@/components/branch/BranchList.vue'

const repoStore = useRepoStore()
</script>

<template>
  <div class="branches-view">
    <div v-if="!repoStore.activeRepoId" class="no-repo">
      请先打开一个 Git 仓库
    </div>
    <BranchList v-else />
  </div>
</template>

<style scoped>
.branches-view {
  height: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.no-repo {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: 13px;
}
</style>
