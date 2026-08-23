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

  it('guides the first-line summary length without counting the body twice', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const wrapper = mount(WipCommitBox, {
      props: { isUnborn: false, stagedCount: 1 },
      global: { plugins: [pinia] },
    })
    const input = wrapper.find<HTMLTextAreaElement>('.message-input')
    const counter = wrapper.find('.summary-counter')

    await input.setValue('a'.repeat(50))
    expect(counter.text()).toBe('50/50')
    expect(counter.classes()).toContain('summary-counter--normal')

    await input.setValue('a'.repeat(51))
    expect(counter.text()).toBe('51/50')
    expect(counter.classes()).toContain('summary-counter--warning')

    await input.setValue('a'.repeat(72))
    expect(counter.classes()).toContain('summary-counter--warning')

    await input.setValue('a'.repeat(73))
    expect(counter.classes()).toContain('summary-counter--danger')

    await input.setValue(`😀中文\n\n${'body'.repeat(30)}`)
    expect(counter.text()).toBe('3/50')
    expect(counter.attributes('title')).toBe('workspace.commit.summaryLengthHint')
  })

  it('disables regular commit and amend while another Git operation is active', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const wrapper = mount(WipCommitBox, {
      props: { isUnborn: false, stagedCount: 1, operationInProgress: true },
      global: { plugins: [pinia] },
    })
    await wrapper.find<HTMLTextAreaElement>('.message-input').setValue('message')

    expect(wrapper.find<HTMLButtonElement>('.btn-commit').element.disabled).toBe(true)
    expect(wrapper.find('.btn-commit').text()).toBe('workspace.commit.button.finishOperation')
    expect(wrapper.find<HTMLInputElement>('.amend-row input').element.disabled).toBe(true)
  })
})
