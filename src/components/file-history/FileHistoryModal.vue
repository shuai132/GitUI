<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CommitInfo, FileDiff, FileBlame, BlameHunk } from '@/types/git'
import { useGitCommands } from '@/composables/useGitCommands'
import { useRepoStore } from '@/stores/repos'
import DiffView from '@/components/diff/DiffView.vue'
import { formatTime } from '@/utils/format'
import { EXT_TO_LANG } from '@/lib/highlight'
import { highlightLine } from '@/lib/highlight'
import { GRAPH_COLORS } from '@/utils/graph'

const { t } = useI18n()

const props = defineProps<{
  filePath: string
  initialMode?: 'history' | 'blame'
}>()

const emit = defineEmits<{
  close: []
}>()

const repoStore = useRepoStore()
const gitCmd = useGitCommands()

// ── 标签页 ────────────────────────────────────────────────────────────────
const activeTab = ref<'history' | 'blame'>(props.initialMode ?? 'history')

// ── 文件历史 ──────────────────────────────────────────────────────────────
const historyCommits = ref<CommitInfo[]>([])
const historyLoading = ref(false)
const historyHasMore = ref(false)
const HISTORY_BATCH = 50

const selectedCommit = ref<CommitInfo | null>(null)
const selectedDiff = ref<FileDiff | null>(null)
const diffLoading = ref(false)

async function loadHistory(reset = false) {
  const repoId = repoStore.activeRepoId
  if (!repoId) return
  historyLoading.value = true
  try {
    const offset = reset ? 0 : historyCommits.value.length
    const result = await gitCmd.getFileLog(repoId, props.filePath, offset, HISTORY_BATCH)
    if (reset) historyCommits.value = result
    else historyCommits.value.push(...result)
    historyHasMore.value = result.length >= HISTORY_BATCH
  } finally {
    historyLoading.value = false
  }
}

async function selectCommit(commit: CommitInfo) {
  selectedCommit.value = commit
  selectedDiff.value = null
  const repoId = repoStore.activeRepoId
  if (!repoId) return
  diffLoading.value = true
  try {
    selectedDiff.value = await gitCmd.getFileDiffAtCommit(repoId, props.filePath, commit.oid)
  } finally {
    diffLoading.value = false
  }
}

// ── Blame ─────────────────────────────────────────────────────────────────
const blame = ref<FileBlame | null>(null)
const blameLoading = ref(false)

async function loadBlame() {
  const repoId = repoStore.activeRepoId
  if (!repoId || blame.value) return
  blameLoading.value = true
  try {
    blame.value = await gitCmd.getFileBlame(repoId, props.filePath)
  } finally {
    blameLoading.value = false
  }
}

// blame 中每一行对应的 hunk（预计算）
const blameLineHunks = computed<BlameHunk[]>(() => {
  if (!blame.value) return []
  const result: BlameHunk[] = []
  // hunks 是按行号排序的，先建一个数组 [line-1] => hunk
  const lineMap: BlameHunk[] = new Array(blame.value.lines.length)
  for (const hunk of blame.value.hunks) {
    for (let i = 0; i < hunk.num_lines; i++) {
      const lineIdx = hunk.start_line - 1 + i
      if (lineIdx < lineMap.length) lineMap[lineIdx] = hunk
    }
  }
  return lineMap
})

// 为每个不同 commit_oid 分配一个颜色索引（同一 commit 用同一色）
const commitColorMap = computed<Map<string, string>>(() => {
  if (!blame.value) return new Map()
  const map = new Map<string, string>()
  let colorIdx = 0
  for (const hunk of blame.value.hunks) {
    if (!map.has(hunk.commit_oid)) {
      map.set(hunk.commit_oid, GRAPH_COLORS[colorIdx % GRAPH_COLORS.length])
      colorIdx++
    }
  }
  return map
})

// 语法高亮语言
const syntaxLang = computed<string | null>(() => {
  const ext = props.filePath.split('.').pop()?.toLowerCase() ?? ''
  return EXT_TO_LANG[ext] ?? null
})

