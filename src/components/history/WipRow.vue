<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { LANE_W, ROW_H, CIRCLE_R, laneX } from '@/utils/graph'

const { t } = useI18n()

const props = defineProps<{
  unstagedCount: number
  untrackedCount: number
  stagedCount: number
  branchName: string
  isSelected?: boolean
  graphColWidth: number
  descColWidth: number
}>()

const midY = ROW_H / 2
const circleX = laneX(0)
// 确保 SVG 宽度不小于 graph 列的宽度，让虚线圆和后面的 commit 行对齐
const svgWidth = computed(() => Math.max(LANE_W, props.graphColWidth))
const totalCount = computed(() =>
  props.unstagedCount + props.untrackedCount + props.stagedCount,
)
</script>

<template>
  <!-- Graph 列：虚线圆 -->
  <div class="col-graph" :style="{ width: graphColWidth + 'px' }">
    <svg
      :width="svgWidth"
      :height="ROW_H"
      class="wip-graph"
      :style="{ minWidth: svgWidth + 'px' }"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle
        :cx="circleX"
        :cy="midY"
        :r="isSelected ? CIRCLE_R + 1 : CIRCLE_R"
        fill="none"
        stroke="var(--text-muted)"
        :stroke-width="isSelected ? 2 : 1.5"
        stroke-dasharray="2 2"
      />
    </svg>
  </div>

  <!-- Message 列：// WIP 文本 + 计数徽章 -->
  <div class="col-message" :style="{ width: descColWidth + 'px' }">
    <span class="wip-label">// WIP</span>
    <span v-if="unstagedCount > 0" class="wip-badge" :title="t('history.wipRow.unstagedTitle')">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 20h9"/>
        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
      </svg>
      <span>{{ unstagedCount }}</span>
    </span>
    <span v-if="untrackedCount > 0" class="wip-badge" :title="t('history.wipRow.untrackedTitle')">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="12" y1="5" x2="12" y2="19"/>
        <line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
      <span>{{ untrackedCount }}</span>
    </span>
    <span v-if="stagedCount > 0" class="wip-badge staged" :title="t('history.wipRow.stagedTitle')">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
      <span>{{ stagedCount }}</span>
    </span>
    <span class="wip-hint">{{ t('history.wipRow.pendingHint', { count: totalCount, branch: branchName }) }}</span>
  </div>

  <!-- 占位的 hash / author / date 列（保持和 commit-row 对齐） -->
  <slot name="trailing" />
</template>

<style scoped>
.col-graph {
  flex-shrink: 0;
  overflow: hidden;
  display: flex;
  align-items: center;
}

.wip-graph {
  display: block;
  flex-shrink: 0;
}

.col-message {
  flex-shrink: 0;
  padding: 0 8px;
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
}

.wip-label {
  font-size: var(--font-md);
  font-family: var(--code-font-family, 'SF Mono', monospace);
  color: var(--text-muted);
  font-style: italic;
  flex-shrink: 0;
}

.wip-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: var(--font-sm);
  color: var(--accent-orange);
  background: rgba(245, 169, 127, 0.12);
  border: 1px solid rgba(245, 169, 127, 0.3);
  padding: 0 5px;
  line-height: 16px;
  border-radius: 3px;
  flex-shrink: 0;
  font-weight: 500;
}

.wip-badge.staged {
  color: var(--accent-green);
  background: rgba(166, 218, 149, 0.12);
  border-color: rgba(166, 218, 149, 0.3);
}

.wip-hint {
  font-size: var(--font-sm);
  color: var(--text-muted);
  margin-left: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
