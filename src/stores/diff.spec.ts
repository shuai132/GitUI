import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useDiffStore } from './diff'
import { useUiStore } from './ui'
import type { FileDiff } from '@/types/git'

const mocks = vi.hoisted(() => ({
  repo: { activeRepoId: 'repo-1' as string | null },
  getFileDiff: vi.fn(),
}))

vi.mock('./repos', () => ({
  useRepoStore: () => mocks.repo,
}))

vi.mock('@/composables/useGitCommands', () => ({
  useGitCommands: () => ({ getFileDiff: mocks.getFileDiff }),
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function diff(additions: number): FileDiff {
  return {
    old_path: 'src/app.ts',
    new_path: 'src/app.ts',
    is_binary: false,
    hunks: [],
    additions,
    deletions: 0,
    old_blob_oid: 'old',
    new_blob_oid: 'new',
    encoding: 'UTF-8',
  }
}

describe('diff store whitespace preference', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    mocks.repo.activeRepoId = 'repo-1'
    mocks.getFileDiff.mockReset()
  })

  it('passes the preference and keeps the newest response during a rapid toggle', async () => {
    const diffStore = useDiffStore()
    const uiStore = useUiStore()
    const visible = deferred<FileDiff>()
    const ignored = deferred<FileDiff>()
    mocks.getFileDiff
      .mockReturnValueOnce(visible.promise)
      .mockReturnValueOnce(ignored.promise)

    const visibleLoad = diffStore.loadFileDiff('src/app.ts', false)
    uiStore.toggleDiffIgnoreWhitespace()
    const ignoredLoad = diffStore.refresh()

    ignored.resolve(diff(7))
    await ignoredLoad
    visible.resolve(diff(3))
    await visibleLoad

    expect(mocks.getFileDiff).toHaveBeenNthCalledWith(
      1,
      'repo-1',
      'src/app.ts',
      false,
      false,
    )
    expect(mocks.getFileDiff).toHaveBeenNthCalledWith(
      2,
      'repo-1',
      'src/app.ts',
      false,
      true,
    )
    expect(diffStore.currentDiff?.additions).toBe(7)
  })
})
