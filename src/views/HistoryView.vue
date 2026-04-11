<script setup lang="ts">
import { ref, computed } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { useHistoryStore } from '@/stores/history'
import { useRepoStore } from '@/stores/repos'
import { formatTime } from '@/utils/format'
import { LANE_W, ROW_H } from '@/utils/graph'
import CommitGraphRow from '@/components/history/CommitGraphRow.vue'
import SideBySideDiff from '@/components/diff/SideBySideDiff.vue'
import CommitInfoPanel from '@/components/history/CommitInfoPanel.vue'
import type { BranchInfo } from '@/types/git'

const historyStore = useHistoryStore()
const repoStore = useRepoStore()

const scrollContainer = ref<HTMLElement | null>(null)

// ── Virtual list ────────────────────────────────────────────────────
const virtualizer = useVirtualizer(
  computed(() => ({
    count: historyStore.commits.length,
    getScrollElement: () => scrollContainer.value,
    estimateSize: () => ROW_H,
    overscan: 10,
  }))
)

// Load more when near the bottom
function onScroll() {
  const el = scrollContainer.value
  if (!el) return
  if (el.scrollHeight - el.scrollTop - el.clientHeight < ROW_H * 5) {
    historyStore.loadMore()
  }
}

// ── Branch tag map (oid → branches pointing to this commit) ─────────
const branchTagMap = computed(() => {
  const map = new Map<string, BranchInfo[]>()
  for (const b of historyStore.branches) {
    if (b.commit_oid) {
      if (!map.has(b.commit_oid)) map.set(b.commit_oid, [])
      map.get(b.commit_oid)!.push(b)
    }
  }
  return map
})

function branchTagColor(b: BranchInfo): string {
  if (b.is_head) return 'var(--accent-blue)'
  if (b.is_remote) return 'var(--accent-orange)'
  return 'var(--accent-green)'
}

// ── Graph column width ───────────────────────────────────────────────
const graphColWidth = computed(() => {
  if (!historyStore.graphRows.length) return LANE_W * 2
  const maxCols = historyStore.graphRows.reduce((m, r) => Math.max(m, r.totalColumns), 1)
  return Math.min(maxCols * LANE_W, 180)
})

// ── Row selection ────────────────────────────────────────────────────
const selectedOid = computed(() => historyStore.selectedCommit?.info.oid ?? null)

function selectRow(idx: number) {
  const commit = historyStore.commits[idx]
  if (commit) historyStore.selectCommit(commit.oid)
}

function isSelected(idx: number): boolean {
  return historyStore.commits[idx]?.oid === selectedOid.value
}

// ── Current diff ─────────────────────────────────────────────────────
const currentDiff = computed(() => {
  const commit = historyStore.selectedCommit
  if (!commit) return null
  return commit.diffs[historyStore.selectedFileDiffIndex] ?? null
})

// ── Search / filter ──────────────────────────────────────────────────
const searchQuery = ref('')
</script>

<template>
  <div class="history-view" v-if="repoStore.activeRepoId">
    <!-- Top toolbar -->
    <div class="history-toolbar">
      <select class="filter-select">
        <option>所有分支</option>
      </select>
      <select class="filter-select">
        <option>显示远程分支</option>
        <option>隐藏远程分支</option>
      </select>
      <select class="filter-select">
        <option>所有远端</option>
      </select>
      <div class="search-box">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input v-model="searchQuery" class="search-input" placeholder="搜索提交..." />
      </div>
    </div>

    <!-- Content area -->
    <div class="content-area">
      <!-- LEFT: commit graph + list -->
      <div class="commit-panel">
        <!-- Column headers -->
        <div class="col-header">
          <div class="col-graph" :style="{ width: graphColWidth + 'px' }"></div>
          <div class="col-message">提交信息</div>
          <div class="col-hash">哈希</div>
          <div class="col-author">作者</div>
          <div class="col-date">日期</div>
        </div>

        <!-- Virtual list body -->
        <div
          class="commit-list-body"
          ref="scrollContainer"
          @scroll="onScroll"
        >
          <div v-if="historyStore.loading" class="list-hint">加载中...</div>
          <div
            v-else
            :style="{ height: virtualizer.getTotalSize() + 'px', position: 'relative' }"
          >
            <div
              v-for="vRow in virtualizer.getVirtualItems()"
              :key="vRow.index"
              class="commit-row"
              :class="{ selected: isSelected(vRow.index) }"
              :style="{
                position: 'absolute',
                top: vRow.start + 'px',
                height: ROW_H + 'px',
                width: '100%',
              }"
              @click="selectRow(vRow.index)"
            >
              <!-- Graph column -->
              <div class="col-graph" :style="{ width: graphColWidth + 'px' }">
                <CommitGraphRow
                  v-if="historyStore.graphRows[vRow.index]"
                  :row="historyStore.graphRows[vRow.index]"
                  :is-selected="isSelected(vRow.index)"
                />
              </div>

              <!-- Message column with branch tags -->
              <div class="col-message">
                <span
                  v-for="tag in branchTagMap.get(historyStore.commits[vRow.index]?.oid ?? '')"
                  :key="tag.name"
                  class="branch-tag"
                  :style="{ color: branchTagColor(tag), borderColor: branchTagColor(tag) }"
                >{{ tag.name }}</span>
                <span class="commit-msg">{{ historyStore.commits[vRow.index]?.summary }}</span>
              </div>

              <!-- Hash column -->
              <div class="col-hash">{{ historyStore.commits[vRow.index]?.short_oid }}</div>

              <!-- Author column -->
              <div class="col-author">{{ historyStore.commits[vRow.index]?.author_name }}</div>

              <!-- Date column -->
              <div class="col-date">{{ formatTime(historyStore.commits[vRow.index]?.time ?? 0) }}</div>
            </div>
          </div>

          <!-- Load more indicators -->
          <div v-if="historyStore.loadingMore" class="list-hint">加载更多...</div>
          <div v-if="!historyStore.hasMore && historyStore.commits.length > 0" class="list-hint dim">
            共 {{ historyStore.commits.length }} 条
          </div>
        </div>
      </div>

      <!-- RIGHT: diff + commit info -->
      <div class="right-panel">
        <!-- Side-by-side diff -->
        <div class="diff-area">
          <!-- File path header -->
          <div class="diff-file-header" v-if="currentDiff">
            <span class="diff-file-path">{{ currentDiff.new_path ?? currentDiff.old_path }}</span>
            <span class="diff-file-stats">
              <span class="add">+{{ currentDiff.additions }}</span>
              <span class="del">-{{ currentDiff.deletions }}</span>
            </span>
          </div>
          <SideBySideDiff :diff="currentDiff" />
        </div>

        <!-- Commit info panel -->
        <CommitInfoPanel
          :commit="historyStore.selectedCommit"
          :selected-file-idx="historyStore.selectedFileDiffIndex"
          @select-file="historyStore.selectFileDiff"
        />
      </div>
    </div>
  </div>

  <div v-else class="no-repo">
    请从左侧打开一个 Git 仓库
  </div>
