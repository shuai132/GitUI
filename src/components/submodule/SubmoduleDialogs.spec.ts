import { defineComponent, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AddSubmoduleDialog from './AddSubmoduleDialog.vue'
import EditSubmoduleDialog from './EditSubmoduleDialog.vue'

const mocks = vi.hoisted(() => ({
  repo: { activeRepoId: 'repo-a' as string | null },
  addSubmodule: vi.fn(),
  setUrl: vi.fn(),
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))
vi.mock('@/stores/repos', () => ({ useRepoStore: () => mocks.repo }))
vi.mock('@/stores/submodules', () => ({
  useSubmodulesStore: () => ({ setUrl: mocks.setUrl }),
}))
vi.mock('@/composables/useGitCommands', () => ({
  useGitCommands: () => ({ addSubmodule: mocks.addSubmodule }),
}))

const ModalStub = defineComponent({
  props: { visible: Boolean },
  template: '<div v-if="visible"><slot /><slot name="footer" /></div>',
})

describe('Submodule dialogs repository context', () => {
  beforeEach(() => {
    mocks.repo.activeRepoId = 'repo-a'
    mocks.addSubmodule.mockReset().mockResolvedValue(undefined)
    mocks.setUrl.mockReset().mockResolvedValue(undefined)
  })

  it('keeps Add input and refuses to apply it to a newly active repository', async () => {
    const wrapper = mount(AddSubmoduleDialog, {
      props: { visible: false },
      global: { stubs: { Modal: ModalStub } },
    })
    await wrapper.setProps({ visible: true })
    const inputs = wrapper.findAll<HTMLInputElement>('input')
    await inputs[0].setValue('https://example.com/demo.git')
    await inputs[1].setValue('vendor/demo')
    mocks.repo.activeRepoId = 'repo-b'

    await wrapper.find('.btn-primary').trigger('click')

    expect(mocks.addSubmodule).not.toHaveBeenCalled()
    expect(wrapper.find('.form-error').text()).toBe(
      'submodule.formContextChanged',
    )
    expect(inputs[0].element.value).toBe('https://example.com/demo.git')
    expect(inputs[1].element.value).toBe('vendor/demo')

    mocks.repo.activeRepoId = 'repo-a'
    await wrapper.find('.btn-primary').trigger('click')
    await nextTick()

    expect(mocks.addSubmodule).toHaveBeenCalledWith(
      'repo-a',
      'https://example.com/demo.git',
      'vendor/demo',
    )
  })

  it('freezes the original Edit target and expected URL', async () => {
    const wrapper = mount(EditSubmoduleDialog, {
      props: {
        visible: false,
        submodule: {
          name: 'demo',
          path: 'vendor/demo',
          url: 'https://example.com/old.git',
          state: 'up_to_date',
          has_workdir_modifications: false,
        },
      },
      global: { stubs: { Modal: ModalStub } },
    })
    await wrapper.setProps({ visible: true })
    const input = wrapper.find<HTMLInputElement>('input')
    await input.setValue('https://example.com/new.git')
    mocks.repo.activeRepoId = 'repo-b'

    await wrapper.find('.btn-primary').trigger('click')

    expect(mocks.setUrl).not.toHaveBeenCalled()
    expect(wrapper.find('.form-error').text()).toBe(
      'submodule.formContextChanged',
    )
    expect(input.element.value).toBe('https://example.com/new.git')

    mocks.repo.activeRepoId = 'repo-a'
    await wrapper.find('.btn-primary').trigger('click')
    await nextTick()

    expect(mocks.setUrl).toHaveBeenCalledWith(
      'repo-a',
      'demo',
      'https://example.com/new.git',
      'https://example.com/old.git',
    )
  })
})
