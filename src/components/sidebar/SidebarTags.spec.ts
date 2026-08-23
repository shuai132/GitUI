import { flushPromises, shallowMount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TagInfo } from '@/types/git'
import ConfirmDialog from '@/components/common/ConfirmDialog.vue'
import ContextMenu from '@/components/common/ContextMenu.vue'
import SidebarTags from './SidebarTags.vue'

const localTag: TagInfo = {
  name: 'v1.0.0',
  ref_oid: '1111111111111111111111111111111111111111',
  commit_oid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  is_annotated: true,
  message: 'release',
}

const mocks = vi.hoisted(() => ({
  repo: { activeRepoId: 'repo-a' as string | null },
  history: {
    tags: [] as TagInfo[],
    remoteTagsChecked: true,
    remoteTagNames: new Set<string>(),
    pendingJumpOid: null as string | null,
    markTagPushed: vi.fn(),
    loadTags: vi.fn(),
    loadRemoteTags: vi.fn(),
    deleteTag: vi.fn(),
    deleteRemoteTag: vi.fn(),
  },
  git: {
    listRemoteTags: vi.fn(),
    pushTag: vi.fn(),
    fetchTagsFromRemote: vi.fn(),
  },
  pickRemote: vi.fn(),
  showError: vi.fn(),
  showToast: vi.fn(),
  routerPush: vi.fn(),
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (key === 'sidebar.tag.forcePushPreview') {
        return `${params?.name} ${params?.remote} ${params?.remoteOid} -> ${params?.localOid}`
      }
      if (key === 'sidebar.tag.confirmDeleteRemote') {
        return `delete ${params?.name} ${params?.oid} from ${params?.remote}`
      }
      if (key === 'common.operationFailed') return `failed ${params?.detail}`
      return key
    },
  }),
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: mocks.routerPush }),
}))
vi.mock('@/stores/repos', () => ({ useRepoStore: () => mocks.repo }))
vi.mock('@/stores/history', () => ({ useHistoryStore: () => mocks.history }))
vi.mock('@/composables/usePickRemote', () => ({
  usePickRemote: () => ({ pickRemote: mocks.pickRemote }),
}))
vi.mock('@/composables/useGitCommands', () => ({
  useGitCommands: () => mocks.git,
}))
vi.mock('@/composables/useGlobalToast', () => ({
  useGlobalToast: () => ({
    showError: mocks.showError,
    showToast: mocks.showToast,
    showActionError: (error: unknown, fallback?: string) =>
      mocks.showError(fallback ?? String(error)),
  }),
}))
vi.mock('@/composables/useSidebarSectionState', () => ({
  useSidebarSectionState: () => ({
    isCollapsed: () => false,
    toggle: vi.fn(),
  }),
}))

async function selectTagAction(action: 'push' | 'push-force' | 'delete' | 'delete-remote') {
  const wrapper = shallowMount(SidebarTags)
  await wrapper.find('.tag-item').trigger('contextmenu')
  wrapper.findComponent(ContextMenu).vm.$emit('select', action)
  await flushPromises()
  return wrapper
}

