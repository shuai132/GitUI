<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useHistoryStore } from '@/stores/history'
import { formatTime } from '@/utils/format'

const { t } = useI18n()
const historyStore = useHistoryStore()

const listEl = ref<HTMLElement | null>(null)

function onScroll(e: Event) {
  const el = e.target as HTMLElement
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 100) {
    historyStore.loadMore()
  }
}
</script>

<template>
  <div class="commit-list" ref="listEl" @scroll="onScroll">
    <div v-if="historyStore.loading" class="loading-hint">{{ t('history.loading') }}</div>
    <div
      v-for="commit in historyStore.commits"
      :key="commit.oid"
      class="commit-item"
      :class="{ selected: historyStore.selectedCommit?.info.oid === commit.oid }"
      @click="historyStore.selectCommit(commit.oid)"
    >
      <div class="commit-header">
        <span class="commit-oid">{{ commit.short_oid }}</span>
        <span class="commit-time">{{ formatTime(commit.time) }}</span>
      </div>
      <div class="commit-summary">{{ commit.summary }}</div>
      <div class="commit-author">{{ commit.author_name }}</div>
    </div>

    <div v-if="historyStore.loadingMore" class="loading-hint">{{ t('history.loadingMore') }}</div>
    <div v-if="!historyStore.hasMore && historyStore.commits.length > 0" class="end-hint">
      {{ t('history.totalCount', { count: historyStore.commits.length }) }}
    </div>
    <div v-if="!historyStore.loading && historyStore.commits.length === 0" class="empty-hint">
      {{ t('history.empty.noCommits') }}
    </div>
  </div>
</template>

<style scoped>
.commit-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.commit-item {
  padding: 8px 12px;
  cursor: pointer;
  border-bottom: 1px solid var(--border);
  transition: background 0.1s;
}

.commit-item:hover {
  background: var(--bg-overlay);
}

.commit-item.selected {
  background: var(--bg-surface);
  border-left: 2px solid var(--accent-blue);
}

.commit-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 3px;
}

.commit-oid {
  font-family: Menlo, 'SF Mono', monospace;
  font-size: var(--font-sm);
  color: var(--accent-blue);
}

.commit-time {
  font-size: var(--font-sm);
  color: var(--text-muted);
}

.commit-summary {
  font-size: var(--font-md);
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-bottom: 2px;
}

.commit-author {
  font-size: var(--font-sm);
  color: var(--text-muted);
}

.loading-hint, .end-hint, .empty-hint {
  padding: 12px;
  text-align: center;
  color: var(--text-muted);
  font-size: var(--font-sm);
}
</style>