function blameBg(lineIdx: number): string {
  const hunk = blameLineHunks.value[lineIdx]
  if (!hunk) return ''
  const base = commitColorMap.value.get(hunk.commit_oid) ?? ''
  return base ? `color-mix(in srgb, ${base} 12%, var(--bg-secondary))` : ''
}

function isFirstLineOfHunk(lineIdx: number): boolean {
  const hunk = blameLineHunks.value[lineIdx]
  if (!hunk) return false
  return hunk.start_line - 1 === lineIdx
}

// ── Tab 切换时懒加载 ───────────────────────────────────────────────────────
watch(activeTab, (tab) => {
  if (tab === 'history' && historyCommits.value.length === 0) loadHistory(true)
  if (tab === 'blame') loadBlame()
})

onMounted(() => {
  if (activeTab.value === 'history') loadHistory(true)
  else loadBlame()
})

// ESC 关闭
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

const fileName = computed(() => props.filePath.split('/').pop() ?? props.filePath)
</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')" @keydown="onKeydown" tabindex="-1">
    <div class="modal-box">
      <!-- Header -->
      <div class="modal-header">
        <div class="tab-bar">
          <button
            class="tab-btn"
            :class="{ active: activeTab === 'history' }"
            @click="activeTab = 'history'"
          >{{ t('fileHistory.tabs.history') }}</button>
          <button
            class="tab-btn"
            :class="{ active: activeTab === 'blame' }"
            @click="activeTab = 'blame'"
          >{{ t('fileHistory.tabs.blame') }}</button>
        </div>
        <span class="file-path-label" :title="filePath">{{ fileName }}</span>
        <button class="close-btn" @click="emit('close')">✕</button>
      </div>

      <!-- History Tab -->
      <div v-if="activeTab === 'history'" class="tab-content history-tab">
        <!-- 左侧：commit 列表 -->
        <div class="commit-list">
          <div v-if="historyLoading && historyCommits.length === 0" class="loading-msg">
            {{ t('fileHistory.loading') }}
          </div>
          <div
            v-for="c in historyCommits"
            :key="c.oid"
            class="commit-row"
            :class="{ selected: selectedCommit?.oid === c.oid }"
            @click="selectCommit(c)"
          >
            <span class="c-oid">{{ c.short_oid }}</span>
            <span class="c-summary">{{ c.summary }}</span>
            <span class="c-meta">{{ c.author_name }} · {{ formatTime(c.time) }}</span>
          </div>
          <div v-if="historyHasMore" class="load-more-row">
            <button class="btn-load-more" @click="loadHistory(false)" :disabled="historyLoading">
              {{ historyLoading ? t('fileHistory.loading') : t('fileHistory.loadMore') }}
            </button>
          </div>
          <div v-if="!historyLoading && historyCommits.length === 0" class="empty-msg">
            {{ t('fileHistory.noHistory') }}
          </div>
        </div>

        <!-- 右侧：选中 commit 的 diff -->
        <div class="diff-pane">
          <div v-if="!selectedCommit" class="diff-empty">
            {{ t('fileHistory.selectCommit') }}
          </div>
          <DiffView v-else :diff="selectedDiff" :loading="diffLoading" />
        </div>
      </div>

      <!-- Blame Tab -->
      <div v-if="activeTab === 'blame'" class="tab-content blame-tab">
        <div v-if="blameLoading" class="loading-msg">{{ t('fileHistory.blameLoading') }}</div>
        <div v-else-if="!blame" class="empty-msg">{{ t('fileHistory.noBlame') }}</div>
        <div v-else class="blame-content">
          <div
            v-for="(line, idx) in blame.lines"
            :key="idx"
            class="blame-row"
            :style="{ background: blameBg(idx) }"
            :title="blameLineHunks[idx]?.summary ?? ''"
          >
            <!-- 注解列：只在 hunk 首行显示，其余行留空 -->
            <span class="blame-ann" v-if="isFirstLineOfHunk(idx)">
              <span class="blame-oid">{{ blameLineHunks[idx]?.short_oid }}</span>
              <span class="blame-author">{{ blameLineHunks[idx]?.author_name }}</span>
              <span class="blame-time">{{ formatTime(blameLineHunks[idx]?.time ?? 0) }}</span>
            </span>
            <span class="blame-ann empty" v-else></span>
            <!-- 行号 -->
            <span class="blame-lineno">{{ idx + 1 }}</span>
            <!-- 行内容（语法高亮） -->
            <span
              class="blame-code"
              v-if="syntaxLang"
              v-html="highlightLine(line, syntaxLang)"
            ></span>
            <span class="blame-code" v-else>{{ line }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal-box {
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  width: min(1100px, 94vw);
  height: min(720px, 90vh);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.4);
}