describe('SidebarTags guarded push', () => {
  beforeEach(() => {
    mocks.repo.activeRepoId = 'repo-a'
    mocks.history.tags = [{ ...localTag }]
    mocks.history.remoteTagNames = new Set()
    mocks.history.markTagPushed.mockReset()
    mocks.history.deleteTag.mockReset().mockResolvedValue(undefined)
    mocks.history.deleteRemoteTag.mockReset().mockResolvedValue(undefined)
    mocks.git.listRemoteTags.mockReset()
    mocks.git.pushTag.mockReset().mockResolvedValue(undefined)
    mocks.pickRemote.mockReset().mockResolvedValue('origin')
    mocks.showError.mockReset()
    mocks.showToast.mockReset()
    mocks.routerPush.mockReset()
    mocks.history.pendingJumpOid = null
  })

  it('uses a native button to jump to a tag commit from the keyboard', async () => {
    const wrapper = shallowMount(SidebarTags)
    const tagButton = wrapper.find<HTMLButtonElement>('.tag-item')

    expect(tagButton.element.tagName).toBe('BUTTON')
    await tagButton.trigger('click')

    expect(mocks.history.pendingJumpOid).toBe(localTag.commit_oid)
    expect(mocks.routerPush).toHaveBeenCalledWith('/history')
  })

  it('guards a normal push with the selected local ref OID', async () => {
    await selectTagAction('push')

    expect(mocks.git.pushTag).toHaveBeenCalledWith(
      'repo-a',
      'origin',
      'v1.0.0',
      false,
      localTag.ref_oid,
    )
  })

  it('uses a normal push when force was requested but the remote tag is absent', async () => {
    mocks.git.listRemoteTags.mockResolvedValue([])
    const wrapper = await selectTagAction('push-force')

    expect(wrapper.findComponent(ConfirmDialog).props('visible')).toBe(false)
    expect(mocks.git.pushTag).toHaveBeenCalledWith(
      'repo-a',
      'origin',
      'v1.0.0',
      false,
      localTag.ref_oid,
    )
  })

  it('uses a normal push when the remote already has the exact tag object', async () => {
    mocks.git.listRemoteTags.mockResolvedValue([{ ...localTag }])
    const wrapper = await selectTagAction('push-force')

    expect(wrapper.findComponent(ConfirmDialog).props('visible')).toBe(false)
    expect(mocks.git.pushTag).toHaveBeenCalledWith(
      'repo-a',
      'origin',
      'v1.0.0',
      false,
      localTag.ref_oid,
    )
  })

  it('shows exact remote and local objects before overwriting a different tag', async () => {
    const remoteTag = {
      ...localTag,
      ref_oid: '2222222222222222222222222222222222222222',
    }
    mocks.git.listRemoteTags.mockResolvedValue([remoteTag])
    const wrapper = await selectTagAction('push-force')
    const dialog = wrapper.findComponent(ConfirmDialog)

    expect(mocks.git.pushTag).not.toHaveBeenCalled()
    expect(dialog.props()).toMatchObject({
      visible: true,
      danger: true,
      message: 'v1.0.0 origin 2222222 -> 1111111',
    })

    dialog.vm.$emit('confirm')
    await flushPromises()
    expect(mocks.git.pushTag).toHaveBeenCalledWith(
      'repo-a',
      'origin',
      'v1.0.0',
      true,
      localTag.ref_oid,
      remoteTag.ref_oid,
      true,
    )
  })

  it('cancels a confirmed force push after the repository changes', async () => {
    mocks.git.listRemoteTags.mockResolvedValue([{
      ...localTag,
      ref_oid: '2222222222222222222222222222222222222222',
    }])
    const wrapper = await selectTagAction('push-force')
    mocks.repo.activeRepoId = 'repo-b'

    wrapper.findComponent(ConfirmDialog).vm.$emit('confirm')
    await flushPromises()

    expect(mocks.git.pushTag).not.toHaveBeenCalled()
    expect(mocks.showError).toHaveBeenCalledWith(
      'failed Error: sidebar.tag.contextChanged',
    )
  })

  it('guards local tag deletion with the selected ref OID', async () => {
    const wrapper = await selectTagAction('delete')

    wrapper.findComponent(ConfirmDialog).vm.$emit('confirm')
    await flushPromises()

    expect(mocks.history.deleteTag).toHaveBeenCalledWith('v1.0.0', localTag.ref_oid)
  })

  it('selects and previews the exact remote tag before remote-only deletion', async () => {
    const remoteTag = {
      ...localTag,
      ref_oid: '2222222222222222222222222222222222222222',
    }
    mocks.history.remoteTagNames = new Set(['v1.0.0'])
    mocks.git.listRemoteTags.mockResolvedValue([remoteTag])
    const wrapper = await selectTagAction('delete-remote')
    const dialog = wrapper.findComponent(ConfirmDialog)

    expect(dialog.props('message')).toBe('delete v1.0.0 2222222 from origin')
    expect(mocks.history.deleteRemoteTag).not.toHaveBeenCalled()

    dialog.vm.$emit('confirm')
    await flushPromises()
    expect(mocks.history.deleteRemoteTag).toHaveBeenCalledWith(
      'v1.0.0',
      'origin',
      remoteTag.ref_oid,
    )
  })

  it('deletes the remote before local when both were selected', async () => {
    const order: string[] = []
    const remoteTag = {
      ...localTag,
      ref_oid: '2222222222222222222222222222222222222222',
    }
    mocks.history.remoteTagNames = new Set(['v1.0.0'])
    mocks.git.listRemoteTags.mockResolvedValue([remoteTag])
    mocks.history.deleteRemoteTag.mockImplementation(async () => { order.push('remote') })
    mocks.history.deleteTag.mockImplementation(async () => { order.push('local') })
    const wrapper = await selectTagAction('delete')
    const dialog = wrapper.findComponent(ConfirmDialog)
    dialog.vm.$emit('update:checkboxValue', true)
    await flushPromises()

    dialog.vm.$emit('confirm')
    await flushPromises()

    expect(order).toEqual(['remote', 'local'])
    expect(mocks.history.deleteRemoteTag).toHaveBeenCalledWith(
      'v1.0.0',
      'origin',
      remoteTag.ref_oid,
    )
    expect(mocks.history.deleteTag).toHaveBeenCalledWith('v1.0.0', localTag.ref_oid)
  })

  it('keeps the local tag when remote selection for combined deletion is cancelled', async () => {
    mocks.history.remoteTagNames = new Set(['v1.0.0'])
    mocks.pickRemote.mockResolvedValue(null)
    const wrapper = await selectTagAction('delete')
    const dialog = wrapper.findComponent(ConfirmDialog)
    dialog.vm.$emit('update:checkboxValue', true)
    await flushPromises()

    dialog.vm.$emit('confirm')
    await flushPromises()

    expect(mocks.history.deleteRemoteTag).not.toHaveBeenCalled()
    expect(mocks.history.deleteTag).not.toHaveBeenCalled()
    expect(mocks.showToast).toHaveBeenCalledWith(
      'warning',
      'sidebar.tag.deleteCancelled',
    )
  })
})
