<script setup lang="ts">
import { onMounted } from 'vue'
import { useHistoryStore } from '@/stores/history'
import { useRepoStore } from '@/stores/repos'
import CommitList from '@/components/history/CommitList.vue'
import CommitDetail from '@/components/history/CommitDetail.vue'

const historyStore = useHistoryStore()
const repoStore = useRepoStore()
</script>

<template>
  <div class="history-view">
    <div v-if="!repoStore.activeRepoId" class="no-repo">
      请先打开一个 Git 仓库
    </div>
    <template v-else>
      <div class="panel-left">
        <CommitList />
      </div>
      <div class="panel-right">
        <CommitDetail />
      </div>
    </template>
  </div>
</template>

<style scoped>
.history-view {
  display: flex;
  height: 100%;
  overflow: hidden;
}

.no-repo {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: 13px;
}

.panel-left {
  width: 320px;
  flex-shrink: 0;
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.panel-right {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
</style>
