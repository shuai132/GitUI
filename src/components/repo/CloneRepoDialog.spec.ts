import { defineComponent, nextTick } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CloneRepoDialog from './CloneRepoDialog.vue'
import { CLONE_PARENT_DIR_KEY } from '@/utils/clonePreferences'

const cloneMocks = vi.hoisted(() => ({
  cloneRepo: vi.fn(async () => {}),
  unlisten: vi.fn(),
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async () => cloneMocks.unlisten),
}))

vi.mock('@/stores/repos', () => ({
  useRepoStore: () => ({ cloneRepo: cloneMocks.cloneRepo }),
}))

const ModalStub = defineComponent({
  props: { visible: Boolean },
  template: '<div v-if="visible"><slot /><slot name="footer" /></div>',
})

describe('CloneRepoDialog', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('reuses changes to the most recent parent directory when reopened', async () => {
    localStorage.setItem(CLONE_PARENT_DIR_KEY, '/Users/me/old-work')
    const wrapper = mount(CloneRepoDialog, {
      attachTo: document.body,
      props: { visible: true },
      global: { stubs: { Modal: ModalStub } },
    })
    await nextTick()

    const parentInput = wrapper.find<HTMLInputElement>('.path-picker input')
    expect(parentInput.element.value).toBe('/Users/me/old-work')

    await parentInput.setValue('/Users/me/new-work')
    await parentInput.trigger('change')
    expect(localStorage.getItem(CLONE_PARENT_DIR_KEY)).toBe('/Users/me/new-work')

    await wrapper.setProps({ visible: false })
    await wrapper.setProps({ visible: true })
    await nextTick()
    expect(wrapper.find<HTMLInputElement>('.path-picker input').element.value).toBe(
      '/Users/me/new-work',
    )
    wrapper.unmount()
  })

  it('keeps the parent directory empty after the user clears it', async () => {
    localStorage.setItem(CLONE_PARENT_DIR_KEY, '/Users/me/work')
    const wrapper = mount(CloneRepoDialog, {
      props: { visible: true },
      global: { stubs: { Modal: ModalStub } },
    })
    const parentInput = wrapper.find<HTMLInputElement>('.path-picker input')

    await parentInput.setValue('')
    await parentInput.trigger('change')
    await wrapper.setProps({ visible: false })
    await wrapper.setProps({ visible: true })
    await nextTick()

    expect(localStorage.getItem(CLONE_PARENT_DIR_KEY)).toBeNull()
    expect(wrapper.find<HTMLInputElement>('.path-picker input').element.value).toBe('')
    wrapper.unmount()
  })

  it.each(['0', '-1', '1.5', '2147483648'])(
    'blocks invalid shallow depth %s instead of silently doing a full clone',
    async (depth) => {
      const wrapper = mount(CloneRepoDialog, {
        props: { visible: true },
        global: { stubs: { Modal: ModalStub } },
      })
      await wrapper.find<HTMLInputElement>('.form-row input[type="text"]').setValue(
        'https://example.com/repo.git',
      )
      await wrapper.find<HTMLInputElement>('.path-picker input').setValue('/repos')
      await wrapper.find<HTMLInputElement>('input[type="number"]').setValue(depth)

      expect(wrapper.find('.form-error').text()).toBe('repo.clone.errors.depthInvalid')
      expect(wrapper.find<HTMLButtonElement>('.btn-primary').attributes('disabled')).toBeDefined()
      await wrapper.find('.btn-primary').trigger('click')
      expect(cloneMocks.cloneRepo).not.toHaveBeenCalled()
      wrapper.unmount()
    },
  )

  it('passes a valid positive integer depth to the clone request', async () => {
    const wrapper = mount(CloneRepoDialog, {
      props: { visible: true },
      global: { stubs: { Modal: ModalStub } },
    })
    await wrapper.find<HTMLInputElement>('.form-row input[type="text"]').setValue(
      'https://example.com/repo.git',
    )
    await wrapper.find<HTMLInputElement>('.path-picker input').setValue('/repos')
    await wrapper.find<HTMLInputElement>('input[type="number"]').setValue('25')

    await wrapper.find('.btn-primary').trigger('click')
    await flushPromises()

    expect(cloneMocks.cloneRepo).toHaveBeenCalledWith(expect.objectContaining({ depth: 25 }))
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })
})