</template>

<style scoped>
.history-view {
  display: grid;
  grid-template-rows: 36px 1fr;
  height: 100%;
  overflow: hidden;
}

.no-repo {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-muted);
  font-size: 13px;
}

/* ── Toolbar ─────────────────────────────────────────────────────── */
.history-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.filter-select {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-secondary);
  font-size: 11px;
  font-family: inherit;
  padding: 3px 6px;
  cursor: pointer;
  outline: none;
}

.filter-select:hover {
  border-color: var(--text-muted);
}

.search-box {
  display: flex;
  align-items: center;
  gap: 5px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 3px 8px;
  color: var(--text-muted);
  margin-left: auto;
}

.search-input {
  background: none;
  border: none;
  color: var(--text-primary);
  font-size: 11px;
  font-family: inherit;
  outline: none;
  width: 140px;
}

.search-input::placeholder {
  color: var(--text-muted);
}

/* ── Content area ────────────────────────────────────────────────── */
.content-area {
  display: grid;
  grid-template-columns: minmax(300px, 55%) 1fr;
  overflow: hidden;
}

/* ── Left: commit panel ──────────────────────────────────────────── */
.commit-panel {
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border);
  overflow: hidden;
}

.col-header {
  display: flex;
  align-items: center;
  height: 26px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.commit-list-body {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}

.commit-row {
  display: flex;
  align-items: center;
  cursor: pointer;
  border-bottom: 1px solid rgba(54, 58, 79, 0.4);
  transition: background 0.08s;
}

.commit-row:hover {
  background: var(--bg-overlay);
}

.commit-row.selected {
  background: rgba(138, 173, 244, 0.12);
}

/* ── Columns ─────────────────────────────────────────────────────── */
.col-graph {
  flex-shrink: 0;
  overflow: hidden;
  display: flex;
  align-items: center;
}

.col-message {
  flex: 1;
  min-width: 0;
  padding: 0 8px;
  display: flex;
  align-items: center;
  gap: 4px;
  overflow: hidden;
}

.col-hash {
  width: 64px;
  flex-shrink: 0;
  font-family: 'SF Mono', monospace;
  font-size: 11px;
  color: var(--accent-blue);
  padding: 0 6px;
}

.col-author {
  width: 96px;
  flex-shrink: 0;
  font-size: 11px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 0 6px;
}

.col-date {
  width: 80px;
  flex-shrink: 0;
  font-size: 11px;
  color: var(--text-muted);
  padding: 0 8px;
  white-space: nowrap;
}

.commit-msg {
  font-size: 12px;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.commit-row.selected .commit-msg {
  color: var(--text-primary);
}

.branch-tag {
  display: inline-block;
  font-size: 10px;
  border: 1px solid;
  border-radius: 3px;
  padding: 0 4px;
  line-height: 14px;
  flex-shrink: 0;
  white-space: nowrap;
  opacity: 0.9;
}

/* ── Hints ───────────────────────────────────────────────────────── */
.list-hint {
  text-align: center;
  padding: 10px;
  font-size: 11px;
  color: var(--text-muted);
}

.list-hint.dim {
  opacity: 0.6;
}

/* ── Right panel ─────────────────────────────────────────────────── */
.right-panel {
  display: grid;
  grid-template-rows: 1fr 230px;
  overflow: hidden;
}

.diff-area {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.diff-file-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 12px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  font-size: 11px;
}

.diff-file-path {
  color: var(--text-secondary);
  font-family: 'SF Mono', monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.diff-file-stats {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.add { color: var(--accent-green); }
.del { color: var(--accent-red); }
</style>
