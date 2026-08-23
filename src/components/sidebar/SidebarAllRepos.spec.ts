import { flushPromises, shallowMount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RepoMeta } from '@/types/git'
import type { UnavailableRepo } from '@/stores/repos'
import ContextMenu from '@/components/common/ContextMenu.vue'
import SidebarAllRepos from './SidebarAllRepos.vue'

type TestDragDropEvent = {
  payload: {
    type: 'drop'
    position: { x: number; y: number }
    paths: string[]
  }
}

const mocks = vi.hoisted(() => ({
  repo: {
    id: 'repo-a',
    name: 'alpha',
    path: '/repos/alpha',
  } as RepoMeta,
  repoStore: {
    repos: [] as RepoMeta[],
    unavailableRepos: [] as UnavailableRepo[],
    activeRepoId: 'repo-a' as string | null,
    setActive: vi.fn(),
    closeRepo: vi.fn(),
    openRepos: vi.fn(),
    reorderRepos: vi.fn(),
    recoverUnavailableRepo: vi.fn(),
    removeUnavailableRepo: vi.fn(),
  },
  git: {
    listSubmodules: vi.fn(),
    openInNewWindow: vi.fn(),
    openTerminal: vi.fn(),
  },
  showError: vi.fn(),
  revealItemInDir: vi.fn(),
  dragHandler: null as ((event: TestDragDropEvent) => void) | null,
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      `${key} ${Object.values(params ?? {}).join(' ')}`.trim(),
  }),
}))
vi.mock('@/stores/repos', () => ({ useRepoStore: () => mocks.repoStore }))
vi.mock('@/stores/submodules', () => ({ useSubmodulesStore: () => ({ submodules: [] }) }))
vi.mock('@/stores/ui', () => ({
  useUiStore: () => ({
    reposHeight: 120,
    sidebarWidth: 220,
    openRepoSearchSignal: 0,
    persistReposHeight: vi.fn(),
    persistSidebarWidth: vi.fn(),
  }),
}))
vi.mock('@/stores/settings', () => ({
  useSettingsStore: () => ({}),
  resolveExternalTerminalApp: () => null,
}))
vi.mock('@/composables/useGitCommands', () => ({ useGitCommands: () => mocks.git }))
vi.mock('@/composables/useRepoCreation', () => ({
  useRepoCreation: () => ({ showMenuAt: vi.fn() }),
}))
vi.mock('@/composables/useGlobalToast', () => ({
  useGlobalToast: () => ({
    showActionError: (_error: unknown, fallback?: string) => mocks.showError(fallback),
  }),
}))
vi.mock('@tauri-apps/plugin-opener', () => ({ revealItemInDir: mocks.revealItemInDir }))
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    scaleFactor: vi.fn().mockResolvedValue(1),
    onScaleChanged: vi.fn().mockResolvedValue(vi.fn()),
  }),
}))
vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: vi.fn((handler: (event: TestDragDropEvent) => void) => {
      mocks.dragHandler = handler
      return Promise.resolve(vi.fn())
    }),
  }),
}))

