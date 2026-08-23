import { flushPromises, shallowMount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SubmoduleInfo } from '@/types/git'
import ConfirmDialog from '@/components/common/ConfirmDialog.vue'
import ContextMenu from '@/components/common/ContextMenu.vue'
import SidebarSubmodules from './SidebarSubmodules.vue'

const submodule: SubmoduleInfo = {
  name: 'vendor/demo',
  path: 'vendor/demo',
  url: 'https://example.com/demo.git',
  head_oid: '1111111111111111111111111111111111111111',
  workdir_oid: '1111111111111111111111111111111111111111',
  state: 'modified',
  has_workdir_modifications: true,
}

const mocks = vi.hoisted(() => ({
  repo: {
    activeRepoId: 'repo-a' as string | null,
    openRepo: vi.fn(),
  },
  submodules: {
    submodules: [] as SubmoduleInfo[],
    init: vi.fn(),
    update: vi.fn(),
    deinit: vi.fn(),
    workdir: vi.fn(),
    loadSubmodules: vi.fn(),
  },
  showError: vi.fn(),
  showActionError: vi.fn(),
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      `${key} ${Object.values(params ?? {}).join(' ')}`.trim(),
  }),
}))
vi.mock('@/stores/repos', () => ({ useRepoStore: () => mocks.repo }))
vi.mock('@/stores/submodules', () => ({
  useSubmodulesStore: () => mocks.submodules,
}))
vi.mock('@/components/submodule/AddSubmoduleDialog.vue', () => ({
  default: { template: '<div />' },
}))
vi.mock('@/components/submodule/EditSubmoduleDialog.vue', () => ({
  default: { template: '<div />' },
}))
vi.mock('@/composables/useSidebarSectionState', () => ({
  useSidebarSectionState: () => ({
    isCollapsed: () => false,
    toggle: vi.fn(),
  }),
}))
vi.mock('@/composables/useGlobalToast', () => ({
  useGlobalToast: () => ({
    showError: mocks.showError,
    showActionError: mocks.showActionError,
  }),
}))

async function requestDelete() {
  const wrapper = shallowMount(SidebarSubmodules)
  await wrapper.find('.submodule-item').trigger('contextmenu')
  wrapper.findComponent(ContextMenu).vm.$emit('select', 'delete')
  await flushPromises()
  return wrapper
}

describe('SidebarSubmodules guarded removal', () => {
  beforeEach(() => {
    mocks.repo.activeRepoId = 'repo-a'
    mocks.submodules.submodules = [{ ...submodule }]
    mocks.submodules.deinit.mockReset().mockResolvedValue(undefined)
    mocks.submodules.init.mockReset().mockResolvedValue(undefined)
    mocks.submodules.update.mockReset().mockResolvedValue(undefined)
    mocks.submodules.workdir.mockReset().mockResolvedValue('/repos/demo')
    mocks.repo.openRepo.mockReset().mockResolvedValue(undefined)
    mocks.showError.mockReset()
    mocks.showActionError.mockReset()
  })

  it('warns about uncommitted changes and deletes the confirmed repository target', async () => {
    const wrapper = await requestDelete()
    const dialog = wrapper.findComponent(ConfirmDialog)

    expect(dialog.props('message')).toContain(
      'submodule.confirmDelete.dirtyMessage',
    )
    expect(dialog.props('message')).toContain('vendor/demo')

    dialog.vm.$emit('confirm')
    await flushPromises()

    expect(mocks.submodules.deinit).toHaveBeenCalledWith(
      'repo-a',
      'vendor/demo',
    )
  })

  it('uses the standard recoverable-removal message for a clean submodule', async () => {
    mocks.submodules.submodules = [{
      ...submodule,
      state: 'up_to_date',
      has_workdir_modifications: false,
    }]

    const wrapper = await requestDelete()

    expect(wrapper.findComponent(ConfirmDialog).props('message')).toContain(
      'submodule.confirmDelete.message',
    )
  })

  it('cancels the pending removal after the active repository changes', async () => {
    const wrapper = await requestDelete()
    mocks.repo.activeRepoId = 'repo-b'

    wrapper.findComponent(ConfirmDialog).vm.$emit('confirm')
    await flushPromises()

    expect(mocks.submodules.deinit).not.toHaveBeenCalled()
    expect(mocks.showError).toHaveBeenCalled()
  })

  it('cancels the pending removal after the submodule state changes', async () => {
    const wrapper = await requestDelete()
    mocks.submodules.submodules = [{
      ...submodule,
      workdir_oid: '2222222222222222222222222222222222222222',
    }]

    wrapper.findComponent(ConfirmDialog).vm.$emit('confirm')
    await flushPromises()

    expect(mocks.submodules.deinit).not.toHaveBeenCalled()
    expect(mocks.showError).toHaveBeenCalled()
  })

  it('runs Update against the repository that opened the menu', async () => {
    const wrapper = shallowMount(SidebarSubmodules)
    await wrapper.find('.submodule-item').trigger('contextmenu')

    wrapper.findComponent(ContextMenu).vm.$emit('select', 'update')
    await flushPromises()

    expect(mocks.submodules.update).toHaveBeenCalledWith('repo-a', 'vendor/demo')
  })

  it('cancels a menu action after switching repositories', async () => {
    const wrapper = shallowMount(SidebarSubmodules)
    await wrapper.find('.submodule-item').trigger('contextmenu')
    mocks.repo.activeRepoId = 'repo-b'

    wrapper.findComponent(ContextMenu).vm.$emit('select', 'update')
    await flushPromises()

    expect(mocks.submodules.update).not.toHaveBeenCalled()
    expect(mocks.showError).toHaveBeenCalled()
  })

  it('does not activate a submodule after its parent repository changes', async () => {
    let resolveWorkdir!: (path: string) => void
    mocks.submodules.workdir.mockReturnValue(new Promise((resolve) => {
      resolveWorkdir = resolve
    }))
    const wrapper = shallowMount(SidebarSubmodules)

    await wrapper.find('.submodule-main').trigger('click')
    expect(mocks.submodules.workdir).toHaveBeenCalledWith('repo-a', 'vendor/demo')
    mocks.repo.activeRepoId = 'repo-b'
    resolveWorkdir('/repos/demo')
    await flushPromises()

    expect(mocks.repo.openRepo).not.toHaveBeenCalled()
    expect(mocks.showError).toHaveBeenCalled()
  })

  it('separates keyboard opening from the labeled menu button', async () => {
    const wrapper = shallowMount(SidebarSubmodules)
    const openButton = wrapper.find<HTMLButtonElement>('.submodule-main')
    const menuButton = wrapper.find<HTMLButtonElement>('.submodule-kebab')

    expect(openButton.element.tagName).toBe('BUTTON')
    expect(openButton.element.disabled).toBe(false)
    expect(menuButton.attributes('aria-label')).toContain('sidebar.submodule.menuTitle')

    await openButton.trigger('click')
    await flushPromises()
    expect(mocks.repo.openRepo).toHaveBeenCalledWith('/repos/demo')
  })
})
