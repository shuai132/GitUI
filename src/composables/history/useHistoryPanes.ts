import { computed, type Ref } from 'vue'
import { useUiStore, type PanelId } from '@/stores/ui'

export function useHistoryPanes(contentAreaRef: Ref<HTMLElement | null>, showDetail: Ref<boolean>) {
  const uiStore = useUiStore()
  const sizes = uiStore.historyPaneSizes

  function pairRows(first: PanelId, second: PanelId) {
    if (first === 'diff') return `${sizes.diffRowPct}% 1fr`
    if (second === 'diff') return `${100 - sizes.diffRowPct}% ${sizes.diffRowPct}%`
    return `${sizes.diffRowPct}% ${100 - sizes.diffRowPct}%`
  }

  function pairCols(first: PanelId, second: PanelId) {
    if (first === 'info') return `${sizes.infoPanePct}% 1fr`
    if (second === 'info') return `${100 - sizes.infoPanePct}% ${sizes.infoPanePct}%`
    return `${sizes.infoPanePct}% ${100 - sizes.infoPanePct}%`
  }

  // ── Content area grid style ──────────────────────────────────────────
  const contentGridStyle = computed(() => {
    if (!showDetail.value) {
      return {
        gridTemplateColumns: '1fr',
        gridTemplateRows: '1fr',
        gridTemplateAreas: '"commits"',
      }
    }
    const { spanning, edge, first, second } = uiStore.dockLayout
    const isH = edge === 'left' || edge === 'right'
    const mainPct = isH ? sizes.commitPanePct : sizes.commitRowPct

    let areas: string, rows: string, cols: string
    switch (edge) {
      case 'top':
        areas = `"${spanning} ${spanning}" "${first} ${second}"`
        rows = `${mainPct}% ${100 - mainPct}%`
        cols = pairCols(first, second)
        break
      case 'bottom':
        areas = `"${first} ${second}" "${spanning} ${spanning}"`
        rows = `${100 - mainPct}% ${mainPct}%`
        cols = pairCols(first, second)
        break
      case 'left':
        areas = `"${spanning} ${first}" "${spanning} ${second}"`
        cols = `${mainPct}% 1fr`
        rows = pairRows(first, second)
        break
      case 'right':
        areas = `"${first} ${spanning}" "${second} ${spanning}"`
        cols = `${100 - mainPct}% ${mainPct}%`
        rows = pairRows(first, second)
        break
    }
    return { gridTemplateAreas: areas, gridTemplateRows: rows, gridTemplateColumns: cols }
  })

  // ── Main resize：spanning 面板与 pair 区之间的分割 ──────────────────
  function startMainResize(e: PointerEvent) {
    e.preventDefault()
    const container = contentAreaRef.value
    if (!container) return
    const rect = container.getBoundingClientRect()
    const edge = uiStore.dockLayout.edge
    const isH = edge === 'left' || edge === 'right'
    const cursor = isH ? 'col-resize' : 'row-resize'

    const onMove = (ev: PointerEvent) => {
      let pct: number
      if (isH) {
        pct = ((ev.clientX - rect.left) / rect.width) * 100
        if (edge === 'right') pct = 100 - pct
        sizes.commitPanePct = Math.max(20, Math.min(80, pct))
      } else {
        pct = ((ev.clientY - rect.top) / rect.height) * 100
        if (edge === 'bottom') pct = 100 - pct
        sizes.commitRowPct = Math.max(20, Math.min(85, pct))
      }
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      uiStore.persistHistoryPaneSizes()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    document.body.style.cursor = cursor
    document.body.style.userSelect = 'none'
  }

  // ── Secondary resize：pair 区内两个面板之间的分割 ──────────────────────
  function startSecondaryResize(e: PointerEvent) {
    e.preventDefault()
    const container = contentAreaRef.value
    if (!container) return
    const rect = container.getBoundingClientRect()
    const edge = uiStore.dockLayout.edge
    const isH = edge === 'left' || edge === 'right'
    const cursor = isH ? 'row-resize' : 'col-resize'

    const onMove = (ev: PointerEvent) => {
      const { first, second } = uiStore.dockLayout
      if (isH) {
        const pct = ((ev.clientY - rect.top) / rect.height) * 100
        const diffPct = first === 'diff' ? pct : second === 'diff' ? 100 - pct : pct
        sizes.diffRowPct = Math.max(20, Math.min(85, diffPct))
      } else {
        const pct = ((ev.clientX - rect.left) / rect.width) * 100
        const infoPct = first === 'info' ? pct : second === 'info' ? 100 - pct : pct
        sizes.infoPanePct = Math.max(20, Math.min(80, infoPct))
      }
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      uiStore.persistHistoryPaneSizes()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    document.body.style.cursor = cursor
    document.body.style.userSelect = 'none'
  }

  // ── Column resize (change stats / hash / author / date) ──────────────
  type ColKey = 'desc' | 'stats' | 'hash' | 'author' | 'date'
  const COL_LIMITS: Record<ColKey, [number, number]> = {
    desc: [200, 1200],
    stats: [90, 260],
    hash: [48, 240],
    author: [60, 420],
    date: [60, 300],
  }
  const COL_KEY_MAP: Record<ColKey, 'descColW' | 'statsColW' | 'hashColW' | 'authorColW' | 'dateColW'> = {
    desc: 'descColW',
    stats: 'statsColW',
    hash: 'hashColW',
    author: 'authorColW',
    date: 'dateColW',
  }
  
  function startColResize(e: PointerEvent, col: ColKey) {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const sizeKey = COL_KEY_MAP[col]
    const startW = sizes[sizeKey]
    const [min, max] = COL_LIMITS[col]
    const onMove = (ev: PointerEvent) => {
      const delta = ev.clientX - startX
      sizes[sizeKey] = Math.max(min, Math.min(max, startW + delta))
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      uiStore.persistHistoryPaneSizes()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  // ── Resize handle 位置 computed ──────────────────────────────────────
  const mainResizeStyle = computed(() => {
    const { edge } = uiStore.dockLayout
    const isH = edge === 'left' || edge === 'right'
    if (isH) {
      const pos = edge === 'left' ? `${sizes.commitPanePct}%` : `${100 - sizes.commitPanePct}%`
      return { left: pos, top: '0', bottom: '0', width: '6px', height: 'auto', transform: 'translateX(-3px)', cursor: 'col-resize' }
    }
    const pos = edge === 'top' ? `${sizes.commitRowPct}%` : `${100 - sizes.commitRowPct}%`
    return { top: pos, left: '0', right: '0', height: '6px', width: 'auto', transform: 'translateY(-3px)', cursor: 'row-resize' }
  })

  const secondaryResizeStyle = computed(() => {
    const { edge, first, second } = uiStore.dockLayout
    const isH = edge === 'left' || edge === 'right'
    if (isH) {
      const spanPct = sizes.commitPanePct
      const topPct = first === 'diff'
        ? sizes.diffRowPct
        : second === 'diff'
          ? 100 - sizes.diffRowPct
          : sizes.diffRowPct
      return {
        top: `${topPct}%`,
        left: edge === 'left' ? `${spanPct}%` : '0',
        right: edge === 'right' ? `${spanPct}%` : '0',
        height: '6px', width: 'auto', transform: 'translateY(-3px)', cursor: 'row-resize',
      }
    }
    const spanPct = sizes.commitRowPct
    const leftPct = first === 'info'
      ? sizes.infoPanePct
      : second === 'info'
        ? 100 - sizes.infoPanePct
        : sizes.infoPanePct
    return {
      left: `${leftPct}%`,
      top: edge === 'top' ? `${spanPct}%` : '0',
      bottom: edge === 'bottom' ? `${spanPct}%` : '0',
      width: '6px', height: 'auto', transform: 'translateX(-3px)', cursor: 'col-resize',
    }
  })

  const panelBorders = computed(() => {
    const { edge, spanning, first } = uiStore.dockLayout
    const borderSide: Record<string, string> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }
    const pairBorderSide = (edge === 'top' || edge === 'bottom') ? 'right' : 'bottom'
    const border = '1px solid var(--border)'
    return {
      [spanning]: { [`border-${borderSide[edge]}`]: border } as Record<string, string>,
      [first]: { [`border-${pairBorderSide}`]: border } as Record<string, string>,
    }
  })

  return {
    sizes,
    contentGridStyle,
    mainResizeStyle,
    secondaryResizeStyle,
    panelBorders,
    startMainResize,
    startSecondaryResize,
    startColResize,
  }
}
