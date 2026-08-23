import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, nextTick } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReflogEntry } from '@/types/git'
import { useRepoStore } from '@/stores/repos'
import ReflogDialog from './ReflogDialog.vue'

const mocks = vi.hoisted(() => ({
  getReflog: vi.fn(),
  writeText: vi.fn(),
  showToast: vi.fn(),
  showActionError: vi.fn(),
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: { repo?: string }) =>
      key === 'reflog.titleWithRepo' ? `Reflog — ${params?.repo ?? ''}` : key,
    locale: { value: 'en' },
  }),
}))

vi.mock('@tauri-apps/plugin-store', () => ({
  LazyStore: class {
    async get() { return null }
    async set() {}
    async save() {}
  },
}))

vi.mock('@/composables/useGitCommands', () => ({
  useGitCommands: () => ({ getReflog: mocks.getReflog }),
}))
vi.mock('@/composables/useGlobalToast', () => ({
  useGlobalToast: () => ({
    showToast: mocks.showToast,
    showActionError: mocks.showActionError,
  }),
}))

const ModalStub = defineComponent({
  props: { visible: Boolean, title: String },
  template: '<div v-if="visible"><h1>{{ title }}</h1><slot /><slot name="footer" /></div>',
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function entry(oid: string, message: string): ReflogEntry {
  return {
    oid,
    short_oid: oid.slice(0, 7),
    message,
    committer_name: 'Test User',
    time: 0,
  }
}

describe('ReflogDialog repository context', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mocks.getReflog.mockReset()
    mocks.writeText.mockReset().mockResolvedValue(undefined)
    mocks.showToast.mockReset()
    mocks.showActionError.mockReset()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: mocks.writeText },
    })
  })

  it('reloads on repository switch and ignores the older response', async () => {
    const oldLoad = deferred<ReflogEntry[]>()
    const newEntry = entry('b'.repeat(40), 'beta entry')
    mocks.getReflog
      .mockReturnValueOnce(oldLoad.promise)
      .mockResolvedValueOnce([newEntry])

    const repoStore = useRepoStore()
    repoStore.repos = [
      { id: 'repo-a', path: '/repos/alpha', name: 'alpha' },
      { id: 'repo-b', path: '/repos/beta', name: 'beta' },
    ]
    repoStore.activeRepoId = 'repo-a'

    const wrapper = mount(ReflogDialog, {
      props: { visible: true },
      global: { stubs: { Modal: ModalStub } },
    })

    expect(mocks.getReflog).toHaveBeenCalledWith('repo-a')

    repoStore.activeRepoId = 'repo-b'
    await nextTick()
    await flushPromises()

    expect(mocks.getReflog).toHaveBeenLastCalledWith('repo-b')
    expect(wrapper.text()).toContain('Reflog — beta')
    expect(wrapper.text()).toContain('beta entry')

    oldLoad.resolve([entry('a'.repeat(40), 'alpha entry')])
    await flushPromises()

    expect(wrapper.text()).toContain('beta entry')
    expect(wrapper.text()).not.toContain('alpha entry')
  })

  it('copies the full hash from the keyboard-accessible short hash button', async () => {
    const reflogEntry = entry('c'.repeat(40), 'commit entry')
    mocks.getReflog.mockResolvedValue([reflogEntry])
    const repoStore = useRepoStore()
    repoStore.repos = [{ id: 'repo-a', path: '/repos/alpha', name: 'alpha' }]
    repoStore.activeRepoId = 'repo-a'
    const wrapper = mount(ReflogDialog, {
      props: { visible: true },
      global: { stubs: { Modal: ModalStub } },
    })
    await flushPromises()

    expect(wrapper.find('.oid').element.tagName).toBe('BUTTON')
    await wrapper.find('.oid').trigger('click')
    await flushPromises()

    expect(mocks.writeText).toHaveBeenCalledWith(reflogEntry.oid)
    expect(mocks.showToast).toHaveBeenCalledWith('success', 'reflog.copySuccess')
  })

  it('reports clipboard failures without an unhandled rejection', async () => {
    const clipboardError = new Error('clipboard denied')
    mocks.writeText.mockRejectedValue(clipboardError)
    mocks.getReflog.mockResolvedValue([entry('d'.repeat(40), 'commit entry')])
    const repoStore = useRepoStore()
    repoStore.repos = [{ id: 'repo-a', path: '/repos/alpha', name: 'alpha' }]
    repoStore.activeRepoId = 'repo-a'
    const wrapper = mount(ReflogDialog, {
      props: { visible: true },
      global: { stubs: { Modal: ModalStub } },
    })
    await flushPromises()

    await wrapper.find('.oid').trigger('click')
    await flushPromises()

    expect(mocks.showActionError).toHaveBeenCalledWith(
      clipboardError,
      'reflog.copyFailed',
    )
  })
})
