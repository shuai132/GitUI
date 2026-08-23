import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CreateWorktreeDialog from './CreateWorktreeDialog.vue'
import type { BranchInfo, RepoMeta } from '@/types/git'

const mocks = vi.hoisted(() => ({
  listBranches: vi.fn(),
  createWorktree: vi.fn(),
}))

vi.mock('@/composables/useGitCommands', () => ({
  useGitCommands: () => ({ listBranches: mocks.listBranches }),
}))

vi.mock('@/stores/repos', () => ({
  useRepoStore: () => ({ createWorktree: mocks.createWorktree }),
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) => {
      if (key === 'repo.worktree.remoteStartPoint') return `Remote: ${params?.name ?? ''}`
      return key
    },
  }),
}))

const repo: RepoMeta = { id: 'repo-a', name: 'alpha', path: '/repos/alpha' }

function branch(
  name: string,
  commitOid: string,
  options: { remote?: boolean; head?: boolean } = {},
): BranchInfo {
  return {
    name,
    commit_oid: commitOid,
    is_remote: options.remote ?? false,
    is_head: options.head ?? false,
  }
}

describe('CreateWorktreeDialog', () => {
  beforeEach(() => {
    mocks.listBranches.mockReset().mockResolvedValue([
      branch('main', '1234567890abcdef', { head: true }),
      branch('origin/release', 'fedcba0987654321', { remote: true }),
    ])
    mocks.createWorktree.mockReset().mockResolvedValue({
      id: 'worktree',
      name: 'feature-safe',
      path: '/repos/feature-safe',
    })
  })

  it('shows the start commit and submits its full OID as the creation guard', async () => {
    const wrapper = mount(CreateWorktreeDialog, {
      props: { visible: true, repo },
      global: {
        stubs: {
          Modal: { template: '<div><slot /><slot name="footer" /></div>' },
        },
      },
    })
    await flushPromises()

    expect(wrapper.findAll('option').map((option) => option.text())).toEqual([
      'main · 1234567',
      'Remote: origin/release · fedcba0',
    ])
    await wrapper
      .find<HTMLInputElement>('input[placeholder="repo.worktree.branchPlaceholder"]')
      .setValue('feature/safe')
    await wrapper.find<HTMLButtonElement>('.btn-primary').trigger('click')
    await flushPromises()

    expect(mocks.createWorktree).toHaveBeenCalledWith('repo-a', {
      path: '/repos/feature-safe',
      branchName: 'feature/safe',
      startPoint: 'main',
      startPointIsRemote: false,
      expectedStartOid: '1234567890abcdef',
    })
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
