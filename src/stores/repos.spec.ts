import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useRepoStore } from './repos'
import type { RepoMeta } from '@/types/git'

const commandMocks = vi.hoisted(() => ({
  closeRepo: vi.fn(),
  setActiveRepo: vi.fn(),
  openRepo: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-store', () => ({
  LazyStore: class {
    async get<T>(): Promise<T | null> { return null }
    async set(_key: string, _value: unknown) {}
    async save() {}
  },
}))

vi.mock('@/composables/useGitCommands', () => ({
  useGitCommands: () => commandMocks,
}))

function repo(id: string, name: string): RepoMeta {
  return {
    id,
    name,
    path: `/repos/${name}`,
  }
}

describe('repos store active backend sync', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    commandMocks.closeRepo.mockResolvedValue(undefined)
    commandMocks.setActiveRepo.mockResolvedValue(undefined)
    commandMocks.openRepo.mockReset()
  })

  it('sends the next active repo and same generation when closing the active repo', async () => {
    const store = useRepoStore()
    store.repos = [repo('repo-a', 'alpha'), repo('repo-b', 'beta')]
    store.activeRepoId = 'repo-a'

    await store.closeRepo('repo-a')

    expect(commandMocks.closeRepo).toHaveBeenCalledWith('repo-a', 'repo-b', 1)
    expect(store.activeRepoId).toBe('repo-b')
    expect(store.repos.map((r) => r.id)).toEqual(['repo-b'])
    expect(commandMocks.setActiveRepo).not.toHaveBeenCalled()
  })

  it('increments generation monotonically when switching active repos quickly', async () => {
    const store = useRepoStore()
    store.repos = [repo('repo-a', 'alpha'), repo('repo-b', 'beta')]

    await store.setActive('repo-a')
    await store.setActive('repo-b')

    expect(commandMocks.setActiveRepo).toHaveBeenNthCalledWith(1, 'repo-a', 1)
    expect(commandMocks.setActiveRepo).toHaveBeenNthCalledWith(2, 'repo-b', 2)
    expect(store.activeRepoId).toBe('repo-b')
  })

  it('keeps the active repo unchanged when closing a non-active repo', async () => {
    const store = useRepoStore()
    store.repos = [repo('repo-a', 'alpha'), repo('repo-b', 'beta')]
    store.activeRepoId = 'repo-a'

    await store.closeRepo('repo-b')

    expect(commandMocks.closeRepo).toHaveBeenCalledWith('repo-b', 'repo-a', 1)
    expect(commandMocks.setActiveRepo).not.toHaveBeenCalled()
    expect(store.activeRepoId).toBe('repo-a')
    expect(store.repos.map((r) => r.id)).toEqual(['repo-a'])
  })

  it('opens multiple dropped repositories and activates only the last one', async () => {
    commandMocks.openRepo
      .mockResolvedValueOnce(repo('repo-a', 'alpha'))
      .mockResolvedValueOnce(repo('repo-b', 'beta'))
    const store = useRepoStore()

    const result = await store.openRepos(['/repos/alpha/', '/repos/beta'])

    expect(commandMocks.openRepo).toHaveBeenNthCalledWith(1, '/repos/alpha')
    expect(commandMocks.openRepo).toHaveBeenNthCalledWith(2, '/repos/beta')
    expect(commandMocks.setActiveRepo).toHaveBeenCalledTimes(1)
    expect(commandMocks.setActiveRepo).toHaveBeenCalledWith('repo-b', 1)
    expect(store.activeRepoId).toBe('repo-b')
    expect(store.repos.map((r) => r.id)).toEqual(['repo-a', 'repo-b'])
    expect(result.failed).toEqual([])
  })

  it('continues opening valid repositories after a dropped path fails', async () => {
    const failure = new Error('not a repository')
    commandMocks.openRepo
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(repo('repo-b', 'beta'))
    const store = useRepoStore()

    const result = await store.openRepos(['/tmp/plain-folder', '/repos/beta'])

    expect(result.opened.map((r) => r.id)).toEqual(['repo-b'])
    expect(result.failed).toEqual([{ path: '/tmp/plain-folder', error: failure }])
    expect(store.activeRepoId).toBe('repo-b')
    expect(commandMocks.setActiveRepo).toHaveBeenCalledTimes(1)
  })

  it('deduplicates dropped paths and reuses repositories already in the list', async () => {
    const existing = repo('repo-a', 'alpha')
    const store = useRepoStore()
    store.repos = [existing]

    const result = await store.openRepos(['/repos/alpha/', '/repos/alpha'])

    expect(commandMocks.openRepo).not.toHaveBeenCalled()
    expect(result.opened).toEqual([existing])
    expect(store.activeRepoId).toBe('repo-a')
    expect(commandMocks.setActiveRepo).toHaveBeenCalledTimes(1)
  })
})
