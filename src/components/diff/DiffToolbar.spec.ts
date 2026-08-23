import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DiffToolbar from './DiffToolbar.vue'
import { useUiStore } from '@/stores/ui'
import type { FileDiff } from '@/types/git'

vi.mock('vue-i18n', async (importOriginal) => ({
  ...await importOriginal<typeof import('vue-i18n')>(),
  useI18n: () => ({ t: (key: string) => key }),
}))

const diff: FileDiff = {
  old_path: 'src/app.ts',
  new_path: 'src/app.ts',
  is_binary: false,
  hunks: [],
  additions: 1,
  deletions: 1,
  encoding: 'UTF-8',
}

function mountToolbar(previewKind: 'pdf' | null = null) {
  return mount(DiffToolbar, {
    props: {
      diff,
      isImageView: false,
      previewKind,
      svgTextMode: false,
      currentChangeIdx: -1,
      changeCount: 0,
      'onUpdate:svgTextMode': () => {},
    },
  })
}

describe('DiffToolbar whitespace toggle', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('toggles the persisted text-diff preference with a discoverable title', async () => {
    const wrapper = mountToolbar()
    const button = wrapper.find('.btn-ignore-whitespace')

    expect(button.attributes('title')).toBe('diff.toolbar.ignoreWhitespace')
    await button.trigger('click')

    expect(useUiStore().diffIgnoreWhitespace).toBe(true)
    expect(button.classes()).toContain('active')
    expect(button.attributes('title')).toBe('diff.toolbar.showWhitespace')
  })

  it('does not offer a raw-diff filter for document previews', () => {
    expect(mountToolbar('pdf').find('.btn-ignore-whitespace').exists()).toBe(false)
  })
})
