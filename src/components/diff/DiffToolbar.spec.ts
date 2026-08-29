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

function mountToolbar(previewKind: 'pdf' | null = null, fileDiff: FileDiff = diff) {
  return mount(DiffToolbar, {
    props: {
      diff: fileDiff,
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

  it('keeps the diff search entry in the keyboard tab order', async () => {
    const wrapper = mountToolbar()
    const searchButton = wrapper.find<HTMLButtonElement>('.search-icon-btn')

    expect(searchButton.attributes('tabindex')).toBeUndefined()
    expect(searchButton.attributes('aria-expanded')).toBe('false')
    expect(searchButton.attributes('aria-controls')).toBe('diff-search-input')

    await searchButton.trigger('click')

    expect(searchButton.attributes('aria-expanded')).toBe('true')
    expect(wrapper.find('#diff-search-input').isVisible()).toBe(true)
  })

  it('labels search result navigation with localized text', () => {
    const wrapper = mountToolbar()
    const buttons = wrapper.findAll('.search-nav-btn')

    expect(buttons[0]?.attributes('title')).toBe('diff.toolbar.prevSearchResult')
    expect(buttons[0]?.attributes('aria-label')).toBe('diff.toolbar.prevSearchResult')
    expect(buttons[1]?.attributes('title')).toBe('diff.toolbar.nextSearchResult')
    expect(buttons[1]?.attributes('aria-label')).toBe('diff.toolbar.nextSearchResult')
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

  it('shows both paths for a renamed file', () => {
    const wrapper = mountToolbar(null, {
      ...diff,
      old_path: '.agents/skills/deploy-rv1106/SKILL.md',
      new_path: '.agents/skills/deploy/SKILL.md',
    })
    const path = wrapper.find('.diff-file-path')

    expect(path.text()).toBe(
      '.agents/skills/deploy-rv1106/SKILL.md → .agents/skills/deploy/SKILL.md',
    )
    expect(path.attributes('title')).toBe(path.text())
  })
})
