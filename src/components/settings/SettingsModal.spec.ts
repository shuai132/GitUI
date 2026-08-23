import { defineComponent, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsModal from './SettingsModal.vue'

const mocks = vi.hoisted(() => ({
  settings: {
    resetAppearance: vi.fn(),
    resetUiFont: vi.fn(),
    resetCodeFont: vi.fn(),
    resetExternalTools: vi.fn(),
  },
}))

vi.mock('vue-i18n', async (importOriginal) => ({
  ...await importOriginal<typeof import('vue-i18n')>(),
  useI18n: () => ({ t: (key: string) => key }),
}))
vi.mock('@/stores/settings', () => ({
  useSettingsStore: () => mocks.settings,
}))

const ModalStub = defineComponent({
  props: { visible: Boolean },
  template: '<section v-if="visible"><slot /><slot name="footer" /></section>',
})

describe('SettingsModal tabs', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('exposes a vertical tabset with roving keyboard focus', async () => {
    const wrapper = mount(SettingsModal, {
      attachTo: document.body,
      props: { visible: true },
      global: {
        stubs: {
          Modal: ModalStub,
          AppearanceSection: true,
          FontSection: true,
          ExternalToolsSection: true,
          AdvancedSection: true,
          ShortcutsSection: true,
          PluginsSection: true,
          UpdateSection: true,
          AboutInfo: true,
        },
      },
    })
    const tabList = wrapper.find('[role="tablist"]')
    const tabs = wrapper.findAll<HTMLButtonElement>('[role="tab"]')

    expect(tabList.attributes('aria-orientation')).toBe('vertical')
    expect(tabs).toHaveLength(8)
    expect(tabs[0]?.attributes('aria-selected')).toBe('true')
    expect(tabs[0]?.attributes('tabindex')).toBe('0')
    expect(tabs[1]?.attributes('tabindex')).toBe('-1')

    tabs[0]?.element.focus()
    await tabs[0]?.trigger('keydown', { key: 'ArrowDown' })
    await nextTick()

    expect(document.activeElement).toBe(tabs[1]?.element)
    expect(tabs[1]?.attributes('aria-selected')).toBe('true')
    expect(wrapper.find('[role="tabpanel"]').attributes('aria-labelledby')).toBe(
      tabs[1]?.attributes('id'),
    )

    await tabs[1]?.trigger('keydown', { key: 'End' })
    await nextTick()
    expect(document.activeElement).toBe(tabs[7]?.element)
    expect(tabs[7]?.attributes('aria-selected')).toBe('true')

    wrapper.unmount()
  })
})
