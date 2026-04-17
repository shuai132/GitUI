<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { FileDiff } from '@/types/git'
import SideBySideDiff from './SideBySideDiff.vue'
import InlineDiff from './InlineDiff.vue'
import ImageDiff from './ImageDiff.vue'
import ConflictView from './ConflictView.vue'
import { EXT_TO_LANG } from '@/lib/highlight'
import { detectPreviewKind } from '@/lib/preview'
import { useUiStore } from '@/stores/ui'

const { t } = useI18n()

const props = defineProps<{
  diff: FileDiff | null
  loading?: boolean
  repoId?: string
  /** WIP 场景传入；提交详情传 null 或不传 */
  wip?: { staged: boolean } | null
  /** 当前选中文件是冲突文件时的路径。非空则切换到冲突解决视图 */
  conflictFilePath?: string | null
}>()

const emit = defineEmits<{ close: [] }>()

const uiStore = useUiStore()

const syntaxLang = computed<string | null>(() => {
  if (!uiStore.diffHighlightEnabled || !props.diff) return null
  const filePath = props.diff.new_path ?? props.diff.old_path ?? ''
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  return EXT_TO_LANG[ext] ?? null
})

const previewKind = computed(() => {
  if (!props.diff) return null
  return detectPreviewKind(props.diff.new_path ?? props.diff.old_path)
})

// SVG 可在图片预览和文本 diff 之间切换；位图强制图片视图
const svgTextMode = ref(false)

const isImageView = computed(() => {
  if (previewKind.value === 'raster') return true
  if (previewKind.value === 'svg' && !svgTextMode.value) return true
  return false
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
  <!-- 冲突文件：专用双栏解决视图（自带 toolbar） -->
  <ConflictView
    v-if="conflictFilePath"
    :file-path="conflictFilePath"
    @close="emit('close')"
  />

  <div v-else class="diff-view">
    <!-- Toolbar -->
    <div class="diff-toolbar" v-if="diff">
      <span class="diff-file-path" :title="diff.new_path ?? diff.old_path">
        {{ diff.new_path ?? diff.old_path }}
      </span>
      <span class="diff-file-stats" v-if="!isImageView">
        <span class="add">+{{ diff.additions }}</span>
        <span class="del">-{{ diff.deletions }}</span>
      </span>

      <div class="toolbar-spacer" />

      <!-- 文本模式下才显示变更跳转、语法高亮、三种视图切换 -->
      <template v-if="!isImageView">
        <!-- 上 / 下变更跳转 -->
        <button
          class="btn-icon"
          :title="t('diff.toolbar.prevChange')"
          @click="onPrevChange"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="18 15 12 9 6 15" />
          </svg>
        </button>
        <button
          class="btn-icon"
          :title="t('diff.toolbar.nextChange')"
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
          :class="{ active: uiStore.diffHighlightEnabled }"
          :title="t('diff.toolbar.syntaxHighlight')"
          @click="uiStore.toggleDiffHighlight()"
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
          :class="{ active: uiStore.diffViewMode === 'by-hunk' }"
          :title="t('diff.mode.byHunk')"
          @click="uiStore.setDiffViewMode('by-hunk')"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="2" y="2" width="12" height="5" rx="1" />
            <rect x="2" y="9" width="12" height="5" rx="1" />
          </svg>
        </button>
        <button
          class="btn-icon"
          :class="{ active: uiStore.diffViewMode === 'inline' }"
          :title="t('diff.mode.inline')"
          @click="uiStore.setDiffViewMode('inline')"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
            <line x1="2" y1="4" x2="14" y2="4" />
            <line x1="2" y1="8" x2="14" y2="8" />
            <line x1="2" y1="12" x2="14" y2="12" />
          </svg>
        </button>
        <button
          class="btn-icon"
          :class="{ active: uiStore.diffViewMode === 'side-by-side' }"
          :title="t('diff.mode.sideBySide')"
          @click="uiStore.setDiffViewMode('side-by-side')"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="2" y="2" width="12" height="12" rx="1" />
            <line x1="8" y1="2" x2="8" y2="14" />
          </svg>
        </button>

        <div class="toolbar-divider" />
      </template>

      <!-- SVG 才出现：图片 / 文本 切换 -->
      <template v-if="previewKind === 'svg'">
        <button
          class="btn-icon"
          :class="{ active: !svgTextMode }"
          :title="t('diff.toolbar.imagePreview')"
          @click="svgTextMode = false"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
        </button>
        <button
          class="btn-icon"
          :class="{ active: svgTextMode }"
          :title="t('diff.toolbar.textDiff')"
          @click="svgTextMode = true"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
            <line x1="2" y1="4" x2="14" y2="4" />
            <line x1="2" y1="8" x2="14" y2="8" />
            <line x1="2" y1="12" x2="10" y2="12" />
          </svg>
        </button>
        <div class="toolbar-divider" />
      </template>

      <!-- 关闭 diff 面板 -->
      <button class="btn-icon" :title="t('diff.toolbar.close')" @click="emit('close')">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>

    <!-- Diff body -->
    <div class="diff-body">
      <ImageDiff
        v-if="isImageView && diff && repoId"
        :diff="diff"
        :repo-id="repoId"
        :wip="wip ?? null"
      />
      <SideBySideDiff
        v-else-if="uiStore.diffViewMode === 'side-by-side'"
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
        :group-by-hunk="uiStore.diffViewMode === 'by-hunk'"
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
  padding: 5px 8px 5px 24px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  font-size: var(--font-sm);
  min-height: 28px;
}

.diff-file-path {
  color: var(--text-secondary);
  font-family: var(--code-font-family, 'SF Mono', monospace);
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
