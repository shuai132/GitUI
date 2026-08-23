import { flushPromises, shallowMount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ConfirmDialog from './ConfirmDialog.vue'
import OngoingOpBanner from './OngoingOpBanner.vue'

type RefValue<T> = { __v_isRef: true; value: T }

function testRef<T>(value: T): RefValue<T> {
  return { __v_isRef: true, value }
}

const mocks = vi.hoisted(() => ({
  refs: {
    repoState: { __v_isRef: true, value: { kind: 'rebase' } },
    isOngoing: { __v_isRef: true, value: true },
    isMerging: { __v_isRef: true, value: false },
    isRebasing: { __v_isRef: true, value: true },
    isCherryPicking: { __v_isRef: true, value: false },
    isReverting: { __v_isRef: true, value: false },
    busy: { __v_isRef: true, value: false },
  },
  mr: {
    abortMerge: vi.fn(),
    abortRebase: vi.fn(),
    abortCherryPick: vi.fn(),
    abortRevert: vi.fn(),
    continueMerge: vi.fn(),
    continueRebase: vi.fn(),
    continueCherryPick: vi.fn(),
    continueRevert: vi.fn(),
    skipRebase: vi.fn(),
  },
  repo: { activeRepoId: 'repo-a' as string | null },
  workspace: { status: null },
  showError: vi.fn(),
}))

vi.mock('pinia', async (importOriginal) => {
  const actual = await importOriginal<typeof import('pinia')>()
  return { ...actual, storeToRefs: () => mocks.refs }
})
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/stores/mergeRebase', () => ({ useMergeRebaseStore: () => mocks.mr }))
vi.mock('@/stores/workspace', () => ({ useWorkspaceStore: () => mocks.workspace }))
vi.mock('@/stores/repos', () => ({ useRepoStore: () => mocks.repo }))
vi.mock('@/composables/useGlobalToast', () => ({
  useGlobalToast: () => ({ showError: mocks.showError }),
}))

describe('OngoingOpBanner abort confirmation', () => {
  beforeEach(() => {
    mocks.repo.activeRepoId = 'repo-a'
    mocks.refs.repoState = testRef({ kind: 'rebase' })
    mocks.refs.isOngoing = testRef(true)
    mocks.refs.isMerging = testRef(false)
    mocks.refs.isRebasing = testRef(true)
    mocks.refs.isCherryPicking = testRef(false)
    mocks.refs.isReverting = testRef(false)
    mocks.refs.busy = testRef(false)
    mocks.mr.abortMerge.mockReset().mockResolvedValue(undefined)
    mocks.mr.abortRebase.mockReset().mockResolvedValue(undefined)
    mocks.mr.abortCherryPick.mockReset().mockResolvedValue(undefined)
    mocks.mr.abortRevert.mockReset().mockResolvedValue(undefined)
    mocks.showError.mockReset()
  })

  it('uses an in-app confirmation for the captured operation', async () => {
    const wrapper = shallowMount(OngoingOpBanner)
    await wrapper.find('.op.danger').trigger('click')
    const dialog = wrapper.findComponent(ConfirmDialog)

    expect(dialog.props()).toMatchObject({
      visible: true,
      danger: true,
      message: 'ongoing.rebase.confirmAbort',
    })
    dialog.vm.$emit('confirm')
    await flushPromises()

    expect(mocks.mr.abortRebase).toHaveBeenCalledOnce()
    expect(dialog.props('visible')).toBe(false)
  })

  it('cancels a stale confirmation after the active repository changes', async () => {
    const wrapper = shallowMount(OngoingOpBanner)
    await wrapper.find('.op.danger').trigger('click')
    mocks.repo.activeRepoId = 'repo-b'

    wrapper.findComponent(ConfirmDialog).vm.$emit('confirm')
    await flushPromises()

    expect(mocks.mr.abortRebase).not.toHaveBeenCalled()
    expect(mocks.showError).toHaveBeenCalledWith('ongoing.abortContextChanged')
  })
})
