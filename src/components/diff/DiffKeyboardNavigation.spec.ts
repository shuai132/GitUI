// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '@/i18n'
import type { DiffHunk, FileDiff } from '@/types/git'
import DiffView from './DiffView.vue'
import InlineDiff from './InlineDiff.vue'
import SideBySideDiff from './SideBySideDiff.vue'

const commandMocks = vi.hoisted(() => ({
  getBlobBytes: vi.fn(),
  readWorktreeFile: vi.fn(),
}))

vi.mock('@/composables/useGitCommands', () => ({
  useGitCommands: () => commandMocks,
}))

interface ChangeNavigator {
  goNextChange: () => void
  goPrevChange: () => void
}

describe('diff keyboard navigation', () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value: () => undefined,
    })
  })

  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    commandMocks.getBlobBytes.mockClear()
    commandMocks.readWorktreeFile.mockClear()
  })

  it('focuses the text diff body and handles plain arrow keys locally', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const parentKeydown = vi.fn()
    host.addEventListener('keydown', parentKeydown)

    const pinia = createPinia()
    setActivePinia(pinia)
    const wrapper = mount(DiffView, {
      attachTo: host,
      props: {
        diff: fileDiff(),
      },
      global: {
        plugins: [pinia, i18n],
        stubs: {
          DiffToolbar: { template: '<div class="diff-toolbar-stub" />' },
          ConfirmDialog: true,
        },
      },
    })

    await wrapper.find('.code').trigger('click')
    const diffView = wrapper.find<HTMLElement>('.diff-view').element
    expect(document.activeElement).toBe(diffView)

    const downEvent = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    diffView.dispatchEvent(downEvent)
    await nextTick()

    expect(downEvent.defaultPrevented).toBe(true)
    expect(parentKeydown).not.toHaveBeenCalled()
    expect(wrapper.findAll('.inline-line.change-current')).toHaveLength(2)

    const secondDownEvent = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    diffView.dispatchEvent(secondDownEvent)
    await nextTick()
    expect(wrapper.findAll('.inline-line.change-current').map((line) => line.text()).join('\n')).toContain('three')

    const upEvent = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true })
    diffView.dispatchEvent(upEvent)
    await nextTick()
    expect(upEvent.defaultPrevented).toBe(true)
    expect(parentKeydown).not.toHaveBeenCalled()
    expect(wrapper.findAll('.inline-line.change-current').map((line) => line.text()).join('\n')).toContain('two')

    const modifiedEvent = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      altKey: true,
      bubbles: true,
      cancelable: true,
    })
    diffView.dispatchEvent(modifiedEvent)

    expect(modifiedEvent.defaultPrevented).toBe(false)
    expect(parentKeydown).toHaveBeenCalledTimes(1)

    wrapper.unmount()
    host.remove()
  })

  it('lets arrow keys bubble when text diff has no change targets', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const parentKeydown = vi.fn()
    host.addEventListener('keydown', parentKeydown)

    const pinia = createPinia()
    setActivePinia(pinia)
    const wrapper = mount(DiffView, {
      attachTo: host,
      props: {
        diff: noChangeDiff(),
      },
      global: {
        plugins: [pinia, i18n],
        stubs: {
          DiffToolbar: { template: '<div class="diff-toolbar-stub" />' },
          ConfirmDialog: true,
        },
      },
    })

    await wrapper.find('.inline-state').trigger('click')
    const diffView = wrapper.find<HTMLElement>('.diff-view').element
    expect(document.activeElement).toBe(diffView)

    const downEvent = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    diffView.dispatchEvent(downEvent)

    expect(downEvent.defaultPrevented).toBe(false)
    expect(parentKeydown).toHaveBeenCalledTimes(1)

    wrapper.unmount()
    host.remove()
  })

  it('marks inline current change rows and clears the mark when diff changes', async () => {
    const wrapper = mount(InlineDiff, {
      props: {
        diff: fileDiff(),
        groupByHunk: true,
      },
      global: { plugins: [i18n] },
    })

    ;(wrapper.vm as unknown as ChangeNavigator).goNextChange()
    await nextTick()

    expect(wrapper.findAll('.inline-line.change-current')).toHaveLength(2)

    await wrapper.setProps({ diff: fileDiff('other.txt') })
    await nextTick()

    expect(wrapper.find('.inline-line.change-current').exists()).toBe(false)
  })

  it('marks side-by-side current change rows and clears the mark when diff changes', async () => {
    const wrapper = mount(SideBySideDiff, {
      props: {
        diff: fileDiff(),
        groupByHunk: true,
      },
      global: { plugins: [i18n] },
    })

    ;(wrapper.vm as unknown as ChangeNavigator).goNextChange()
    await nextTick()

    expect(wrapper.findAll('.sbs-line.change-current')).toHaveLength(2)
    expect(wrapper.findAll('.gutter-row.change-current')).toHaveLength(2)

    await wrapper.setProps({ diff: fileDiff('other.txt') })
    await nextTick()

    expect(wrapper.find('.sbs-line.change-current').exists()).toBe(false)
    expect(wrapper.find('.gutter-row.change-current').exists()).toBe(false)
  })
})

function fileDiff(path = 'file.txt'): FileDiff {
  return {
    old_path: path,
    new_path: path,
    is_binary: false,
    hunks: [changedLinesHunk()],
    additions: 2,
    deletions: 2,
    old_blob_oid: 'old',
    new_blob_oid: 'new',
    encoding: 'UTF-8',
  }
}

function noChangeDiff(): FileDiff {
  return {
    old_path: 'file.txt',
    new_path: 'file.txt',
    is_binary: false,
    hunks: [],
    additions: 0,
    deletions: 0,
    old_blob_oid: 'old',
    new_blob_oid: 'new',
    encoding: 'UTF-8',
  }
}

function changedLinesHunk(): DiffHunk {
  return {
    old_start: 1,
    old_lines: 5,
    new_start: 1,
    new_lines: 5,
    header: '@@ -1,5 +1,5 @@',
    lines: [
      { origin: ' ', content: 'one\n', old_lineno: 1, new_lineno: 1 },
      { origin: '-', content: 'two\n', old_lineno: 2 },
      { origin: '+', content: 'TWO\n', new_lineno: 2 },
      { origin: ' ', content: 'middle\n', old_lineno: 3, new_lineno: 3 },
      { origin: '-', content: 'three\n', old_lineno: 4 },
      { origin: '+', content: 'THREE\n', new_lineno: 4 },
      { origin: ' ', content: 'four\n', old_lineno: 5, new_lineno: 5 },
    ],
  }
}
