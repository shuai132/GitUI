import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ConfirmDialog from './ConfirmDialog.vue'
import ErrorHistoryDialog from './ErrorHistoryDialog.vue'

const mocks = vi.hoisted(() => ({
  errors: {
    entries: [{
      id: 1,
      ts: 1,
      op: 'fetch_remote',
      friendly: 'Fetch failed',
      raw: 'network error',
      level: 'error' as const,
    }],
    clear: vi.fn(),
  },
  writeText: vi.fn(),
  showToast: vi.fn(),
  showActionError: vi.fn(),
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: { value: 'en' } }),
}))
vi.mock('@/stores/errors', () => ({ useErrorsStore: () => mocks.errors }))
vi.mock('@/composables/useGlobalToast', () => ({
  useGlobalToast: () => ({
    showToast: mocks.showToast,
    showActionError: mocks.showActionError,
  }),
}))

describe('ErrorHistoryDialog clear confirmation', () => {
  beforeEach(() => {
    mocks.errors.clear.mockReset()
    mocks.writeText.mockReset().mockResolvedValue(undefined)
    mocks.showToast.mockReset()
    mocks.showActionError.mockReset()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: mocks.writeText },
    })
  })

  it('clears history only after confirming in the app dialog', async () => {
    const wrapper = mount(ErrorHistoryDialog, {
      props: { visible: true },
      global: { stubs: { Teleport: true } },
    })
    await wrapper.find('.btn').trigger('click')
    const dialog = wrapper.findComponent(ConfirmDialog)

    expect(dialog.props()).toMatchObject({ visible: true, danger: true })
    expect(mocks.errors.clear).not.toHaveBeenCalled()
    dialog.vm.$emit('cancel')
    await wrapper.vm.$nextTick()
    expect(dialog.props('visible')).toBe(false)

    await wrapper.find('.btn').trigger('click')
    dialog.vm.$emit('confirm')
    await wrapper.vm.$nextTick()
    expect(mocks.errors.clear).toHaveBeenCalledOnce()
  })

  it('reports copy success without expanding the error row', async () => {
    const wrapper = mount(ErrorHistoryDialog, {
      props: { visible: true },
      global: { stubs: { Teleport: true } },
    })

    await wrapper.find('.err-copy').trigger('click')
    await flushPromises()

    expect(mocks.writeText).toHaveBeenCalledWith(
      '[fetch_remote] Fetch failed\n\nerrorHistory.rawErrorLabel\nnetwork error',
    )
    expect(mocks.showToast).toHaveBeenCalledWith('success', 'errorHistory.copySuccess')
    expect(wrapper.find('.err-raw').exists()).toBe(false)
  })

  it('exposes error details through a keyboard-accessible disclosure button', async () => {
    const wrapper = mount(ErrorHistoryDialog, {
      props: { visible: true },
      global: { stubs: { Teleport: true } },
    })
    const toggle = wrapper.find<HTMLButtonElement>('.err-toggle')

    expect(toggle.element.tagName).toBe('BUTTON')
    expect(toggle.attributes('aria-expanded')).toBe('false')
    expect(wrapper.find('.err-copy').attributes('aria-label')).toBe('errorHistory.copyTitle')

    await toggle.trigger('click')

    expect(toggle.attributes('aria-expanded')).toBe('true')
    expect(toggle.attributes('aria-controls')).toBe('error-detail-1')
    expect(wrapper.find('#error-detail-1').text()).toBe('network error')
  })

  it('shows a non-blocking action error when clipboard access fails', async () => {
    const clipboardError = new Error('clipboard denied')
    mocks.writeText.mockRejectedValue(clipboardError)
    const wrapper = mount(ErrorHistoryDialog, {
      props: { visible: true },
      global: { stubs: { Teleport: true } },
    })

    await wrapper.find('.err-copy').trigger('click')
    await flushPromises()

    expect(mocks.showActionError).toHaveBeenCalledWith(
      clipboardError,
      'errorHistory.copyFailed',
    )
    expect(mocks.showToast).not.toHaveBeenCalled()
  })
})
