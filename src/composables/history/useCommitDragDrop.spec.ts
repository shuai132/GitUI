import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useCommitDragDrop } from './useCommitDragDrop'
import type { CommitInfo } from '@/types/git'

vi.mock('@/composables/useGitCommands', () => ({
  useGitCommands: () => ({}),
}))

function commit(oid: string, isStash = false): CommitInfo {
  return {
    oid,
    short_oid: oid,
    message: oid,
    summary: oid,
    author_name: 'Test',
    author_email: 'test@example.com',
    author_time: 1,
    time: 1,
    parent_oids: [],
    is_unreachable: false,
    is_stash: isStash,
    is_reflog_tip: false,
  }
}

function pointerEvent(type: string, x: number, y: number): PointerEvent {
  return new MouseEvent(type, {
    bubbles: true,
    button: 0,
    clientX: x,
    clientY: y,
  }) as PointerEvent
}

describe('useCommitDragDrop pointer interaction', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  })

  it('opens the action dialog after dragging a commit onto another commit', () => {
    const resolveTarget = vi.fn(() => 'target')
    const drag = useCommitDragDrop(vi.fn(), vi.fn(), resolveTarget)

    drag.onCommitPointerDown(pointerEvent('pointerdown', 10, 10), commit('source'))
    window.dispatchEvent(pointerEvent('pointermove', 20, 10))

    expect(drag.draggingOid.value).toBe('source')
    expect(drag.dragOverOid.value).toBe('target')
    expect(document.body.style.cursor).toBe('grabbing')

    window.dispatchEvent(pointerEvent('pointerup', 20, 10))

    expect(drag.showDragDialog.value).toBe(true)
    expect(drag.dragSourceOid.value).toBe('source')
    expect(drag.dragTargetOid.value).toBe('target')
    expect(drag.draggingOid.value).toBeNull()
    expect(drag.dragOverOid.value).toBeNull()
    expect(drag.shouldSuppressCommitClick()).toBe(true)
    expect(document.body.style.cursor).toBe('')
  })

  it('keeps a short pointer movement as a normal click', () => {
    const drag = useCommitDragDrop(vi.fn(), vi.fn(), () => 'target')

    drag.onCommitPointerDown(pointerEvent('pointerdown', 10, 10), commit('source'))
    window.dispatchEvent(pointerEvent('pointermove', 12, 11))
    window.dispatchEvent(pointerEvent('pointerup', 12, 11))

    expect(drag.showDragDialog.value).toBe(false)
    expect(drag.shouldSuppressCommitClick()).toBe(false)
  })

  it('does not start dragging stash rows', () => {
    const resolveTarget = vi.fn(() => 'target')
    const drag = useCommitDragDrop(vi.fn(), vi.fn(), resolveTarget)

    drag.onCommitPointerDown(pointerEvent('pointerdown', 10, 10), commit('stash', true))
    window.dispatchEvent(pointerEvent('pointermove', 20, 10))
    window.dispatchEvent(pointerEvent('pointerup', 20, 10))

    expect(resolveTarget).not.toHaveBeenCalled()
    expect(drag.showDragDialog.value).toBe(false)
  })
})
