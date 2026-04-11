<script setup lang="ts">
import { computed } from 'vue'
import { LANE_W, ROW_H, CIRCLE_R, laneX, type GraphRow } from '@/utils/graph'

const props = defineProps<{
  row: GraphRow
  isSelected?: boolean
}>()

const svgWidth = computed(() => Math.max(props.row.totalColumns, 1) * LANE_W)
const midY = ROW_H / 2

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
    <path
      v-for="(seg, i) in row.segments"
      :key="i"
      :d="segmentPath(seg)"
      :stroke="seg.color"
      stroke-width="1.5"
      fill="none"
      stroke-linecap="round"
    />

    <!-- Commit circle -->
    <circle
      :cx="laneX(row.column)"
      :cy="midY"
      :r="isSelected ? CIRCLE_R + 1 : CIRCLE_R"
      :fill="row.color"
      stroke="var(--bg-secondary)"
      :stroke-width="isSelected ? 2 : 1.5"
    />
  </svg>
</template>

<style scoped>
.commit-graph-row {
  display: block;
  flex-shrink: 0;
}
</style>
