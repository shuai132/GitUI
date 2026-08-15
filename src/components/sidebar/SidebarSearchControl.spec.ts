import { defineComponent, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import SidebarSearchControl from './SidebarSearchControl.vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

const Host = defineComponent({
  components: { SidebarSearchControl },
  setup() {
    const query = ref('')
    return { query }
  },
  template: `
    <SidebarSearchControl v-model="query" />
    <output>{{ query }}</output>
  `,
})

describe('SidebarSearchControl', () => {
  it('expands from the magnifier and updates the bound query', async () => {
    const wrapper = mount(Host, { attachTo: document.body })

    await wrapper.find('.sidebar-search-button').trigger('click')
    const input = wrapper.find<HTMLInputElement>('.sidebar-search-input')

    expect(input.element.style.display).not.toBe('none')
    expect(document.activeElement).toBe(input.element)

    await input.setValue('feature/login')
    expect(wrapper.find('output').text()).toBe('feature/login')
    wrapper.unmount()
  })

  it('clears and collapses on Escape', async () => {
    const wrapper = mount(Host)
    await wrapper.find('.sidebar-search-button').trigger('click')

    const input = wrapper.find<HTMLInputElement>('.sidebar-search-input')
    await input.setValue('release')
    await input.trigger('keydown', { key: 'Escape' })
    await nextTick()

    expect(wrapper.find('output').text()).toBe('')
    expect(input.element.style.display).toBe('none')
  })
})
