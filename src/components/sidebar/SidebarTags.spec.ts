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
  routerPush: vi.fn(),
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (key === 'sidebar.tag.forcePushPreview') {
        return `${params?.name} ${params?.remote} ${params?.remoteOid} -> ${params?.localOid}`
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
  useGlobalToast: () => ({ showError: mocks.showError }),
}))
vi.mock('@/composables/useSidebarSectionState', () => ({
  useSidebarSectionState: () => ({
    isCollapsed: () => false,
    toggle: vi.fn(),
  }),
}))

async function selectTagAction(action: 'push' | 'push-force') {
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
    mocks.git.listRemoteTags.mockReset()
    mocks.git.pushTag.mockReset().mockResolvedValue(undefined)
    mocks.pickRemote.mockReset().mockResolvedValue('origin')
    mocks.showError.mockReset()
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
})
