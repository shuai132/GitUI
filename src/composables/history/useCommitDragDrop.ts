import { ref } from 'vue'
import { useHistoryStore } from '@/stores/history'
import { mergeSourceNamesAtCommit } from '@/utils/mergeSources'
import type { CommitInfo } from '@/types/git'

const DRAG_THRESHOLD = 4

interface CommitPointerDragState {
  sourceOid: string
  pointerId: number
  startX: number
  startY: number
  isDragging: boolean
}

type ResolveCommitOidAtPoint = (clientX: number, clientY: number) => string | null

function resolveCommitOidAtPoint(clientX: number, clientY: number): string | null {
  const row = document
    .elementFromPoint(clientX, clientY)
    ?.closest<HTMLElement>('[data-commit-oid]')
  return row?.dataset.commitOid ?? null
}

export function useCommitDragDrop(
  openMergeDialog: (candidates: string[]) => void,
  openRebaseDialog: (upstream: string, onto: string | null) => void,
  resolveOidAtPoint: ResolveCommitOidAtPoint = resolveCommitOidAtPoint,
) {
  const historyStore = useHistoryStore()

  const showDragDialog = ref(false)
  const dragSourceOid = ref<string | null>(null)
  const dragTargetOid = ref<string | null>(null)

  // 拖拽过程中的临时状态：源行变淡、目标行高亮，pointerup/cancel 时清零。
  const draggingOid = ref<string | null>(null)
  const dragOverOid = ref<string | null>(null)

  let pointerDrag: CommitPointerDragState | null = null
  let suppressClickUntil = 0
  let previousBodyCursor = ''
  let previousBodyUserSelect = ''

  function restorePointerDragStyles() {
    document.body.style.cursor = previousBodyCursor
    document.body.style.userSelect = previousBodyUserSelect
  }

  function removePointerListeners() {
    window.removeEventListener('pointermove', onCommitPointerMove)
    window.removeEventListener('pointerup', onCommitPointerUp)
    window.removeEventListener('pointercancel', onCommitPointerCancel)
  }

  function updateDragTarget(clientX: number, clientY: number) {
    const targetOid = resolveOidAtPoint(clientX, clientY)
    dragOverOid.value = targetOid && targetOid !== pointerDrag?.sourceOid
      ? targetOid
      : null
  }

  function onCommitPointerDown(e: PointerEvent, commit: CommitInfo | undefined) {
    if (e.button !== 0 || !commit || commit.is_stash) return
    cancelCommitDrag()
    pointerDrag = {
      sourceOid: commit.oid,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      isDragging: false,
    }
    window.addEventListener('pointermove', onCommitPointerMove)
    window.addEventListener('pointerup', onCommitPointerUp)
    window.addEventListener('pointercancel', onCommitPointerCancel)
  }

  function onCommitPointerMove(e: PointerEvent) {
    const state = pointerDrag
    if (!state || e.pointerId !== state.pointerId) return

    if (!state.isDragging) {
      const deltaX = e.clientX - state.startX
      const deltaY = e.clientY - state.startY
      if (Math.hypot(deltaX, deltaY) < DRAG_THRESHOLD) return
      state.isDragging = true
      draggingOid.value = state.sourceOid
      previousBodyCursor = document.body.style.cursor
      previousBodyUserSelect = document.body.style.userSelect
      document.body.style.cursor = 'grabbing'
      document.body.style.userSelect = 'none'
    }

    e.preventDefault()
    updateDragTarget(e.clientX, e.clientY)
  }

  function finishCommitPointerDrag(e: PointerEvent, cancelled: boolean) {
    const state = pointerDrag
    if (!state || e.pointerId !== state.pointerId) return
    removePointerListeners()
    pointerDrag = null

    if (state.isDragging) {
      e.preventDefault()
      suppressClickUntil = Date.now() + 300
      if (!cancelled) {
        // pointerDrag 已清空，因此显式解析落点并与源 oid 比较。
        const targetOid = resolveOidAtPoint(e.clientX, e.clientY)
        if (targetOid && targetOid !== state.sourceOid) {
          dragSourceOid.value = state.sourceOid
          dragTargetOid.value = targetOid
          showDragDialog.value = true
        }
      }
      restorePointerDragStyles()
    }

    draggingOid.value = null
    dragOverOid.value = null
  }

  function onCommitPointerUp(e: PointerEvent) {
    finishCommitPointerDrag(e, false)
  }

  function onCommitPointerCancel(e: PointerEvent) {
    finishCommitPointerDrag(e, true)
  }

  function cancelCommitDrag() {
    removePointerListeners()
    if (pointerDrag?.isDragging) restorePointerDragStyles()
    pointerDrag = null
    draggingOid.value = null
    dragOverOid.value = null
  }

  function shouldSuppressCommitClick(): boolean {
    if (Date.now() >= suppressClickUntil) return false
    suppressClickUntil = 0
    return true
  }

  function onDragDialogMerge() {
    const sourceOid = dragSourceOid.value
    if (!sourceOid) {
      showDragDialog.value = false
      return
    }
    showDragDialog.value = false
    openMergeDialog(mergeSourceNamesAtCommit(historyStore.branches, sourceOid))
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
    onCommitPointerDown,
    shouldSuppressCommitClick,
    cancelCommitDrag,
    onDragDialogMerge,
    onDragDialogRebase,
  }
}
