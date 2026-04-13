<script setup lang="ts">
import { computed } from 'vue'
import { LANE_W, ROW_H, CIRCLE_R, laneX, type GraphRow } from '@/utils/graph'

const props = defineProps<{
  row: GraphRow
  isSelected?: boolean
}>()

const svgWidth = computed(() => Math.max(props.row.totalColumns, 1) * LANE_W)
const midY = ROW_H / 2

const UNREACHABLE_COLOR = 'var(--text-muted)'

/** segment 描边色：unreachable 行整体走灰色 */
function segStroke(segColor: string): string {
  return props.row.isUnreachable ? UNREACHABLE_COLOR : segColor
}

/**
 * commit 圆圈的渲染样式：
 *  - 普通：实心，背景色描边
 *  - stash：空心（背景色填充），分支色描边
 *  - unreachable：空心 + 灰色虚线描边
 *  - 选中且普通：fill 换成 row-selected-fg（在选中蓝底上显眼的白圆点）
 */
const circleAttrs = computed(() => {
  if (props.row.isUnreachable) {
    return {
      fill: 'var(--bg-secondary)',
      stroke: UNREACHABLE_COLOR,
      strokeWidth: props.isSelected ? 2 : 1.5,
      strokeDasharray: '2 2',
    }
  }
  if (props.row.isStash) {
    return {
      fill: 'var(--bg-secondary)',
      stroke: props.row.color,
      strokeWidth: props.isSelected ? 2.5 : 2,
      strokeDasharray: '',
    }
  }
  if (props.isSelected) {
    return {
      fill: 'var(--row-selected-fg)',
      stroke: 'var(--row-selected-bg)',
      strokeWidth: 2,
      strokeDasharray: '',
    }
  }
  return {
    fill: props.row.color,
    stroke: 'var(--bg-secondary)',
    strokeWidth: 1.5,
    strokeDasharray: '',
  }
})

function segmentPath(seg: { fromCol: number; toCol: number; upper: boolean; lower: boolean }): string {
  const x1 = laneX(seg.fromCol)
  const x2 = laneX(seg.toCol)

  if (seg.fromCol === seg.toCol) {
    // Straight vertical line
    const y1 = seg.upper ? 0 : midY
    const y2 = seg.lower ? ROW_H : midY
    return `M ${x1},${y1} L ${x2},${y2}`
  }

  // Diagonal / merge — bezier curve
  if (seg.upper && !seg.lower) {
    // Upper half: coming from x1 at top, converging to x2 at midY
    return `M ${x1},0 C ${x1},${midY} ${x2},${midY} ${x2},${midY}`
  }
  if (!seg.upper && seg.lower) {
    // Lower half: diverging from x1 at midY, heading to x2 at bottom
    return `M ${x1},${midY} C ${x1},${midY} ${x2},${ROW_H} ${x2},${ROW_H}`
  }
  // Both halves (shouldn't normally happen with diagonal, but handle gracefully)
  return `M ${x1},0 C ${x1},${midY} ${x2},${midY} ${x2},${ROW_H}`
}
</script>

<template>
  <svg
    :width="svgWidth"
    :height="ROW_H"
    class="commit-graph-row"
    :style="{ minWidth: svgWidth + 'px' }"
    xmlns="http://www.w3.org/2000/svg"
  >
    <!-- Pass-through and connection lines (drawn below the circle) -->
    <!-- fill/stroke 通过 style 绑定，让 CSS var() 在主题切换时实时生效 -->
    <path
      v-for="(seg, i) in row.segments"
      :key="i"
      :d="segmentPath(seg)"
      :style="{ stroke: segStroke(seg.color), fill: 'none' }"
      stroke-width="1.5"
      stroke-linecap="round"
    />

    <!-- Commit circle -->
    <circle
      :cx="laneX(row.column)"
      :cy="midY"
      :r="isSelected ? CIRCLE_R - 1 : CIRCLE_R"
      :style="{ fill: circleAttrs.fill, stroke: circleAttrs.stroke }"
      :stroke-width="circleAttrs.strokeWidth"
      :stroke-dasharray="circleAttrs.strokeDasharray"
    />
  </svg>
</template>

<style scoped>
.commit-graph-row {
  display: block;
  flex-shrink: 0;
}
</style>
