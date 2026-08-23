import { computed, nextTick, type Ref } from 'vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import FileChangeList from './FileChangeList.vue'
import type { FileEntry } from '@/types/git'

type VirtualOptionsRef = Ref<{
  count: number
  estimateSize: () => number
}>

vi.mock('@tanstack/vue-virtual', () => ({
  useVirtualizer: (options: VirtualOptionsRef) => computed(() => {
    const size = options.value.estimateSize()
    return {
      getVirtualItems: () => Array.from({ length: options.value.count }, (_, index) => ({
        index,
        start: index * size,
      })),
      getTotalSize: () => options.value.count * size,
      measure: vi.fn(),
      scrollToIndex: vi.fn(),
    }
  }),
}))

vi.mock('vue-i18n', async (importOriginal) => ({
  ...await importOriginal<typeof import('vue-i18n')>(),
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('@/stores/settings', () => ({
  useSettingsStore: () => ({ fileListRowHeight: 22 }),
}))

function file(path: string, status: FileEntry['status'] = 'modified'): FileEntry {
  return {
    path,
    status,
    staged: false,
    additions: 1,
    deletions: 0,
  }
}

function mountList(files: FileEntry[], submodulePaths: string[] = []) {
  return mount(FileChangeList, {
    props: {
      files,
      title: 'Changes',
      showRowActions: true,
      viewMode: 'list',
      submodulePaths,
    },
  })
}

describe('FileChangeList double-click', () => {
  it('opens a regular worktree file and exposes the gesture in its title', async () => {
    const changed = file('src/app.ts')
    const wrapper = mountList([changed])
    await nextTick()

    await wrapper.find('.file-entry').trigger('dblclick')

    expect(wrapper.emitted('open')?.[0]).toEqual([changed])
    expect(wrapper.find('.file-path').attributes('title')).toContain(
      'workspace.fileList.doubleClickOpen',
    )
  })

  it('does not open deleted files or submodules', async () => {
    const deletedWrapper = mountList([file('removed.ts', 'deleted')])
    await nextTick()
    await deletedWrapper.find('.file-entry').trigger('dblclick')
    expect(deletedWrapper.emitted('open')).toBeUndefined()

    const submoduleWrapper = mountList([file('vendor/sdk')], ['vendor/sdk'])
    await nextTick()
    await submoduleWrapper.find('.file-entry').trigger('dblclick')
    expect(submoduleWrapper.emitted('open')).toBeUndefined()
  })

  it('stops a double-click on the stage button from opening the file', async () => {
    const wrapper = mountList([file('src/app.ts')])
    await nextTick()

    await wrapper.find('.row-action').trigger('dblclick')

    expect(wrapper.emitted('open')).toBeUndefined()
  })
})
