import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '@/i18n'
import { useUiStore } from '@/stores/ui'
import type { BlobData, DocumentText, DocumentTextSource, FileDiff } from '@/types/git'
import DocumentDiff from './DocumentDiff.vue'

const commandMocks = vi.hoisted(() => ({
  extractDocumentText: vi.fn(
    async (_repoId: string, source: DocumentTextSource, _allowLarge?: boolean): Promise<DocumentText> => ({
      text: source.kind === 'blob' && source.oid === 'old' ? 'A\nold\nC' : 'A\nnew\nC',
      truncated: false,
    }),
  ),
  getBlobBytes: vi.fn(
    async (_repoId: string, _oid: string, _allowLarge?: boolean): Promise<BlobData> => ({
      bytes_base64: '',
      size: 0,
      truncated: true,
    }),
  ),
  readWorktreeFile: vi.fn(
    async (_repoId: string, _relPath: string, _allowLarge?: boolean): Promise<BlobData> => ({
      bytes_base64: '',
      size: 0,
      truncated: true,
    }),
  ),
}))

vi.mock('@/composables/useGitCommands', () => ({
  useGitCommands: () => commandMocks,
}))

describe('DocumentDiff', () => {
  beforeEach(() => {
    commandMocks.extractDocumentText.mockClear()
    commandMocks.getBlobBytes.mockClear()
    commandMocks.readWorktreeFile.mockClear()
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('keeps side-by-side text diff when hunk grouping is enabled', async () => {
    const uiStore = useUiStore()
    uiStore.setDiffLayoutMode('side-by-side')
    uiStore.setDiffGroupByHunk(true)

    const wrapper = mount(DocumentDiff, {
      props: {
        diff: fileDiff(),
        repoId: 'repo-1',
        documentKind: 'docx',
      },
      global: { plugins: [i18n] },
    })

    await flushPromises()

    expect(wrapper.find('.text-table--side-by-side').exists()).toBe(true)
    expect(wrapper.find('.inline-list').exists()).toBe(false)
    expect(wrapper.find('.hunk-row').exists()).toBe(true)
  })
})

function fileDiff(): FileDiff {
  return {
    old_path: 'report.docx',
    new_path: 'report.docx',
    is_binary: false,
    hunks: [],
    additions: 1,
    deletions: 1,
    old_blob_oid: 'old',
    new_blob_oid: 'new',
    encoding: 'UTF-8',
  }
}
