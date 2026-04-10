<script setup lang="ts">
import { computed } from 'vue'
import { useHistoryStore } from '@/stores/history'
import { formatAbsoluteTime } from '@/utils/format'
import DiffViewer from '@/components/diff/DiffViewer.vue'

const historyStore = useHistoryStore()

const commit = computed(() => historyStore.selectedCommit)
const selectedDiff = computed(() =>
  commit.value?.diffs[0] ?? null
)
</script>

<template>
  <div class="commit-detail" v-if="commit">
    <div class="commit-meta">
      <div class="meta-row">
        <span class="meta-label">提交</span>
        <span class="meta-value oid">{{ commit.info.oid }}</span>
      </div>
      <div class="meta-row">
        <span class="meta-label">作者</span>
        <span class="meta-value">{{ commit.info.author_name }} &lt;{{ commit.info.author_email }}&gt;</span>
      </div>
      <div class="meta-row">
        <span class="meta-label">时间</span>
        <span class="meta-value">{{ formatAbsoluteTime(commit.info.time) }}</span>
      </div>
      <div class="meta-message">{{ commit.info.message }}</div>
    </div>

    <div class="changed-files">
      <div class="section-header">变更文件 ({{ commit.diffs.length }})</div>
      <div class="file-list">
        <div
          v-for="(diff, idx) in commit.diffs"
          :key="idx"
          class="file-item"
        >
          <span class="file-stats">
            <span class="additions">+{{ diff.additions }}</span>
            <span class="deletions">-{{ diff.deletions }}</span>
          </span>
          <span class="file-path">{{ diff.new_path ?? diff.old_path }}</span>
        </div>
      </div>
    </div>

    <DiffViewer :diff="selectedDiff" />
  </div>

  <div v-else class="empty-state">
    选择一个提交查看详情
  </div>
</template>

<style scoped>
.commit-detail {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.commit-meta {
  padding: 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-secondary);
  flex-shrink: 0;
}

.meta-row {
  display: flex;
  gap: 8px;
  margin-bottom: 4px;
  font-size: 12px;
}

.meta-label {
  color: var(--text-muted);
  width: 36px;
  flex-shrink: 0;
}

.meta-value {
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta-value.oid {
  font-family: 'SF Mono', monospace;
  color: var(--accent-blue);
  font-size: 11px;
}

.meta-message {
  margin-top: 8px;
  font-size: 13px;
  color: var(--text-primary);
  white-space: pre-wrap;
  word-break: break-word;
}

.changed-files {
  flex-shrink: 0;
  max-height: 150px;
  overflow-y: auto;
  border-bottom: 1px solid var(--border);
}

.section-header {
  padding: 4px 12px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--text-muted);
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
}

.file-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 12px;
  font-size: 11px;
}

.file-stats {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.additions {
  color: var(--accent-green);
}

.deletions {
  color: var(--accent-red);
}

.file-path {
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-muted);
  font-size: 13px;
}
</style>
