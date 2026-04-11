<script setup lang="ts">
import { computed } from 'vue'
import type { CommitDetail } from '@/types/git'
import { formatAbsoluteTime } from '@/utils/format'
import { GRAPH_COLORS } from '@/utils/graph'

const props = defineProps<{
  commit: CommitDetail | null
  selectedFileIdx: number
}>()

const emit = defineEmits<{
  selectFile: [idx: number]
}>()

const initials = computed(() => {
  const name = props.commit?.info.author_name ?? ''
  return name
    .split(/\s+/)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .slice(0, 2)
    .join('')
})

const avatarColor = computed(() => {
  const name = props.commit?.info.author_name ?? ''
  let hash = 0
  for (const c of name) hash = ((hash * 31) + c.charCodeAt(0)) & 0x7fffffff
  return GRAPH_COLORS[hash % GRAPH_COLORS.length]
})

const bodyText = computed(() => {
  const msg = props.commit?.info.message ?? ''
  const firstLine = msg.indexOf('\n')
  return firstLine !== -1 ? msg.slice(firstLine + 1).trim() : ''
})
</script>

<template>
  <div class="commit-info-panel" v-if="commit">
    <!-- Header: avatar + commit title -->
    <div class="panel-header">
      <div class="avatar" :style="{ background: avatarColor }">{{ initials }}</div>
      <div class="title-block">
        <div class="commit-summary">{{ commit.info.summary }}</div>
        <div class="commit-body" v-if="bodyText">{{ bodyText }}</div>
      </div>
    </div>

    <!-- Metadata grid -->
    <div class="meta-grid">
      <span class="mk">提交</span>
      <span class="mv oid">{{ commit.info.oid.slice(0, 16) }}</span>

      <span class="mk">作者</span>
      <span class="mv">{{ commit.info.author_name }}</span>

      <span class="mk">日期</span>
      <span class="mv">{{ formatAbsoluteTime(commit.info.time) }}</span>

      <span class="mk">邮箱</span>
      <span class="mv dim">{{ commit.info.author_email }}</span>

      <template v-if="commit.info.parent_oids.length">
        <span class="mk">父提交</span>
        <span class="mv">
          <span
            v-for="p in commit.info.parent_oids"
            :key="p"
            class="parent-chip"
          >{{ p.slice(0, 7) }}</span>
        </span>
      </template>
    </div>

    <!-- Changed files tab strip -->
    <div class="file-tabs" v-if="commit.diffs.length">
      <div
        v-for="(d, idx) in commit.diffs"
        :key="idx"
        class="file-tab"
        :class="{ active: idx === selectedFileIdx }"
        @click="emit('selectFile', idx)"
        :title="d.new_path ?? d.old_path ?? ''"
      >
        <span class="file-name">{{ (d.new_path ?? d.old_path ?? '').split('/').pop() }}</span>
        <span class="file-stats">
          <span class="add">+{{ d.additions }}</span>
          <span class="del">-{{ d.deletions }}</span>
        </span>
      </div>
    </div>
  </div>

  <div v-else class="panel-empty">选择提交查看详情</div>
</template>

<style scoped>
.commit-info-panel {
  display: flex;
  flex-direction: column;
  background: var(--bg-secondary);
  border-top: 1px solid var(--border);
  overflow: hidden;
  height: 100%;
}

.panel-header {
  display: flex;
  gap: 10px;
  padding: 10px 12px 8px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  min-height: 0;
}

/* 盖过全局 * { user-select: none }：通配符直接给每个子元素设 none，
   单独给父元素设 text 不会继承，需要连子孙一起覆写。 */
.panel-header,
.panel-header *,
.meta-grid,
.meta-grid * {
  user-select: text;
  -webkit-user-select: text;
}

.avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 700;
  color: var(--bg-primary);
  flex-shrink: 0;
}

.title-block {
  flex: 1;
  min-width: 0;
}

.commit-summary {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  /* 超长标题改为水平滚动而非截断 */
  white-space: nowrap;
  overflow-x: auto;
  overflow-y: hidden;
}

.commit-body {
  font-size: 11px;
  color: var(--text-secondary);
  margin-top: 3px;
  /* 多行 body 完整显示：保留原始换行；超长行水平滚动，超高内容垂直滚动 */
  white-space: pre;
  overflow: auto;
  max-height: 160px;
}

/* 细滚动条，避免滚动条占走太多空间 */
.commit-summary::-webkit-scrollbar,
.commit-body::-webkit-scrollbar,
.mv::-webkit-scrollbar {
  height: 4px;
  width: 6px;
}
.commit-summary::-webkit-scrollbar-thumb,
.commit-body::-webkit-scrollbar-thumb,
.mv::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 2px;
}
.commit-summary::-webkit-scrollbar-track,
.commit-body::-webkit-scrollbar-track,
.mv::-webkit-scrollbar-track {
  background: transparent;
}

.meta-grid {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr);
  gap: 2px 8px;
  padding: 6px 12px;
  font-size: 11px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.mk {
  color: var(--text-muted);
  text-align: right;
  align-self: center;
  white-space: nowrap;
}

.mv {
  color: var(--text-primary);
  white-space: nowrap;
  overflow-x: auto;
  overflow-y: hidden;
  align-self: center;
  /* 最小高度保持行对齐，避免滚动条把行撑高 */
  min-width: 0;
}

.mv.oid {
  font-family: 'SF Mono', monospace;
  font-size: 10px;
  color: var(--accent-blue);
}

.mv.dim {
  color: var(--text-secondary);
}

.parent-chip {
  display: inline-block;
  background: var(--bg-overlay);
  border-radius: 3px;
  padding: 1px 5px;
  font-family: 'SF Mono', monospace;
  font-size: 10px;
  color: var(--accent-blue);
  margin-right: 4px;
  cursor: pointer;
}

.file-tabs {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 4px 0;
}

.file-tab {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 3px 12px;
  cursor: pointer;
  font-size: 11px;
  transition: background 0.1s;
}

.file-tab:hover {
  background: var(--bg-overlay);
}

.file-tab.active {
  background: rgba(138, 173, 244, 0.15);
  border-left: 2px solid var(--accent-blue);
}

.file-name {
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-tab.active .file-name {
  color: var(--text-primary);
}

.file-stats {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
  margin-left: 8px;
}

.add { color: var(--accent-green); }
.del { color: var(--accent-red); }

.panel-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-muted);
  font-size: 12px;
  background: var(--bg-secondary);
  border-top: 1px solid var(--border);
}
</style>
