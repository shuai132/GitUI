<script setup lang="ts">
import { computed } from 'vue'
import { LANE_W, CIRCLE_R, laneX, type GraphRow, type GraphSegment } from '@/utils/graph'
import { useSettingsStore } from '@/stores/settings'

const props = defineProps<{
  row: GraphRow
  isSelected?: boolean
}>()

const settings = useSettingsStore()

const svgWidth = computed(() => Math.max(props.row.totalColumns, 1) * LANE_W)
// 行高 / 垂直中点随设置响应式变化（SVG path d 属性无法用 CSS 变量）
const rowH = computed(() => settings.historyRowHeight)
const midY = computed(() => rowH.value / 2)

const UNREACHABLE_COLOR = 'var(--text-muted)'

/**
 * segment 描边色：
 * unreachable 行里，只有连接到该 commit 自身列（row.column）的 segment 走灰色；
 * 纯粹"路过"的 lane 保留原色，避免主干颜色在 unreachable 行被错误冲刷。
 */
function segStroke(seg: GraphSegment): string {
  if (
    props.row.isUnreachable &&
    (seg.fromCol === props.row.column || seg.toCol === props.row.column)
  ) {
    return UNREACHABLE_COLOR
  }
  return seg.color
}

/**
 * commit 圆圈的渲染样式：
 *  - 普通：实心，背景色描边
 *  - stash / unreachable：空心 + 灰色虚线描边（相同样式）
 *  - 选中且普通：fill 换成 row-selected-fg（在选中蓝底上显眼的白圆点）
 */
const circleAttrs = computed(() => {
  if (props.row.isUnreachable || props.row.isStash) {
    return {
      fill: 'var(--bg-secondary)',
      stroke: UNREACHABLE_COLOR,
      strokeWidth: props.isSelected ? 2 : 1.5,
      strokeDasharray: '2 2',
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

/**
 * 生成 segment 的 SVG path。
 * 两种风格由 settings.graphStyle 切换：
 *  - rounded（默认）：斜向走 S 形 Bezier，两端切线竖直，视觉平滑
 *  - angular：控制点退化成"L 折线"的旧实现，尖锐
 * 同列直线两风格共用 M…L。
 */
function segmentPath(seg: { fromCol: number; toCol: number; upper: boolean; lower: boolean }): string {
  const H = rowH.value
  const mid = midY.value
  const x1 = laneX(seg.fromCol)
  const x2 = laneX(seg.toCol)

  if (seg.fromCol === seg.toCol) {
    const y1 = seg.upper ? 0 : mid
    const y2 = seg.lower ? H : mid
    return `M ${x1},${y1} L ${x2},${y2}`
  }

  if (settings.graphStyle === 'angular') {
    // 控制点退化（C1=P0、C2=P3）→ 实质是直线，视觉呈折线 / 锐角
    if (seg.upper && !seg.lower) {
      return `M ${x1},0 C ${x1},${mid} ${x2},${mid} ${x2},${mid}`
    }
    if (!seg.upper && seg.lower) {
      return `M ${x1},${mid} C ${x1},${mid} ${x2},${H} ${x2},${H}`
    }
    return `M ${x1},0 C ${x1},${mid} ${x2},${mid} ${x2},${H}`
  }

  if (settings.graphStyle === 'step') {
    // orthogonal / 直角布线：竖直 → 圆角 → 水平 → 圆角 → 竖直。
    // 横段贴本行半段的最下沿（y = y_end - r），即"贴着父/目标节点上方横着走"。
    // 圆角用 quadratic Bezier（控制点放在折角顶点），视觉上等价于 1/4 圆弧，避免 sweep-flag 方向分支。
    const STEP_R = 4
    const sign = x2 > x1 ? 1 : -1
    let yStart: number, yEnd: number
    if (seg.upper && !seg.lower) {
      yStart = 0
      yEnd = mid
    } else if (!seg.upper && seg.lower) {
      yStart = mid
      yEnd = H
    } else {
      yStart = 0
      yEnd = H
    }
    const y1 = yEnd - 2 * STEP_R  // 第一个圆角起点
    const y2 = yEnd - STEP_R       // 水平段 y / 两个圆角的顶点高度
    const xa = x1 + sign * STEP_R  // 第一个圆角的水平出口
    const xb = x2 - sign * STEP_R  // 第二个圆角的水平入口
    return `M ${x1},${yStart} V ${y1} Q ${x1},${y2} ${xa},${y2} H ${xb} Q ${x2},${y2} ${x2},${yEnd}`
  }

  // rounded：控制点拉到对角，两端紧贴各自 lane 的竖直段更长，中段近似水平。
  // 视觉上是「沿父 lane 竖直走 → 水平横移 → 沿子 lane 竖直走」的圆润 Z。
  if (seg.upper && !seg.lower) {
    return `M ${x1},0 C ${x1},${mid} ${x2},0 ${x2},${mid}`
  }
  if (!seg.upper && seg.lower) {
    return `M ${x1},${mid} C ${x1},${H} ${x2},${mid} ${x2},${H}`
  }
  return `M ${x1},0 C ${x1},${H} ${x2},0 ${x2},${H}`
}
</script>

<template>
  <svg
    :width="svgWidth"
    :height="rowH"
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
      :style="{ stroke: segStroke(seg), fill: 'none' }"
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
