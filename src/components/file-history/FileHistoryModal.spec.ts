import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommitInfo, FileBlame } from '@/types/git'
import { useRepoStore } from '@/stores/repos'
import FileHistoryModal from './FileHistoryModal.vue'

const mocks = vi.hoisted(() => ({
  getFileLog: vi.fn(),
  getFileDiffAtCommit: vi.fn(),
  getFileBlame: vi.fn(),
}))

vi.mock('vue-i18n', async (importOriginal) => ({
  ...await importOriginal<typeof import('vue-i18n')>(),
  useI18n: () => ({ t: (key: string) => key }),
}))
vi.mock('@tauri-apps/plugin-store', () => ({
  LazyStore: class {
    async get() { return null }
    async set() {}
    async save() {}
  },
}))
vi.mock('@/composables/useGitCommands', () => ({
  useGitCommands: () => ({
    getFileLog: mocks.getFileLog,
    getFileDiffAtCommit: mocks.getFileDiffAtCommit,
    getFileBlame: mocks.getFileBlame,
  }),
}))
vi.mock('@/utils/format', () => ({
  formatTime: (time: number) => String(time),
  formatAbsoluteTime: (time: number) => String(time),
}))
vi.mock('@/lib/highlight', () => ({
  EXT_TO_LANG: {},
  highlightLine: (line: string) => line,
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function commit(oid: string, summary: string): CommitInfo {
  return {
    oid,
    short_oid: oid.slice(0, 7),
    message: summary,
    summary,
    author_name: 'Test User',
    author_email: 'test@example.com',
    author_time: 1,
    time: 1,
    parent_oids: [],
    is_unreachable: false,
    is_stash: false,
    is_reflog_tip: false,
  }
}

function blame(line: string, oid: string): FileBlame {
  return {
    lines: [line],
    hunks: [{
      start_line: 1,
      num_lines: 1,
      commit_oid: oid,
      short_oid: oid.slice(0, 7),
      author_name: 'Test User',
      author_email: 'test@example.com',
      time: 1,
      summary: line,
    }],
  }
}

function setupRepos() {
  const repoStore = useRepoStore()
  repoStore.repos = [
    { id: 'repo-a', path: '/repos/alpha', name: 'alpha' },
    { id: 'repo-b', path: '/repos/beta', name: 'beta' },
  ]
  repoStore.activeRepoId = 'repo-a'
  return repoStore
}

function dispatchKey(key: string, shiftKey = false) {
  const event = new KeyboardEvent('keydown', {
    key,
    shiftKey,
    bubbles: true,
    cancelable: true,
  })
  document.dispatchEvent(event)
  return event
}

describe('FileHistoryModal repository context', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    localStorage.clear()
    setActivePinia(createPinia())
    mocks.getFileLog.mockReset()
    mocks.getFileDiffAtCommit.mockReset()
    mocks.getFileBlame.mockReset()
  })

  it('uses the shared modal focus contract and restores the opener', async () => {
    mocks.getFileLog.mockResolvedValue([])
    setupRepos()
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const wrapper = mount(FileHistoryModal, {
      props: { filePath: 'src/main.ts' },
      global: { stubs: { DiffView: true } },
    })
    await nextTick()
    await nextTick()

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
    const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
    const closeButton = document.querySelector<HTMLButtonElement>('.close-btn')
    expect(dialog?.getAttribute('aria-modal')).toBe('true')
    expect(dialog?.getAttribute('aria-label')).toContain('src/main.ts')
    expect(document.querySelector('[role="tablist"]')).not.toBeNull()
    expect(document.activeElement).toBe(tabs[0])

    tabs[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    await nextTick()
    expect(document.activeElement).toBe(tabs[1])
    expect(tabs[1]?.getAttribute('aria-selected')).toBe('true')
    tabs[1]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    await nextTick()
    expect(document.activeElement).toBe(tabs[0])

    const backward = dispatchKey('Tab', true)
    expect(backward.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(closeButton)
    dispatchKey('Tab')
    expect(document.activeElement).toBe(tabs[0])

    const escape = dispatchKey('Escape')
    expect(escape.defaultPrevented).toBe(true)
    expect(wrapper.emitted('close')).toHaveLength(1)

    wrapper.unmount()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('renders commit choices as native buttons with selection state', async () => {
    mocks.getFileLog.mockResolvedValue([commit('a'.repeat(40), 'keyboard commit')])
    mocks.getFileDiffAtCommit.mockResolvedValue(null)
    setupRepos()
    const wrapper = mount(FileHistoryModal, {
      props: { filePath: 'src/main.ts' },
      global: { stubs: { DiffView: true } },
    })
    await flushPromises()

    const commitButton = document.querySelector<HTMLButtonElement>('.commit-row')
    expect(commitButton?.tagName).toBe('BUTTON')
    expect(commitButton?.getAttribute('aria-pressed')).toBe('false')
    commitButton?.click()
    await nextTick()

    expect(commitButton?.getAttribute('aria-pressed')).toBe('true')
    wrapper.unmount()
  })

  it('reloads file history and ignores the previous repository response', async () => {
    const oldLoad = deferred<CommitInfo[]>()
    mocks.getFileLog
      .mockReturnValueOnce(oldLoad.promise)
      .mockResolvedValueOnce([commit('b'.repeat(40), 'beta commit')])
    const repoStore = setupRepos()
    const wrapper = mount(FileHistoryModal, {
      props: { filePath: 'src/main.ts' },
      global: { stubs: { DiffView: true } },
    })

    expect(mocks.getFileLog).toHaveBeenCalledWith('repo-a', 'src/main.ts', 0, 50)
    repoStore.activeRepoId = 'repo-b'
    await nextTick()
    await flushPromises()

    expect(mocks.getFileLog).toHaveBeenLastCalledWith('repo-b', 'src/main.ts', 0, 50)
    expect(document.body.textContent).toContain('beta commit')

    oldLoad.resolve([commit('a'.repeat(40), 'alpha commit')])
    await flushPromises()

    expect(document.body.textContent).toContain('beta commit')
    expect(document.body.textContent).not.toContain('alpha commit')
    wrapper.unmount()
  })

  it('reloads blame and ignores the previous repository response', async () => {
    const oldLoad = deferred<FileBlame>()
    mocks.getFileBlame
      .mockReturnValueOnce(oldLoad.promise)
      .mockResolvedValueOnce(blame('beta line', 'b'.repeat(40)))
    const repoStore = setupRepos()
    const wrapper = mount(FileHistoryModal, {
      props: { filePath: 'src/main.ts', initialMode: 'blame' },
    })

    expect(mocks.getFileBlame).toHaveBeenCalledWith('repo-a', 'src/main.ts')
    repoStore.activeRepoId = 'repo-b'
    await nextTick()
    await flushPromises()

    expect(mocks.getFileBlame).toHaveBeenLastCalledWith('repo-b', 'src/main.ts')
    expect(document.body.textContent).toContain('beta line')

    oldLoad.resolve(blame('alpha line', 'a'.repeat(40)))
    await flushPromises()

    expect(document.body.textContent).toContain('beta line')
    expect(document.body.textContent).not.toContain('alpha line')
    wrapper.unmount()
  })
})
