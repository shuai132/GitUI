import { computed, watch, type ComputedRef, type Ref } from 'vue'
import type { useHistoryStore } from '@/stores/history'
import type { CommitInfo } from '@/types/git'

interface UseHistorySelectionOptions {
  historyStore: ReturnType<typeof useHistoryStore>
  filteredCommits: ComputedRef<CommitInfo[]>
  isWipVisible: ComputedRef<boolean>
  showWipRow: ComputedRef<boolean>
  selectedWip: Ref<boolean>
  showDetail: Ref<boolean>
  activePane: Ref<'commits' | 'files'>
}

export function useHistorySelection({
  historyStore,
  filteredCommits,
  isWipVisible,
  showWipRow,
  selectedWip,
  showDetail,
  activePane,
}: UseHistorySelectionOptions) {
  const selectedOid = computed(() => historyStore.selectedCommit?.info.oid ?? null)

  const selectedCommitIndex = computed(() =>
    filteredCommits.value.findIndex((c) => c.oid === selectedOid.value),
  )

  function toVirtualIdx(realIdx: number): number {
    return isWipVisible.value ? realIdx + 1 : realIdx
  }

  function toRealIdx(virtualIdx: number): number {
    if (isWipVisible.value) {
      return virtualIdx === 0 ? -1 : virtualIdx - 1
    }
    return virtualIdx
  }

  const selectedVirtualIndex = computed(() => {
    if (selectedWip.value && isWipVisible.value) return 0
    if (selectedCommitIndex.value >= 0) return toVirtualIdx(selectedCommitIndex.value)
    return -1
  })

  function selectWipRow() {
    if (selectedWip.value) {
      showDetail.value = !showDetail.value
      return
    }
    selectedWip.value = true
    historyStore.selectedCommit = null
    showDetail.value = true
    activePane.value = 'commits'
  }

  function selectRow(virtualIdx: number) {
    if (isWipVisible.value && virtualIdx === 0) {
      if (showWipRow.value) selectWipRow()
      return
    }

    const realIdx = toRealIdx(virtualIdx)
    const commit = filteredCommits.value[realIdx]
    if (!commit) return

    selectedWip.value = false
    if (commit.oid === selectedOid.value) {
      showDetail.value = !showDetail.value
    } else {
      historyStore.selectCommit(commit.oid)
      showDetail.value = true
    }
    activePane.value = 'commits'
  }

  function isSelected(virtualIdx: number): boolean {
    if (isWipVisible.value && virtualIdx === 0) return selectedWip.value
    const realIdx = toRealIdx(virtualIdx)
    return filteredCommits.value[realIdx]?.oid === selectedOid.value
  }

  function onSelectFile(idx: number) {
    historyStore.selectFileDiff(idx)
    activePane.value = 'files'
  }

  watch(showWipRow, (has) => {
    if (!has && selectedWip.value) {
      selectedWip.value = false
      showDetail.value = false
    }
  })

  return {
    selectedOid,
    selectedCommitIndex,
    selectedVirtualIndex,
    toVirtualIdx,
    toRealIdx,
    selectWipRow,
    selectRow,
    isSelected,
    onSelectFile,
  }
}
