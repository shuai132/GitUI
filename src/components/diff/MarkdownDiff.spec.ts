import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '@/i18n'
import type { BlobData, FileDiff } from '@/types/git'
import MarkdownDiff from './MarkdownDiff.vue'

const commandMocks = vi.hoisted(() => {
  const encode = (text: string): string => {
    const bytes = new TextEncoder().encode(text)
    let binary = ''
    for (const byte of bytes) {
      binary += String.fromCharCode(byte)
    }
    return btoa(binary)
  }

  return {
    getBlobBytes: vi.fn(
      async (_repoId: string, oid: string, _allowLarge?: boolean): Promise<BlobData> => ({
        bytes_base64: encode(oid === 'old' ? '# Old\n\n[site](https://example.com)' : '# New'),
        size: 0,
        truncated: false,
      }),
    ),
    readWorktreeFile: vi.fn(
      async (_repoId: string, _relPath: string, _allowLarge?: boolean): Promise<BlobData> => ({
        bytes_base64: encode('# Worktree'),
        size: 0,
        truncated: false,
      }),
    ),
  }
})

const openerMocks = vi.hoisted(() => ({
  openUrl: vi.fn(async (_url: string) => undefined),
}))

vi.mock('@/composables/useGitCommands', () => ({
  useGitCommands: () => commandMocks,
}))

vi.mock('@tauri-apps/plugin-opener', () => openerMocks)

describe('MarkdownDiff', () => {
  beforeEach(() => {
    commandMocks.getBlobBytes.mockClear()
    commandMocks.readWorktreeFile.mockClear()
    openerMocks.openUrl.mockClear()
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('renders old and new Markdown previews above the source diff', async () => {
    const wrapper = mount(MarkdownDiff, {
      props: {
        diff: fileDiff(),
        repoId: 'repo-1',
      },
      global: { plugins: [i18n] },
    })

    await flushPromises()

    const panes = wrapper.findAll('.markdown-content')
    expect(panes).toHaveLength(2)
    expect(panes[0].html()).toContain('<h1>Old</h1>')
    expect(panes[1].html()).toContain('<h1>New</h1>')
    expect(wrapper.find('.inline-diff').exists()).toBe(true)
  })

  it('reads the new side from the worktree for unstaged WIP files', async () => {
    const wrapper = mount(MarkdownDiff, {
      props: {
        diff: { ...fileDiff(), new_blob_oid: undefined },
        repoId: 'repo-1',
        wip: { staged: false },
      },
      global: { plugins: [i18n] },
    })

    await flushPromises()

    expect(commandMocks.readWorktreeFile).toHaveBeenCalledWith('repo-1', 'README.md', true)
    expect(wrapper.html()).toContain('<h1>Worktree</h1>')
  })

  it('opens safe external links through the system opener', async () => {
    const wrapper = mount(MarkdownDiff, {
      props: {
        diff: fileDiff(),
        repoId: 'repo-1',
      },
      global: { plugins: [i18n] },
    })

    await flushPromises()
    await wrapper.find('a[data-markdown-link="external"]').trigger('click')

    expect(openerMocks.openUrl).toHaveBeenCalledWith('https://example.com/')
  })
})

function fileDiff(): FileDiff {
  return {
    old_path: 'README.md',
    new_path: 'README.md',
    is_binary: false,
    hunks: [
      {
        old_start: 1,
        old_lines: 1,
        new_start: 1,
        new_lines: 1,
        header: '@@ -1 +1 @@',
        lines: [
          { origin: '-', content: '# Old\n', old_lineno: 1 },
          { origin: '+', content: '# New\n', new_lineno: 1 },
        ],
      },
    ],
    additions: 1,
    deletions: 1,
    old_blob_oid: 'old',
    new_blob_oid: 'new',
    encoding: 'UTF-8',
  }
}
