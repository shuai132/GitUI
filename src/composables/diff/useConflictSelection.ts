import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import { conflictRowKey, type AlignRow, type ConflictHunk, type ConflictSide } from '@/lib/conflictMerge'

export function useConflictSelection(
  rows: ComputedRef<AlignRow[]>,
  hunks: ComputedRef<ConflictHunk[]>,
): {
  selectedRows: Ref<Set<string>>
  currentHunkIdx: Ref<number>
  selectedCount: ComputedRef<number>
  totalSelectable: ComputedRef<number>
  toggleRow: (idx: number, side: ConflictSide) => void
  useAllOurs: () => void
  useAllTheirs: () => void
  clearAll: () => void
  isRowSelectable: (idx: number, side: ConflictSide) => boolean
  isRowChecked: (idx: number, side: ConflictSide) => boolean
  hunkSideIdxs: (hunkId: number, side: ConflictSide) => number[]
  hunkAllChecked: (hunkId: number, side: ConflictSide) => boolean
  hunkSomeChecked: (hunkId: number, side: ConflictSide) => boolean
  toggleHunk: (hunkId: number, side: ConflictSide) => void
} {
  const selectedRows = ref<Set<string>>(new Set())
  const currentHunkIdx = ref(0)

  watch(hunks, () => {
    selectedRows.value = new Set()
    currentHunkIdx.value = 0
  })

  function toggleRow(idx: number, side: ConflictSide) {
    const row = rows.value[idx]
    if (!row || row.hunkId === null) return
    if (side === 'a' && row.left === null) return
    if (side === 'b' && row.right === null) return

    const next = new Set(selectedRows.value)
    const key = conflictRowKey(side, idx)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    selectedRows.value = next
    currentHunkIdx.value = row.hunkId
  }

  function useAllOurs() {
    const next = new Set<string>()
    for (const hunk of hunks.value) {
      for (const idx of hunk.leftRowIdx) next.add(conflictRowKey('a', idx))
    }
    selectedRows.value = next
  }

  function useAllTheirs() {
    const next = new Set<string>()
    for (const hunk of hunks.value) {
      for (const idx of hunk.rightRowIdx) next.add(conflictRowKey('b', idx))
    }
    selectedRows.value = next
  }

  function clearAll() {
    selectedRows.value = new Set()
  }

  function isRowSelectable(idx: number, side: ConflictSide): boolean {
    const row = rows.value[idx]
    if (!row || row.hunkId === null) return false
    return side === 'a' ? row.left !== null : row.right !== null
  }

  function isRowChecked(idx: number, side: ConflictSide): boolean {
    if (!isRowSelectable(idx, side)) return false
    return selectedRows.value.has(conflictRowKey(side, idx))
  }

  function hunkSideIdxs(hunkId: number, side: ConflictSide): number[] {
    const hunk = hunks.value[hunkId]
    if (!hunk) return []
    return side === 'a' ? hunk.leftRowIdx : hunk.rightRowIdx
  }

  function hunkAllChecked(hunkId: number, side: ConflictSide): boolean {
    const idxs = hunkSideIdxs(hunkId, side)
    if (idxs.length === 0) return false
    for (const idx of idxs) {
      if (!selectedRows.value.has(conflictRowKey(side, idx))) return false
    }
    return true
  }

  function hunkSomeChecked(hunkId: number, side: ConflictSide): boolean {
    const idxs = hunkSideIdxs(hunkId, side)
    if (idxs.length === 0) return false
    let selected = 0
    for (const idx of idxs) {
      if (selectedRows.value.has(conflictRowKey(side, idx))) selected++
    }
    return selected > 0 && selected < idxs.length
  }

  function toggleHunk(hunkId: number, side: ConflictSide) {
    const idxs = hunkSideIdxs(hunkId, side)
    if (idxs.length === 0) return

    const all = hunkAllChecked(hunkId, side)
    const next = new Set(selectedRows.value)
    for (const idx of idxs) {
      const key = conflictRowKey(side, idx)
      if (all) next.delete(key)
      else next.add(key)
    }
    selectedRows.value = next
    currentHunkIdx.value = hunkId
  }

  const selectedCount = computed(() => selectedRows.value.size)
  const totalSelectable = computed(() => {
    let total = 0
    for (const hunk of hunks.value) total += hunk.leftRowIdx.length + hunk.rightRowIdx.length
    return total
  })

  return {
    selectedRows,
    currentHunkIdx,
    selectedCount,
    totalSelectable,
    toggleRow,
    useAllOurs,
    useAllTheirs,
    clearAll,
    isRowSelectable,
    isRowChecked,
    hunkSideIdxs,
    hunkAllChecked,
    hunkSomeChecked,
    toggleHunk,
  }
}
