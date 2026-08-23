import { mount } from '@vue/test-utils'
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
}))

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/stores/errors', () => ({ useErrorsStore: () => mocks.errors }))

describe('ErrorHistoryDialog clear confirmation', () => {
  beforeEach(() => {
    mocks.errors.clear.mockReset()
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
})
