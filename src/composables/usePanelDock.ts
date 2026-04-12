import { ref, type Ref } from 'vue'
import type { PanelId, DockEdge, DockLayout } from '@/stores/ui'

const EDGE_ZONE_PX = 60
const MIN_DRAG_PX = 5

interface UsePanelDockOptions {
  containerRef: Ref<HTMLElement | null>
  currentLayout: Ref<DockLayout>
  onLayoutChange: (layout: DockLayout) => void
}

export function usePanelDock(options: UsePanelDockOptions) {
  const { containerRef, currentLayout, onLayoutChange } = options

  const isDragging = ref(false)
  const draggedPanel = ref<PanelId | null>(null)
  const hoveredEdge = ref<DockEdge | null>(null)
  const hoveredSwapTarget = ref<PanelId | null>(null)

  function onDragHandlePointerDown(panelId: PanelId, e: PointerEvent) {
    e.preventDefault()
    e.stopPropagation()

    const startX = e.clientX
    const startY = e.clientY
    let activated = false

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      if (!activated) {
        if (Math.sqrt(dx * dx + dy * dy) < MIN_DRAG_PX) return
        activated = true
        isDragging.value = true
        draggedPanel.value = panelId
        document.body.style.cursor = 'grabbing'
        document.body.style.userSelect = 'none'
      }

      // 检测 edge zone
      const container = containerRef.value
      if (!container) return

      const rect = container.getBoundingClientRect()
      const cx = ev.clientX - rect.left
      const cy = ev.clientY - rect.top

      // 计算到各边的距离
      const distTop = cy
      const distBottom = rect.height - cy
      const distLeft = cx
      const distRight = rect.width - cx

      const minDist = Math.min(distTop, distBottom, distLeft, distRight)

      if (minDist < EDGE_ZONE_PX) {
        hoveredSwapTarget.value = null
        if (minDist === distTop) hoveredEdge.value = 'top'
        else if (minDist === distBottom) hoveredEdge.value = 'bottom'
        else if (minDist === distLeft) hoveredEdge.value = 'left'
        else hoveredEdge.value = 'right'
      } else {
        hoveredEdge.value = null
        // 检测是否在另一个面板上（swap）
        const target = detectSwapTarget(ev.clientX, ev.clientY, panelId)
        hoveredSwapTarget.value = target
      }
    }

    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''

      if (activated) {
        applyDrop(panelId)
      }

      isDragging.value = false
      draggedPanel.value = null
      hoveredEdge.value = null
      hoveredSwapTarget.value = null
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  function detectSwapTarget(clientX: number, clientY: number, dragging: PanelId): PanelId | null {
    const panels = document.querySelectorAll<HTMLElement>('[data-panel-id]')
    for (const el of panels) {
      const id = el.dataset.panelId as PanelId
      if (id === dragging) continue
      const rect = el.getBoundingClientRect()
      if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
        return id
      }
    }
    return null
  }

  function applyDrop(panelId: PanelId) {
    const layout = currentLayout.value

    if (hoveredEdge.value) {
      // 面板拖到边缘 → 成为 spanning
      const edge = hoveredEdge.value
      const remaining = (['commits', 'info', 'diff'] as PanelId[]).filter(p => p !== panelId)

      // 保持剩余两个面板的相对顺序
      // 根据当前布局中它们的角色决定顺序
      let first: PanelId, second: PanelId
      if (layout.spanning === panelId) {
        // 被拖的面板本来就是 spanning，只是换了 edge
        first = layout.first
        second = layout.second
      } else {
        // 被拖的面板不是 spanning → spanning 和另一个 pair 成员组成新 pair
        // 保留当前的视觉顺序
        const oldFirst = layout.first
        const oldSecond = layout.second
        if (remaining.includes(oldFirst) && remaining.includes(oldSecond)) {
          first = oldFirst
          second = oldSecond
        } else {
          first = remaining[0]
          second = remaining[1]
        }
      }

      const newLayout: DockLayout = { spanning: panelId, edge, first, second }
      if (JSON.stringify(newLayout) !== JSON.stringify(layout)) {
        onLayoutChange(newLayout)
      }
    } else if (hoveredSwapTarget.value) {
      // 面板拖到另一个面板上 → 交换位置
      const target = hoveredSwapTarget.value
      const newLayout = { ...layout }

      // 找到两个面板在 layout 中的角色并交换
      const roles: (keyof DockLayout)[] = ['spanning', 'first', 'second']
      const roleOfDragged = roles.find(r => newLayout[r] === panelId)!
      const roleOfTarget = roles.find(r => newLayout[r] === target)!

      ;(newLayout[roleOfDragged] as PanelId) = target
      ;(newLayout[roleOfTarget] as PanelId) = panelId

      onLayoutChange(newLayout)
    }
  }

  return {
    isDragging,
    draggedPanel,
    hoveredEdge,
    hoveredSwapTarget,
    onDragHandlePointerDown,
  }
}
