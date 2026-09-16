// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '@/i18n'
import { diffLinePairHtml } from '@/lib/diffLineHtml'
import type { FileDiff } from '@/types/git'
import InlineDiff from './InlineDiff.vue'
import SideBySideDiff from './SideBySideDiff.vue'

vi.mock('@/lib/diffLineHtml', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/diffLineHtml')>()
  return { ...actual, diffLinePairHtml: vi.fn(actual.diffLinePairHtml) }
})

const observers: BlockObserver[] = []
class BlockObserver {
  targets = new Set<Element>()
  disconnected = false
  constructor(private callback: IntersectionObserverCallback) { observers.push(this) }
  observe(element: Element) { this.targets.add(element) }
  unobserve(element: Element) { this.targets.delete(element) }
  disconnect() { this.disconnected = true; this.targets.clear() }
  enter(element: Element) {
    this.callback([{ target: element, isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
  }
}

const disposals: (() => void)[] = []
beforeEach(() => {
  observers.length = 0
  vi.mocked(diffLinePairHtml).mockClear()
  vi.stubGlobal('IntersectionObserver', BlockObserver)
})
afterEach(() => {
  window.getSelection()?.removeAllRanges()
  for (const dispose of disposals.splice(0)) dispose()
  vi.unstubAllGlobals()
})

describe('large diff lazy highlighting', () => {
  it.each([true, false])('defers inline token work while keeping all text and global indices (grouped=%s)', async (groupByHunk) => {
    const wrapper = mount(InlineDiff, {
      props: { diff: largeDiff(), groupByHunk, syntaxLang: 'typescript' },
      global: { plugins: [i18n] },
    })
    disposals.push(() => wrapper.unmount())
    await nextTick()
    expect(wrapper.findAll('[data-row]')).toHaveLength(1025)
    expect(wrapper.find('[data-row="1024"] .code').text()).toBe('const value511 = 2;')
    expect(wrapper.find('[data-row="1024"] mark').exists()).toBe(false)
    expect(diffLinePairHtml).toHaveBeenCalledTimes(127)

    // The first additions are far from their matching deletions and reuse their cached pair.
    const additionBlock = wrapper.findAll('.diff-highlight-block')[4].element
    observers[0].enter(additionBlock)
    await nextTick()
    expect(wrapper.find('[data-row="513"] mark.word-add').exists()).toBe(true)
    expect(diffLinePairHtml).toHaveBeenCalledTimes(128)

    await wrapper.setProps({ currentChangeIdx: 0 })
    expect(diffLinePairHtml).toHaveBeenCalledTimes(128)
    expect(wrapper.find('[data-row="1024"]').classes()).toContain('change-current-end')

    await wrapper.setProps({ syntaxLang: null })
    expect(wrapper.find('[data-row="513"] .hljs-keyword').exists()).toBe(false)
    expect(wrapper.find('[data-row="513"] mark.word-add').exists()).toBe(true)
    await wrapper.setProps({ diff: largeDiff('3') })
    expect(wrapper.find('[data-row="513"] mark.word-add').exists()).toBe(false)
    observers[0].enter(additionBlock)
    await nextTick()
    expect(wrapper.find('[data-row="513"] mark.word-add').text()).toBe('3')
  })

  it.each([true, false])('defers both side-by-side panes and retains shared rows (wrapped=%s)', async (wrapLines) => {
    const wrapper = mount(SideBySideDiff, {
      props: { diff: largeDiff(), groupByHunk: true, wrapLines, syntaxLang: 'typescript' },
      global: { plugins: [i18n] },
    })
    disposals.push(() => wrapper.unmount())
    await nextTick()
    expect(diffLinePairHtml).toHaveBeenCalledTimes(127)
    const row = wrapper.find('[data-row="300"]')
    expect(row.text()).toContain('const value299 = 1;')
    expect(row.find('mark').exists()).toBe(false)
    const block = row.element.closest('.diff-highlight-block')!
    observers[0].enter(block)
    await nextTick()
    expect(row.find('mark.word-del').exists()).toBe(true)
    expect(diffLinePairHtml).toHaveBeenCalledTimes(255)
    if (!wrapLines) {
      const rightBlock = wrapper.findAll('.sbs-pane')[1].findAll('.diff-highlight-block')[2].element
      observers[0].enter(rightBlock)
      await nextTick()
      expect(diffLinePairHtml).toHaveBeenCalledTimes(255)
      expect(rightBlock.querySelector('mark.word-add')).not.toBeNull()
    } else {
      expect(row.findAll('.gutter-row')).toHaveLength(2)
      expect(row.find('mark.word-add').exists()).toBe(true)
    }
  })

  it('preserves native offscreen search / cross-block selection until the selection leaves', async () => {
    const wrapper = mount(InlineDiff, {
      attachTo: document.body,
      props: { diff: largeDiff(), groupByHunk: true },
      global: { plugins: [i18n] },
    })
    disposals.push(() => wrapper.unmount())
    await nextTick()
    const start = wrapper.find('[data-row="250"] .code').element.firstChild!
    const end = wrapper.find('[data-row="270"] .code').element.firstChild!
    const range = document.createRange()
    range.setStart(start, 6)
    range.setEnd(end, 8)
    const selection = window.getSelection()!
    selection.addRange(range)
    const selected = selection.toString()
    const blocks = wrapper.findAll('.diff-highlight-block')
    observers[0].enter(blocks[1].element)
    observers[0].enter(blocks[2].element)
    await nextTick()
    expect(selection.toString()).toBe(selected)
    expect(range.startContainer).toBe(start)
    expect(diffLinePairHtml).toHaveBeenCalledTimes(127)

    selection.removeAllRanges()
    document.dispatchEvent(new Event('selectionchange'))
    await nextTick()
    expect(wrapper.find('[data-row="250"] mark').exists()).toBe(true)
    expect(wrapper.find('[data-row="270"] mark').exists()).toBe(true)
    const observer = observers[0]
    wrapper.unmount()
    disposals.length = 0
    expect(observer.disconnected).toBe(true)
    expect(observer.targets.size).toBe(0)
  })

  it('retains hunk actions and unique indices across many blocks', async () => {
    const diff = largeDiff()
    diff.hunks = Array.from({ length: 140 }, (_, i) => ({
      ...diff.hunks[0], header: `@@ hunk ${i} @@`, lines: [diff.hunks[0].lines[0]],
    }))
    const wrapper = mount(InlineDiff, {
      props: { diff, groupByHunk: true, hunkActionLabel: 'Stage', hunkDiscardLabel: 'Discard' },
      global: { plugins: [i18n] },
    })
    disposals.push(() => wrapper.unmount())
    expect(wrapper.findAll('[data-row]').map(row => Number(row.attributes('data-row'))))
      .toEqual(Array.from({ length: 280 }, (_, i) => i))
    const groups = wrapper.findAll('.hunk-block')
    const last = groups[groups.length - 1]
    await last.find('.hunk-action-btn').trigger('click')
    await last.find('.hunk-action-btn--danger').trigger('click')
    expect(wrapper.emitted('hunk-action')).toEqual([[139]])
    expect(wrapper.emitted('hunk-discard')).toEqual([[139]])
  })

  it('preserves selected highlighted text on an unchanged diff refresh', async () => {
    const wrapper = mount(InlineDiff, {
      attachTo: document.body,
      props: { diff: largeDiff(), groupByHunk: true },
      global: { plugins: [i18n] },
    })
    disposals.push(() => wrapper.unmount())
    await nextTick()
    const block = wrapper.findAll('.diff-highlight-block')[2].element
    observers[0].enter(block)
    await nextTick()
    const code = wrapper.find('[data-row="270"] .code').element
    const range = document.createRange()
    range.selectNodeContents(code)
    const selection = window.getSelection()!
    selection.addRange(range)
    const text = selection.toString()
    const first = code.firstChild
    await wrapper.setProps({ diff: largeDiff() })
    expect(selection.toString()).toBe(text)
    expect(code.firstChild).toBe(first)
    expect(code.querySelector('mark')).not.toBeNull()
  })

  it('keeps full-file context searchable and resolves syntax by original side and line', async () => {
    const diff = largeDiff()
    diff.hunks = [{
      header: '@@ -300 +300 @@', old_start: 300, old_lines: 1, new_start: 300, new_lines: 1,
      lines: [
        { origin: '-', old_lineno: 300, content: 'const before = 1;\n' },
        { origin: '+', new_lineno: 300, content: 'const after = 2;\n' },
      ],
    }]
    const oldLines = Array.from({ length: 600 }, (_, i) => `const context${i + 1} = true;`)
    oldLines[299] = 'const before = 1;'
    const newLines = [...oldLines]
    newLines[299] = 'const after = 2;'
    const resolveLang = vi.fn(() => 'typescript')
    const wrapper = mount(InlineDiff, {
      props: {
        diff, groupByHunk: false, syntaxLangForLine: resolveLang,
        fullFileContent: { oldText: oldLines.join('\n'), newText: newLines.join('\n') },
      },
      global: { plugins: [i18n] },
    })
    disposals.push(() => wrapper.unmount())
    await nextTick()
    expect(wrapper.findAll('[data-row]')).toHaveLength(601)
    expect(wrapper.find('[data-row="600"] .code').text()).toBe('const context600 = true;')
    expect(resolveLang).toHaveBeenCalledTimes(128)
    expect(diffLinePairHtml).not.toHaveBeenCalled()
    observers[0].enter(wrapper.findAll('.diff-highlight-block')[2].element)
    await nextTick()
    expect(resolveLang).toHaveBeenCalledWith('old', 300)
    expect(resolveLang).toHaveBeenCalledWith('new', 300)
    expect(diffLinePairHtml).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[data-row="300"] mark.word-add').exists()).toBe(true)
  })
})

function largeDiff(next = '2'): FileDiff {
  return {
    old_path: 'large.ts', new_path: 'large.ts', is_binary: false,
    additions: 512, deletions: 512, old_blob_oid: 'old', new_blob_oid: 'new', encoding: 'UTF-8',
    hunks: [{
      header: '@@ -1,512 +1,512 @@', old_start: 1, old_lines: 512, new_start: 1, new_lines: 512,
      lines: [
        ...Array.from({ length: 512 }, (_, i) => ({ origin: '-', old_lineno: i + 1, content: `const value${i} = 1;\n` })),
        ...Array.from({ length: 512 }, (_, i) => ({ origin: '+', new_lineno: i + 1, content: `const value${i} = ${next};\n` })),
      ],
    }],
  }
}
