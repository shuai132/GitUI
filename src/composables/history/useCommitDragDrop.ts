import { ref, type Ref } from 'vue'
import { useHistoryStore } from '@/stores/history'
import type { CommitInfo } from '@/types/git'

export function useCommitDragDrop(
  openMergeDialog: (candidates: string[]) => void,
  openRebaseDialog: (upstream: string, onto: string | null) => void,
) {
  const historyStore = useHistoryStore()

  const showDragDialog = ref(false)
  const dragSourceOid = ref<string | null>(null)
  const dragTargetOid = ref<string | null>(null)

  // 拖拽过程中的临时状态：源行变淡、目标行高亮，drop/dragend 时清零
  const draggingOid = ref<string | null>(null)
  const dragOverOid = ref<string | null>(null)

  function onCommitDragStart(e: DragEvent, commit: CommitInfo | undefined) {
    if (!commit || commit.is_stash) return
    e.dataTransfer?.setData('text/plain', `gitui:commit:${commit.oid}`)
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
    draggingOid.value = commit.oid
  }

  function onCommitDragOver(e: DragEvent, commit: CommitInfo | undefined) {
    const payload = e.dataTransfer?.types.includes('text/plain')
    if (!payload || !commit) return
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
    if (commit.oid !== draggingOid.value && dragOverOid.value !== commit.oid) {
      dragOverOid.value = commit.oid
    }
  }

  function onCommitDrop(e: DragEvent, commit: CommitInfo | undefined) {
    if (!commit) return
    const raw = e.dataTransfer?.getData('text/plain') ?? ''
    if (!raw.startsWith('gitui:commit:')) return
    const sourceOid = raw.slice('gitui:commit:'.length)
    if (sourceOid === commit.oid) return
    e.preventDefault()
    dragSourceOid.value = sourceOid
    dragTargetOid.value = commit.oid
    showDragDialog.value = true
    draggingOid.value = null
    dragOverOid.value = null
  }

  function onCommitDragEnd() {
    draggingOid.value = null
    dragOverOid.value = null
  }

  function onDragDialogMerge() {
    const sourceOid = dragSourceOid.value
    if (!sourceOid) {
      showDragDialog.value = false
      return
    }
    const candidates = historyStore.branches
      .filter(b => !b.is_remote && b.commit_oid === sourceOid && !b.is_head)
      .map(b => b.name)
    showDragDialog.value = false
    openMergeDialog(candidates)
  }

  function onDragDialogRebase() {
    const targetOid = dragTargetOid.value
    if (!targetOid) {
      showDragDialog.value = false
      return
    }
    showDragDialog.value = false
    openRebaseDialog(targetOid, null)
  }

  return {
    showDragDialog,
    dragSourceOid,
    dragTargetOid,
    draggingOid,
    dragOverOid,
    onCommitDragStart,
    onCommitDragOver,
    onCommitDrop,
    onCommitDragEnd,
    onDragDialogMerge,
    onDragDialogRebase,
  }
}
