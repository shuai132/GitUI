// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import type { CommitInfo } from '@/types/git'
import { useHistoryScrollAnchor } from './useHistoryScrollAnchor'

const scopes: ReturnType<typeof effectScope>[] = []
afterEach(() => { scopes.splice(0).forEach((scope) => scope.stop()) })

function entry(oid: string): CommitInfo {
  return {
    oid, short_oid: oid, message: oid, summary: oid,
    author_name: 'Author', author_email: 'author@example.com', author_time: 0, time: 0,
    parent_oids: [], is_unreachable: false, is_stash: false, is_reflog_tip: false,
  }
}

function setup() {
  const commits = ref(['a', 'b', 'c', 'd'].map(entry))
  const context = ref('repo-1:all')
  const wip = ref(false)
  const height = ref(20)
  const element = document.createElement('div')
  element.scrollTop = 45
  element.scrollTo = vi.fn((options?: ScrollToOptions | number) => {
    if (options && typeof options !== 'number') element.scrollTop = options.top ?? element.scrollTop
  })
  const scope = effectScope()
  scopes.push(scope)
  scope.run(() => useHistoryScrollAnchor({
    commits: () => commits.value,
    contextKey: () => context.value,
    wipVisible: () => wip.value,
    rowHeight: () => height.value,
    scrollContainer: ref(element),
  }))
  return { commits, context, wip, height, element, scope }
}

describe('history refresh scroll anchor', () => {
  it('keeps the visible commit and its row offset when commits are inserted above it', async () => {
    const { commits, element } = setup()
    commits.value = [entry('new'), ...commits.value]
    await nextTick()
    expect(element.scrollTop).toBe(65)
    expect(element.scrollTo).toHaveBeenCalledOnce()
  })

  it('uses one original anchor for a commit refresh and WIP insertion in the same update', async () => {
    const { commits, wip, element } = setup()
    commits.value = [entry('new'), ...commits.value]
    wip.value = true
    await nextTick()
    expect(element.scrollTop).toBe(85)
    wip.value = false
    await nextTick()
    expect(element.scrollTop).toBe(65)
  })

  it('does not scroll when pages are appended or unchanged references are reused', async () => {
    const { commits, element } = setup()
    commits.value.push(entry('tail'))
    commits.value = commits.value
    await nextTick()
    expect(element.scrollTo).not.toHaveBeenCalled()
  })

  it('does not override scrolling performed before the updated DOM is ready', async () => {
    const { commits, element } = setup()
    commits.value = [entry('new'), ...commits.value]
    element.scrollTop = 10
    await nextTick()
    expect(element.scrollTop).toBe(10)
    expect(element.scrollTo).not.toHaveBeenCalled()
  })

  it.each(['context', 'height', 'scope'] as const)('cancels pending anchors after %s changes', async (change) => {
    const state = setup()
    state.commits.value = [entry('new'), ...state.commits.value]
    if (change === 'context') state.context.value = 'repo-2:search'
    if (change === 'height') state.height.value = 30
    if (change === 'scope') state.scope.stop()
    await nextTick()
    expect(state.element.scrollTo).not.toHaveBeenCalled()
  })

  it('leaves the viewport alone when the anchor disappeared or the user is at the top', async () => {
    const { commits, element } = setup()
    commits.value = [entry('x'), entry('y')]
    await nextTick()
    expect(element.scrollTo).not.toHaveBeenCalled()
    element.scrollTop = 0
    commits.value = [entry('new'), ...commits.value]
    await nextTick()
    expect(element.scrollTo).not.toHaveBeenCalled()
  })
})
