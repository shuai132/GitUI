import { computed, nextTick, ref, type ComputedRef, type Ref } from 'vue'
import { useVirtualizer, type Virtualizer } from '@tanstack/vue-virtual'
import type { AlignRow, ConflictHunk } from '@/lib/conflictMerge'

const ROW_H = 20

export function useSyncedConflictPanes(options: {
  rows: ComputedRef<AlignRow[]>
  outputLines: ComputedRef<string[]>
  hunks: ComputedRef<ConflictHunk[]>
  conflictCount: ComputedRef<number>
  rowIdxToOutputLine: ComputedRef<number[]>
  outputLineToRowIdx: ComputedRef<number[]>
  currentHunkIdx: Ref<number>
}): {
  paneARowsRef: Ref<HTMLElement | null>
  paneBRowsRef: Ref<HTMLElement | null>
  paneOutputRowsRef: Ref<HTMLElement | null>
  virtualizerA: Ref<Virtualizer<HTMLElement, Element>>
  virtualizerB: Ref<Virtualizer<HTMLElement, Element>>
  virtualizerO: Ref<Virtualizer<HTMLElement, Element>>
  maxChars: ComputedRef<number>
  maxOutputChars: ComputedRef<number>
  onPaneAScroll: () => void
  onPaneBScroll: () => void
  onOutputScroll: () => void
  scrollToHunk: (idx: number) => void
  goPrevHunk: () => void
  goNextHunk: () => void
} {
  const paneARowsRef = ref<HTMLElement | null>(null)
  const paneBRowsRef = ref<HTMLElement | null>(null)
  const paneOutputRowsRef = ref<HTMLElement | null>(null)

  const maxChars = computed(() => {
    let max = 0
    for (const row of options.rows.value) {
      const leftLength = row.left?.length ?? 0
      const rightLength = row.right?.length ?? 0
      if (leftLength > max) max = leftLength
      if (rightLength > max) max = rightLength
    }
    return Math.min(max, 300)
  })

  const maxOutputChars = computed(() => {
    let max = 0
    for (const line of options.outputLines.value) {
      if (line.length > max) max = line.length
    }
    return Math.min(max, 300)
  })

  const virtualizerA = useVirtualizer(
    computed(() => ({
      count: options.rows.value.length,
      getScrollElement: () => paneARowsRef.value,
      estimateSize: () => ROW_H,
      overscan: 10,
    })),
  )

  const virtualizerB = useVirtualizer(
    computed(() => ({
      count: options.rows.value.length,
      getScrollElement: () => paneBRowsRef.value,
      estimateSize: () => ROW_H,
      overscan: 10,
    })),
  )

  const virtualizerO = useVirtualizer(
    computed(() => ({
      count: options.outputLines.value.length,
      getScrollElement: () => paneOutputRowsRef.value,
      estimateSize: () => ROW_H,
      overscan: 10,
    })),
  )

  let scrollLock: 'a' | 'b' | 'o' | null = null

  function onPaneAScroll() {
    if (scrollLock && scrollLock !== 'a') return
    scrollLock = 'a'
    syncFromRow(paneARowsRef.value?.scrollTop ?? 0)
    requestAnimationFrame(() => (scrollLock = null))
  }

  function onPaneBScroll() {
    if (scrollLock && scrollLock !== 'b') return
    scrollLock = 'b'
    syncFromRow(paneBRowsRef.value?.scrollTop ?? 0)
    requestAnimationFrame(() => (scrollLock = null))
  }

  function onOutputScroll() {
    if (scrollLock && scrollLock !== 'o') return
    scrollLock = 'o'
    const el = paneOutputRowsRef.value
    if (!el) {
      requestAnimationFrame(() => (scrollLock = null))
      return
    }
    const topLine = Math.floor(el.scrollTop / ROW_H) + 1
    const rowIdx = options.outputLineToRowIdx.value[topLine] ?? 0
    const rowTop = rowIdx * ROW_H
    if (paneARowsRef.value) paneARowsRef.value.scrollTop = rowTop
    if (paneBRowsRef.value) paneBRowsRef.value.scrollTop = rowTop
    requestAnimationFrame(() => (scrollLock = null))
  }

  function syncFromRow(rowScrollTop: number) {
    if (paneARowsRef.value && paneARowsRef.value.scrollTop !== rowScrollTop) {
      paneARowsRef.value.scrollTop = rowScrollTop
    }
    if (paneBRowsRef.value && paneBRowsRef.value.scrollTop !== rowScrollTop) {
      paneBRowsRef.value.scrollTop = rowScrollTop
    }
    const topRow = Math.floor(rowScrollTop / ROW_H)
    const outLine = options.rowIdxToOutputLine.value[topRow] ?? 1
    const el = paneOutputRowsRef.value
    if (el) {
      const target = (outLine - 1) * ROW_H
      if (Math.abs(el.scrollTop - target) > 1) el.scrollTop = target
    }
  }

  function scrollToHunk(idx: number) {
    if (idx < 0 || idx >= options.hunks.value.length) return
    options.currentHunkIdx.value = idx
    const hunk = options.hunks.value[idx]
    nextTick(() => {
      virtualizerA.value.scrollToIndex(hunk.headerIdx, { align: 'center' })
      const startLine = options.rowIdxToOutputLine.value[hunk.startIdx] ?? 1
      virtualizerO.value.scrollToIndex(Math.max(0, startLine - 1), { align: 'center' })
    })
  }

  function goPrevHunk() {
    if (options.conflictCount.value === 0) return
    scrollToHunk((options.currentHunkIdx.value - 1 + options.conflictCount.value) % options.conflictCount.value)
  }

  function goNextHunk() {
    if (options.conflictCount.value === 0) return
    scrollToHunk((options.currentHunkIdx.value + 1) % options.conflictCount.value)
  }

  return {
    paneARowsRef,
    paneBRowsRef,
    paneOutputRowsRef,
    virtualizerA,
    virtualizerB,
    virtualizerO,
    maxChars,
    maxOutputChars,
    onPaneAScroll,
    onPaneBScroll,
    onOutputScroll,
    scrollToHunk,
    goPrevHunk,
    goNextHunk,
  }
}
