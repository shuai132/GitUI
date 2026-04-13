<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useRepoStore } from '@/stores/repos'
import BranchList from '@/components/branch/BranchList.vue'

const { t } = useI18n()
const repoStore = useRepoStore()
</script>

<template>
  <div class="branches-view">
    <div v-if="!repoStore.activeRepoId" class="no-repo">
      {{ t('branches.noRepo') }}
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
  font-size: var(--font-base);
}
</style>
