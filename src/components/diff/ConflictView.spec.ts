import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConflictFile } from '@/types/git'
import ConflictView from './ConflictView.vue'

const mocks = vi.hoisted(() => ({
  loadConflictFile: vi.fn(),
  resolveConflict: vi.fn(),
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))
vi.mock('@/stores/mergeRebase', () => ({
  useMergeRebaseStore: () => mocks,
}))

function conflict(path: string, contextId: string, ours: string): ConflictFile {
  return {
    path,
    context_id: contextId,
    base: 'base\n',
    ours,
    theirs: 'theirs\n',
    merged_preview: '',
    is_binary: false,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('ConflictView context', () => {
  beforeEach(() => {
    mocks.loadConflictFile.mockReset()
    mocks.resolveConflict.mockReset().mockResolvedValue(undefined)
  })

  it('ignores an older load and saves the conflict bound to the current repository', async () => {
    const oldLoad = deferred<ConflictFile>()
    const newConflict = conflict('same.txt', 'repo-b-context', 'new ours\n')
    mocks.loadConflictFile
      .mockReturnValueOnce(oldLoad.promise)
      .mockResolvedValueOnce(newConflict)
    const wrapper = mount(ConflictView, {
      props: { repoId: 'repo-a', filePath: 'same.txt' },
    })

    await wrapper.setProps({ repoId: 'repo-b' })
    await flushPromises()
    oldLoad.resolve(conflict('same.txt', 'repo-a-context', 'old ours\n'))
    await flushPromises()
    await wrapper.find('button.btn-primary').trigger('click')
    await flushPromises()

    expect(mocks.loadConflictFile).toHaveBeenNthCalledWith(1, 'repo-a', 'same.txt')
    expect(mocks.loadConflictFile).toHaveBeenNthCalledWith(2, 'repo-b', 'same.txt')
    expect(mocks.resolveConflict).toHaveBeenCalledWith(
      'repo-b',
      newConflict,
      expect.any(String),
    )
  })

  it('does not offer text-save for a binary conflict', async () => {
    mocks.loadConflictFile.mockResolvedValue({
      ...conflict('image.png', 'binary-context', ''),
      is_binary: true,
    })
    const wrapper = mount(ConflictView, {
      props: { repoId: 'repo-a', filePath: 'image.png' },
    })
    await flushPromises()

    expect(wrapper.find('button.btn-primary').attributes('disabled')).toBeDefined()
  })
})
