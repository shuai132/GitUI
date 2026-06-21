import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useRepoStore } from './repos'
import type { RepoMeta } from '@/types/git'

const commandMocks = vi.hoisted(() => ({
  closeRepo: vi.fn(),
  setActiveRepo: vi.fn(),
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
})
