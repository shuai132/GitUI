import type { ComputedRef, Ref } from 'vue'
import type { useHistoryStore } from '@/stores/history'

type ActivePane = 'commits' | 'files'

interface HistoryVirtualizerRef {
  value: {
    scrollToIndex: (index: number, options?: { align?: 'auto' | 'center' | 'start' | 'end' }) => void
  }
}

interface UseHistoryKeyboardOptions {
  activeRepoId: Ref<string | null>
  historyStore: ReturnType<typeof useHistoryStore>
  activePane: Ref<ActivePane>
  virtualRowCount: ComputedRef<number>
  selectedVirtualIndex: ComputedRef<number>
  virtualizer: HistoryVirtualizerRef
  orderedFileIndices?: ComputedRef<number[]>
  selectRow: (virtualIdx: number) => void
  onSelectFile: (idx: number) => void
}

export function useHistoryKeyboard({
  activeRepoId,
  historyStore,
  activePane,
  virtualRowCount,
  selectedVirtualIndex,
  virtualizer,
  orderedFileIndices,
  selectRow,
  onSelectFile,
}: UseHistoryKeyboardOptions) {
  function moveCommitSelection(delta: number) {
    const total = virtualRowCount.value
    if (total === 0) return
    const cur = selectedVirtualIndex.value
    const next = cur < 0 ? 0 : Math.max(0, Math.min(total - 1, cur + delta))
    if (next === cur) return
    selectRow(next)
    virtualizer.value.scrollToIndex(next, { align: 'auto' })
  }

  function moveFileSelection(delta: number) {
    const diffs = historyStore.selectedCommit?.diffs
    if (!diffs || diffs.length === 0) return
    const order = orderedFileIndices?.value.length === diffs.length
      ? orderedFileIndices.value
      : diffs.map((_, index) => index)
    const cur = historyStore.selectedFileDiffIndex
    const visualIdx = order.indexOf(cur)
    const currentVisualIdx = visualIdx >= 0 ? visualIdx : 0
    const nextVisualIdx = Math.max(0, Math.min(order.length - 1, currentVisualIdx + delta))
    const next = order[nextVisualIdx]
    if (next !== cur) onSelectFile(next)
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return

    const target = e.target as HTMLElement | null
    if (target) {
      const tag = target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return
    }

    if (!activeRepoId.value) return

    const delta = e.key === 'ArrowDown' ? 1 : -1
    if (activePane.value === 'commits') {
      moveCommitSelection(delta)
    } else {
      moveFileSelection(delta)
    }
    e.preventDefault()
  }

  return {
    activePane,
    moveCommitSelection,
    moveFileSelection,
    onKeyDown,
  }
}