describe('SidebarAllRepos action feedback', () => {
  beforeEach(() => {
    mocks.repoStore.repos = [{ ...mocks.repo }]
    mocks.repoStore.unavailableRepos = []
    mocks.repoStore.activeRepoId = 'repo-a'
    mocks.repoStore.setActive.mockReset().mockResolvedValue(undefined)
    mocks.repoStore.closeRepo.mockReset().mockResolvedValue(undefined)
    mocks.repoStore.openRepos.mockReset().mockResolvedValue({ opened: [], failed: [] })
    mocks.repoStore.reorderRepos.mockReset().mockResolvedValue(undefined)
    mocks.repoStore.recoverUnavailableRepo.mockReset().mockResolvedValue(undefined)
    mocks.repoStore.removeUnavailableRepo.mockReset().mockResolvedValue(undefined)
    mocks.git.listSubmodules.mockReset().mockResolvedValue([])
    mocks.git.openInNewWindow.mockReset().mockResolvedValue(undefined)
    mocks.git.openTerminal.mockReset().mockResolvedValue(undefined)
    mocks.revealItemInDir.mockReset().mockResolvedValue(undefined)
    mocks.showError.mockReset()
    mocks.dragHandler = null
  })

  it('reports repository activation failure', async () => {
    mocks.repoStore.setActive.mockRejectedValue(new Error('watcher failed'))
    const wrapper = shallowMount(SidebarAllRepos)
    await flushPromises()

    await wrapper.find('.repo-item-main').trigger('click')
    await flushPromises()

    expect(mocks.showError).toHaveBeenCalledWith(
      'sidebar.repo.activateFailed Error: watcher failed',
    )
  })

  it('uses separate labeled buttons for activation and removal', async () => {
    const wrapper = shallowMount(SidebarAllRepos)
    await flushPromises()
    const activateButton = wrapper.find<HTMLButtonElement>('.repo-item-main')
    const removeButton = wrapper.find<HTMLButtonElement>('.repo-item-remove')

    expect(activateButton.element.tagName).toBe('BUTTON')
    expect(activateButton.attributes('aria-current')).toBe('true')
    expect(removeButton.attributes('aria-label')).toContain('alpha')

    await activateButton.trigger('click')
    await flushPromises()
    expect(mocks.repoStore.setActive).toHaveBeenCalledWith('repo-a')
  })

  it('reports failed folders from a partial drop', async () => {
    const dropError = new Error('not a repository')
    mocks.repoStore.openRepos.mockResolvedValue({
      opened: [{ ...mocks.repo }],
      failed: [{ path: '/tmp/plain', error: dropError }],
    })
    const wrapper = shallowMount(SidebarAllRepos)
    await flushPromises()
    Object.defineProperty(wrapper.element, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, right: 200, bottom: 200 }),
    })

    mocks.dragHandler?.({
      payload: {
        type: 'drop',
        position: { x: 20, y: 20 },
        paths: ['/repos/alpha', '/tmp/plain'],
      },
    })
    await flushPromises()

    expect(mocks.repoStore.openRepos).toHaveBeenCalledWith(['/repos/alpha', '/tmp/plain'])
    expect(mocks.showError).toHaveBeenCalledWith(
      'sidebar.repo.dropFailed 1 Error: not a repository',
    )
  })

  it('reports repository removal failure', async () => {
    mocks.repoStore.closeRepo.mockRejectedValue(new Error('close failed'))
    const wrapper = shallowMount(SidebarAllRepos)
    await flushPromises()

    await wrapper.find('.repo-item-remove').trigger('click')
    await flushPromises()

    expect(mocks.showError).toHaveBeenCalledWith(
      'sidebar.repo.removeFailed Error: close failed',
    )
  })

  it('reports a failed repository context-menu action', async () => {
    mocks.git.openInNewWindow.mockRejectedValue(new Error('window failed'))
    const wrapper = shallowMount(SidebarAllRepos)
    await flushPromises()

    await wrapper.find('.repo-item').trigger('contextmenu')
    wrapper.findComponent(ContextMenu).vm.$emit('select', 'new-window')
    await flushPromises()

    expect(mocks.showError).toHaveBeenCalledWith(
      'sidebar.repo.menuActionFailed Error: window failed',
    )
  })

  it('separates unavailable repository retry from labeled row actions', async () => {
    mocks.repoStore.repos = []
    mocks.repoStore.unavailableRepos = [{
      path: '/repos/missing',
      name: 'missing',
      error: 'not found',
    }]
    const wrapper = shallowMount(SidebarAllRepos)
    await flushPromises()
    const retryButton = wrapper.find<HTMLButtonElement>('.repo-unavailable-main')
    const actions = wrapper.findAll<HTMLButtonElement>('.repo-unavailable-action')

    expect(retryButton.element.tagName).toBe('BUTTON')
    expect(retryButton.attributes('aria-label')).toContain('missing')
    expect(actions).toHaveLength(3)
    expect(actions[1]?.attributes('aria-label')).toContain('missing')

    await retryButton.trigger('click')
    await flushPromises()
    expect(mocks.repoStore.recoverUnavailableRepo).toHaveBeenCalledWith('/repos/missing')
  })
})
