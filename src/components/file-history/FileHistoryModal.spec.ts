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

describe('FileHistoryModal repository context', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    mocks.getFileLog.mockReset()
    mocks.getFileDiffAtCommit.mockReset()
    mocks.getFileBlame.mockReset()
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
    expect(wrapper.text()).toContain('beta commit')

    oldLoad.resolve([commit('a'.repeat(40), 'alpha commit')])
    await flushPromises()

    expect(wrapper.text()).toContain('beta commit')
    expect(wrapper.text()).not.toContain('alpha commit')
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
    expect(wrapper.text()).toContain('beta line')

    oldLoad.resolve(blame('alpha line', 'a'.repeat(40)))
    await flushPromises()

    expect(wrapper.text()).toContain('beta line')
    expect(wrapper.text()).not.toContain('alpha line')
    wrapper.unmount()
  })
})
