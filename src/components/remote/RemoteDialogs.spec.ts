import { defineComponent, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AddRemoteDialog from './AddRemoteDialog.vue'
import EditRemoteDialog from './EditRemoteDialog.vue'

const mocks = vi.hoisted(() => ({
  repo: { activeRepoId: 'repo-a' as string | null },
  addRemote: vi.fn(),
  editRemote: vi.fn(),
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))
vi.mock('@/stores/repos', () => ({ useRepoStore: () => mocks.repo }))
vi.mock('@/composables/useGitCommands', () => ({
  useGitCommands: () => ({
    addRemote: mocks.addRemote,
    editRemote: mocks.editRemote,
  }),
}))

const ModalStub = defineComponent({
  props: { visible: Boolean },
  template: '<div v-if="visible"><slot /><slot name="footer" /></div>',
})

describe('Remote dialogs repository context', () => {
  beforeEach(() => {
    mocks.repo.activeRepoId = 'repo-a'
    mocks.addRemote.mockReset().mockResolvedValue(undefined)
    mocks.editRemote.mockReset().mockResolvedValue(undefined)
  })

  it('keeps Add input and refuses to apply it to a newly active repository', async () => {
    const wrapper = mount(AddRemoteDialog, {
      props: { visible: false },
      global: { stubs: { Modal: ModalStub } },
    })
    await wrapper.setProps({ visible: true })
    const inputs = wrapper.findAll<HTMLInputElement>('input')
    await inputs[0].setValue('upstream')
    await inputs[1].setValue('https://example.com/upstream.git')
    mocks.repo.activeRepoId = 'repo-b'

    await wrapper.find('.btn-primary').trigger('click')

    expect(mocks.addRemote).not.toHaveBeenCalled()
    expect(wrapper.find('.form-error').text()).toBe('remote.formContextChanged')
    expect(inputs[0].element.value).toBe('upstream')
    expect(inputs[1].element.value).toBe('https://example.com/upstream.git')

    mocks.repo.activeRepoId = 'repo-a'
    await wrapper.find('.btn-primary').trigger('click')
    await nextTick()

    expect(mocks.addRemote).toHaveBeenCalledWith(
      'repo-a',
      'upstream',
      'https://example.com/upstream.git',
    )
  })

  it('freezes the original Edit target and expected URL', async () => {
    const wrapper = mount(EditRemoteDialog, {
      props: {
        visible: false,
        target: { name: 'origin', url: 'https://example.com/old.git' },
      },
      global: { stubs: { Modal: ModalStub } },
    })
    await wrapper.setProps({ visible: true })
    const inputs = wrapper.findAll<HTMLInputElement>('input')
    await inputs[0].setValue('upstream')
    await inputs[1].setValue('https://example.com/new.git')
    mocks.repo.activeRepoId = 'repo-b'

    await wrapper.find('.btn-primary').trigger('click')

    expect(mocks.editRemote).not.toHaveBeenCalled()
    expect(wrapper.find('.form-error').text()).toBe('remote.formContextChanged')
    expect(inputs[1].element.value).toBe('https://example.com/new.git')

    mocks.repo.activeRepoId = 'repo-a'
    await wrapper.find('.btn-primary').trigger('click')
    await nextTick()

    expect(mocks.editRemote).toHaveBeenCalledWith(
      'repo-a',
      'origin',
      'upstream',
      'https://example.com/new.git',
      'https://example.com/old.git',
    )
  })
})
