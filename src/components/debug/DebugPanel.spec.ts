import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DebugPanel from './DebugPanel.vue'

const mocks = vi.hoisted(() => ({
  debugStore: {
    entries: [
      { id: 2, ts: 2, op: 'fetch_remote', status: 'ok' as const },
      { id: 1, ts: 1, op: 'get_status', status: 'pending' as const },
    ],
    logEntries: [],
    clear: vi.fn(),
    clearLogs: vi.fn(),
  },
  toggleDebugPanel: vi.fn(),
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))
vi.mock('@/stores/debug', () => ({ useDebugStore: () => mocks.debugStore }))
vi.mock('@/stores/ui', () => ({
  useUiStore: () => ({ toggleDebugPanel: mocks.toggleDebugPanel }),
}))

describe('DebugPanel command navigation', () => {
  beforeEach(() => {
    mocks.toggleDebugPanel.mockReset()
    Element.prototype.scrollIntoView = vi.fn()
  })

  it('exposes command details through disclosure buttons', async () => {
    const wrapper = mount(DebugPanel)
    const rows = wrapper.findAll<HTMLButtonElement>('.debug-row')

    expect(rows[0]?.element.tagName).toBe('BUTTON')
    expect(rows[0]?.attributes('aria-expanded')).toBe('false')

    await rows[0]?.trigger('click')

    expect(rows[0]?.attributes('aria-expanded')).toBe('true')
    expect(rows[0]?.attributes('aria-controls')).toBe('debug-command-detail-2')
    expect(wrapper.find('#debug-command-detail-2').exists()).toBe(true)
  })

  it('moves focus between command rows with arrow keys', async () => {
    const wrapper = mount(DebugPanel, { attachTo: document.body })
    const list = wrapper.find<HTMLElement>('.debug-list')
    const rows = wrapper.findAll<HTMLButtonElement>('.debug-row')

    await list.trigger('keydown', { key: 'ArrowDown' })
    await wrapper.vm.$nextTick()

    expect(rows[0]?.attributes('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(rows[0]?.element)

    await rows[0]?.trigger('keydown', { key: 'ArrowDown' })
    await wrapper.vm.$nextTick()

    expect(rows[1]?.attributes('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(rows[1]?.element)
    wrapper.unmount()
  })
})
