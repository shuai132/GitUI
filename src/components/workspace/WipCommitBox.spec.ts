import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import WipCommitBox from './WipCommitBox.vue'
import { useUiStore } from '@/stores/ui'

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
  useGitCommands: () => ({}),
}))

describe('WipCommitBox', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('focuses the commit message at the end of the draft when requested', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const wrapper = mount(WipCommitBox, {
      attachTo: document.body,
      props: { isUnborn: false, stagedCount: 1 },
      global: { plugins: [pinia] },
    })
    const input = wrapper.find<HTMLTextAreaElement>('.message-input')
    await input.setValue('keep this draft')
    input.element.blur()

    useUiStore().requestFocusCommitMessage()
    await nextTick()
    await nextTick()

    expect(document.activeElement).toBe(input.element)
    expect(input.element.selectionStart).toBe(input.element.value.length)
    wrapper.unmount()
  })
})
