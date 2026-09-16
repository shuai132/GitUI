import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount, shallowMount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUiStore } from '@/stores/ui'
import type { BlobData, FileDiff } from '@/types/git'
import { i18n } from '@/i18n'
import MarkdownDiff from './MarkdownDiff.vue'
import MarkdownPreview from './MarkdownPreview.vue'
import DiffView from './DiffView.vue'
import InlineDiff from './InlineDiff.vue'
import SideBySideDiff from './SideBySideDiff.vue'

const readers = vi.hoisted(() => ({ getBlobBytes: vi.fn(), readWorktreeFile: vi.fn() }))
vi.mock('@/composables/useGitCommands', () => ({ useGitCommands: () => readers }))
const diff: FileDiff = { old_path: 'README.md', new_path: 'README.md', old_blob_oid: 'old', new_blob_oid: 'new', is_binary: false, hunks: [], additions: 0, deletions: 0, encoding: 'UTF-8' }
function blob(text: string): BlobData { return { bytes_base64: btoa(text), size: text.length, truncated: false } }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done }); return { promise, resolve } }
function preview() { return shallowMount(MarkdownDiff, { props: { diff, repoId: 'repo', wip: { staged: false }, identityKey: 'first' }, global: { plugins: [i18n] } }) }

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  readers.getBlobBytes.mockReset().mockImplementation((_repo, oid: string) => Promise.resolve(blob(`# ${oid}`)))
  readers.readWorktreeFile.mockReset().mockResolvedValue(blob('# Worktree'))
  useUiStore().setMarkdownMode('preview')
  HTMLElement.prototype.scrollTo = vi.fn()
})

describe('Markdown diff integration', () => {
  it('reads only the new side until comparison is selected and reuses the current snapshot', async () => {
    const wrapper = preview()
    await flushPromises()
    expect(wrapper.findComponent(MarkdownPreview).props('text')).toBe('# Worktree')
    expect(readers.getBlobBytes).not.toHaveBeenCalled()
    useUiStore().setMarkdownMode('compare')
    await flushPromises()
    expect(wrapper.findAllComponents(MarkdownPreview).map((p) => p.props('text'))).toEqual(['# old', '# Worktree'])
    expect(readers.readWorktreeFile).toHaveBeenCalledTimes(1)
    expect(readers.getBlobBytes).toHaveBeenCalledWith('repo', 'old', true)
    wrapper.unmount()
  })
  it('reloads saved worktree changes when the diff is refreshed, even if OIDs do not change', async () => {
    const wrapper = preview()
    await flushPromises()
    readers.readWorktreeFile.mockResolvedValue(blob('# Saved again'))
    await wrapper.setProps({ diff: { ...diff } })
    await flushPromises()
    expect(wrapper.findComponent(MarkdownPreview).props('text')).toBe('# Saved again')
    expect(readers.readWorktreeFile).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })
  it('preserves scroll on same-file refresh and resets on a new context', async () => {
    const wrapper = preview()
    await flushPromises()
    wrapper.find<HTMLElement>('.markdown-scroll').element.scrollTop = 250
    await wrapper.setProps({ diff: { ...diff } })
    await flushPromises()
    expect(wrapper.find<HTMLElement>('.markdown-scroll').element.scrollTop).toBe(250)
    await wrapper.setProps({ identityKey: 'another-file', diff: { ...diff, new_path: 'other.md' } })
    await flushPromises()
    expect(wrapper.find<HTMLElement>('.markdown-scroll').element.scrollTop).toBe(0)
    wrapper.unmount()
  })
  it('rejects stale file responses and captures repo and staged state before awaiting', async () => {
    const stale = deferred<BlobData>()
    readers.readWorktreeFile.mockReturnValueOnce(stale.promise)
    const wrapper = preview()
    await wrapper.setProps({ repoId: 'other-repo', diff: { ...diff, new_blob_oid: 'staged' }, wip: { staged: true } })
    await flushPromises()
    expect(wrapper.findComponent(MarkdownPreview).props('text')).toBe('# staged')
    stale.resolve(blob('# Wrong file'))
    await flushPromises()
    expect(wrapper.findComponent(MarkdownPreview).props('text')).toBe('# staged')
    expect(readers.getBlobBytes).toHaveBeenCalledWith('other-repo', 'staged', true)
    wrapper.unmount()
  })
  it('shows read failures with retry and source controls instead of empty content', async () => {
    readers.readWorktreeFile.mockRejectedValueOnce(new Error('missing'))
    const wrapper = preview()
    await flushPromises()
    expect(wrapper.findComponent(MarkdownPreview).exists()).toBe(false)
    await wrapper.find('.markdown-state button').trigger('click')
    await flushPromises()
    expect(wrapper.findComponent(MarkdownPreview).props('text')).toBe('# Worktree')
    wrapper.unmount()
  })
  it('keeps staged and historical previews on their blob and handles deletion', async () => {
    const wrapper = preview()
    await wrapper.setProps({ wip: { staged: true } })
    await flushPromises()
    expect(wrapper.findComponent(MarkdownPreview).props('text')).toBe('# new')
    await wrapper.setProps({ wip: null })
    await flushPromises()
    expect(wrapper.findComponent(MarkdownPreview).props('text')).toBe('# new')
    await wrapper.setProps({ diff: { ...diff, new_blob_oid: undefined } })
    await flushPromises()
    expect(wrapper.findComponent(MarkdownPreview).exists()).toBe(false)
    expect(wrapper.find('.markdown-state').text()).toContain(i18n.global.t('diff.markdown.deleted'))
    wrapper.unmount()
  })
  it('defaults source wrapping only for Markdown and switches through the real toolbar', async () => {
    useUiStore().setMarkdownMode('source')
    const wrapper = mount(DiffView, { props: { diff, repoId: 'repo', wip: { staged: false } }, global: { plugins: [i18n], stubs: { ConfirmDialog: true } } })
    expect(wrapper.findComponent(InlineDiff).props('wrapLines')).toBe(true)
    expect(readers.readWorktreeFile).not.toHaveBeenCalled()
    await wrapper.find('.btn-wrap').trigger('click')
    expect(wrapper.findComponent(InlineDiff).props('wrapLines')).toBe(false)
    useUiStore().setDiffLayoutMode('side-by-side')
    await flushPromises()
    expect(wrapper.findComponent(SideBySideDiff).props('wrapLines')).toBe(false)
    await wrapper.find('.markdown-mode').setValue('preview')
    await vi.waitFor(() => expect(wrapper.findComponent(MarkdownDiff).exists()).toBe(true))
    await flushPromises()
    expect(wrapper.find('.change-nav').exists()).toBe(false)
    expect(wrapper.find('.btn-ignore-whitespace').exists()).toBe(false)
    await wrapper.setProps({ diff: { ...diff, new_path: 'plain.ts' } })
    expect(wrapper.find('.markdown-mode').exists()).toBe(false)
    expect(wrapper.findComponent(SideBySideDiff).props('wrapLines')).toBe(false)
    wrapper.unmount()
  })
})
