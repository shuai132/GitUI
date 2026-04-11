<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { FileDiff } from '@/types/git'
import SideBySideDiff from './SideBySideDiff.vue'
import InlineDiff from './InlineDiff.vue'
import { EXT_TO_LANG } from '@/lib/highlight'

const props = defineProps<{
  diff: FileDiff | null
  loading?: boolean
}>()

const emit = defineEmits<{ close: [] }>()

type ViewMode = 'side-by-side' | 'inline' | 'by-hunk'

const VIEW_MODE_KEY = 'gitui.diff.viewMode'
const HIGHLIGHT_KEY = 'gitui.diff.syntax-highlight'

function loadViewMode(): ViewMode {
  const v = localStorage.getItem(VIEW_MODE_KEY)
  if (v === 'side-by-side' || v === 'inline' || v === 'by-hunk') return v
  return 'side-by-side'
}

const viewMode = ref<ViewMode>(loadViewMode())
const highlightEnabled = ref(localStorage.getItem(HIGHLIGHT_KEY) !== 'false')

watch(viewMode, (v) => {
  localStorage.setItem(VIEW_MODE_KEY, v)
})

function toggleHighlight() {
  highlightEnabled.value = !highlightEnabled.value
  localStorage.setItem(HIGHLIGHT_KEY, String(highlightEnabled.value))
}

const syntaxLang = computed<string | null>(() => {
  if (!highlightEnabled.value || !props.diff) return null
  const filePath = props.diff.new_path ?? props.diff.old_path ?? ''
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  return EXT_TO_LANG[ext] ?? null
})

// 子 diff 组件的引用（切换 viewMode 时 v-if 切换实例，ref 自动更新）
const diffRef = ref<{
  goNextChange: () => void
  goPrevChange: () => void
} | null>(null)

function onNextChange() {
  diffRef.value?.goNextChange()
}
function onPrevChange() {
  diffRef.value?.goPrevChange()
}
</script>

<template>
  <div class="diff-view">
    <!-- Toolbar -->
    <div class="diff-toolbar" v-if="diff">
      <span class="diff-file-path" :title="diff.new_path ?? diff.old_path">
        {{ diff.new_path ?? diff.old_path }}
      </span>
      <span class="diff-file-stats">
        <span class="add">+{{ diff.additions }}</span>
        <span class="del">-{{ diff.deletions }}</span>
      </span>

      <div class="toolbar-spacer" />

      <!-- 上 / 下变更跳转 -->
      <button
        class="btn-icon"
        title="上一变更"
        @click="onPrevChange"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="18 15 12 9 6 15" />
        </svg>
      </button>
      <button
        class="btn-icon"
        title="下一变更"
        @click="onNextChange"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      <div class="toolbar-divider" />

      <!-- 语法高亮开关 -->
      <button
        class="btn-icon"
        :class="{ active: highlightEnabled }"
        title="语法高亮"
        @click="toggleHighlight"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="16 18 22 12 16 6" />
          <polyline points="8 6 2 12 8 18" />
        </svg>
      </button>

      <div class="toolbar-divider" />

      <!-- 模式切换 -->
      <button
        class="btn-icon"
        :class="{ active: viewMode === 'by-hunk' }"
        title="按 hunk 分块"
        @click="viewMode = 'by-hunk'"
      >
        <!-- 两个独立方块 -->
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="2" y="2" width="12" height="5" rx="1" />
          <rect x="2" y="9" width="12" height="5" rx="1" />
        </svg>
      </button>
      <button
        class="btn-icon"
        :class="{ active: viewMode === 'inline' }"
        title="单列连续"
        @click="viewMode = 'inline'"
      >
        <!-- 水平条列表 -->
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
          <line x1="2" y1="4" x2="14" y2="4" />
          <line x1="2" y1="8" x2="14" y2="8" />
          <line x1="2" y1="12" x2="14" y2="12" />
        </svg>
      </button>
      <button
        class="btn-icon"
        :class="{ active: viewMode === 'side-by-side' }"
        title="左右分栏"
        @click="viewMode = 'side-by-side'"
      >
        <!-- 左右双栏 -->
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="2" y="2" width="12" height="12" rx="1" />
          <line x1="8" y1="2" x2="8" y2="14" />
        </svg>
      </button>

      <div class="toolbar-divider" />

      <!-- 关闭 diff 面板 -->
      <button class="btn-icon" title="关闭" @click="emit('close')">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>

    <!-- Diff body -->
    <div class="diff-body">
      <SideBySideDiff
        v-if="viewMode === 'side-by-side'"
        ref="diffRef"
        :diff="diff"
        :loading="loading"
        :syntax-lang="syntaxLang"
      />
      <InlineDiff
        v-else
        ref="diffRef"
        :diff="diff"
        :loading="loading"
        :group-by-hunk="viewMode === 'by-hunk'"
        :syntax-lang="syntaxLang"
      />
    </div>
  </div>
</template>

<style scoped>
.diff-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  min-width: 0;
  min-height: 0;
}

.diff-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px 5px 12px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  font-size: 11px;
  min-height: 28px;
}

.diff-file-path {
  color: var(--text-secondary);
  font-family: 'SF Mono', monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.diff-file-stats {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.add { color: var(--accent-green); }
.del { color: var(--accent-red); }

.toolbar-spacer {
  flex: 1;
}

.toolbar-divider {
  width: 1px;
  height: 16px;
  background: var(--border);
  margin: 0 4px;
}

.btn-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 22px;
  background: transparent;
  border: none;
  border-radius: 4px;
  color: var(--text-muted);
  cursor: pointer;
  transition: background 0.1s, color 0.1s;
  padding: 0;
  flex-shrink: 0;
}

.btn-icon:hover {
  background: var(--bg-overlay);
  color: var(--text-primary);
}

.btn-icon.active {
  background: rgba(138, 173, 244, 0.18);
  color: var(--accent-blue);
}

.diff-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
}
</style>
