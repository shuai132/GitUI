import { effectScope, ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HISTORY_GRAPH_WIDTH, useUiStore } from '@/stores/ui'
import { useHistoryPanes } from './useHistoryPanes'

function pointer(type: string, clientX: number, button = 0, pointerId = 1): PointerEvent {
  const event = new MouseEvent(type, { clientX, button, bubbles: true, cancelable: true })
  return Object.assign(event, { pointerId }) as PointerEvent
}

describe('history column resizing', () => {
  let scope: ReturnType<typeof effectScope>

  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    scope = effectScope()
  })

  afterEach(() => {
    scope.stop()
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    vi.restoreAllMocks()
  })

  function panes() {
    return scope.run(() => useHistoryPanes(ref(null), ref(false)))!
  }

  it('resizes the graph without changing data columns and persists only when finished', () => {
    const { sizes, startColResize } = panes()
    const ui = useUiStore()
    const persist = vi.spyOn(ui, 'persistHistoryPaneSizes')
    const original = { ...sizes }

    startColResize(pointer('pointerdown', 160), 'graph')
    window.dispatchEvent(pointer('pointermove', 240))

    expect(sizes).toEqual({ ...original, graphColW: original.graphColW + 80 })
    expect(persist).not.toHaveBeenCalled()
    expect(document.body.style.cursor).toBe('col-resize')

    window.dispatchEvent(pointer('pointerup', 240))
    expect(persist).toHaveBeenCalledTimes(1)
    expect(JSON.parse(localStorage.getItem('gitui.history.sizes')!)).toEqual(sizes)
    expect(document.body.style.cursor).toBe('')
    window.dispatchEvent(pointer('pointermove', 400))
    expect(sizes.graphColW).toBe(original.graphColW + 80)
  })

  it('clamps the graph width while still allowing a drag back from either limit', () => {
    const { sizes, startColResize } = panes()
    startColResize(pointer('pointerdown', 160), 'graph')
    window.dispatchEvent(pointer('pointermove', -2000))
    expect(sizes.graphColW).toBe(HISTORY_GRAPH_WIDTH.min)
    window.dispatchEvent(pointer('pointermove', 2000))
    expect(sizes.graphColW).toBe(HISTORY_GRAPH_WIDTH.max)
    window.dispatchEvent(pointer('pointermove', 210))
    expect(sizes.graphColW).toBe(HISTORY_GRAPH_WIDTH.default + 50)
  })

  it.each(['pointercancel', 'blur', 'unmount'])('cleans up on %s and retains the visible width', (end) => {
    const { sizes, startColResize } = panes()
    document.body.style.cursor = 'crosshair'
    document.body.style.userSelect = 'text'
    startColResize(pointer('pointerdown', 160), 'graph')
    window.dispatchEvent(pointer('pointermove', 220))

    if (end === 'unmount') scope.stop()
    else if (end === 'blur') window.dispatchEvent(new Event('blur'))
    else window.dispatchEvent(pointer(end, 220))

    expect(document.body.style.cursor).toBe('crosshair')
    expect(document.body.style.userSelect).toBe('text')
    window.dispatchEvent(pointer('pointermove', 500))
    expect(sizes.graphColW).toBe(220)
    expect(JSON.parse(localStorage.getItem('gitui.history.sizes')!).graphColW).toBe(220)
  })

  it('ignores non-primary buttons and unrelated pointers', () => {
    const { sizes, startColResize } = panes()
    startColResize(pointer('pointerdown', 160, 2), 'graph')
    window.dispatchEvent(pointer('pointermove', 300))
    expect(sizes.graphColW).toBe(HISTORY_GRAPH_WIDTH.default)

    startColResize(pointer('pointerdown', 160), 'graph')
    window.dispatchEvent(pointer('pointermove', 300, 0, 2))
    window.dispatchEvent(pointer('pointerup', 300, 0, 2))
    expect(sizes.graphColW).toBe(HISTORY_GRAPH_WIDTH.default)
    window.dispatchEvent(pointer('pointermove', 220))
    expect(sizes.graphColW).toBe(220)
  })

  it('keeps existing description resizing independent from graph width', () => {
    const { sizes, startColResize } = panes()
    const description = sizes.descColW
    startColResize(pointer('pointerdown', 500), 'desc')
    window.dispatchEvent(pointer('pointermove', 560))
    expect(sizes.descColW).toBe(description + 60)
    expect(sizes.graphColW).toBe(HISTORY_GRAPH_WIDTH.default)
  })
})