/* Header */
.modal-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.tab-bar {
  display: flex;
  gap: 2px;
  background: var(--bg-secondary);
  border-radius: 6px;
  padding: 2px;
}

.tab-btn {
  padding: 3px 12px;
  font-size: 12px;
  background: transparent;
  border: none;
  border-radius: 4px;
  color: var(--text-muted);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.tab-btn:hover { color: var(--text-primary); }
.tab-btn.active {
  background: var(--bg-primary);
  color: var(--text-primary);
}

.file-path-label {
  font-size: 12px;
  color: var(--text-muted);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.close-btn {
  background: none;
  border: none;
  font-size: 14px;
  color: var(--text-muted);
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  line-height: 1;
}
.close-btn:hover { background: var(--bg-hover); color: var(--text-primary); }

/* Tab content */
.tab-content {
  flex: 1;
  overflow: hidden;
  display: flex;
}

/* History tab */
.history-tab {
  flex-direction: row;
}

.commit-list {
  width: 280px;
  flex-shrink: 0;
  border-right: 1px solid var(--border-color);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.commit-row {
  padding: 7px 10px;
  cursor: pointer;
  border-bottom: 1px solid var(--border-subtle);
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.commit-row:hover { background: var(--bg-hover); }
.commit-row.selected { background: var(--bg-selected); }

.c-oid {
  font-family: var(--font-code, monospace);
  font-size: 11px;
  color: var(--accent-blue);
}
.c-summary {
  font-size: 12px;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.c-meta {
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.load-more-row {
  padding: 8px;
  text-align: center;
}
.btn-load-more {
  font-size: 12px;
  padding: 4px 12px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  color: var(--text-primary);
  cursor: pointer;
}
.btn-load-more:disabled { opacity: 0.5; cursor: default; }
.btn-load-more:not(:disabled):hover { background: var(--bg-hover); }

.diff-pane {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.diff-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: 13px;
}

/* Blame tab */
.blame-tab {
  flex-direction: column;
}

.blame-content {
  flex: 1;
  overflow: auto;
  font-family: var(--font-code, monospace);
  font-size: var(--code-font-size, 12px);
}

.blame-row {
  display: flex;
  align-items: baseline;
  min-height: 18px;
  line-height: 18px;
  white-space: pre;
}
.blame-row:hover { filter: brightness(1.1); }

.blame-ann {
  display: inline-flex;
  align-items: baseline;
  gap: 5px;
  width: 22ch;
  flex-shrink: 0;
  overflow: hidden;
  padding: 0 6px;
  border-right: 1px solid var(--border-subtle);
  font-size: 11px;
  color: var(--text-muted);
}
.blame-ann.empty {
  border-right: 1px solid var(--border-subtle);
}

.blame-oid {
  font-family: var(--font-code, monospace);
  color: var(--accent-blue);
  flex-shrink: 0;
}

.blame-author {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 7ch;
  flex-shrink: 1;
}

.blame-time {
  white-space: nowrap;
  flex-shrink: 0;
}

.blame-lineno {
  width: 4ch;
  flex-shrink: 0;
  text-align: right;
  color: var(--text-muted);
  padding-right: 8px;
  user-select: none;
  font-size: 11px;
}

.blame-code {
  flex: 1;
  padding-left: 4px;
  white-space: pre;
  overflow: visible;
}

/* 通用 */
.loading-msg,
.empty-msg {
  padding: 24px;
  color: var(--text-muted);
  font-size: 13px;
  text-align: center;
}
</style>
