import { describe, expect, it, vi } from 'vitest'
import { defineComponent, ref } from 'vue'
import { shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { i18n } from '@/i18n'
import { useRepoStore } from '@/stores/repos'
import { usePluginsStore } from '@/stores/plugins'
import { useMergeRebaseStore } from '@/stores/mergeRebase'
import {
  copyBranchNameAction,
  parseCopyBranchNameAction,
  remoteBranchContextMenuItems,
  useCommitContextMenu,
} from './useCommitContextMenu'
import type { BranchInfo } from '@/types/git'

vi.mock('@/composables/useGitCommands', () => ({ useGitCommands: () => ({}) }))

function branch(name: string): BranchInfo {
  return {
    name,
    is_remote: true,
    is_head: false,
    commit_oid: 'aaa',
  }
}

describe('remoteBranchContextMenuItems', () => {
  it('adds copy branch name directly below each checkout branch item', () => {
    const items = remoteBranchContextMenuItems(
      [branch('origin/main'), branch('upstream/feature/login')],
      (key, params) => {
        if (key === 'history.contextMenu.checkoutRemoteBranch') {
          return `Checkout: ${params?.branch ?? ''}`
        }
        if (key === 'history.contextMenu.copyBranchName') return 'Copy branch name'
        return key
      },
    )

    expect(items.map((item) => item.label)).toEqual([
      'Checkout: origin/main',
      'Copy branch name',
      'Checkout: upstream/feature/login',
      'Copy branch name',
    ])
    expect(items.map((item) => item.action)).toEqual([
      'checkout-remote:origin/main',
      copyBranchNameAction('origin/main'),
      'checkout-remote:upstream/feature/login',
      copyBranchNameAction('upstream/feature/login'),
    ])
  })
})

describe('parseCopyBranchNameAction', () => {
  it('returns the full branch name from copy branch actions', () => {
    expect(parseCopyBranchNameAction(copyBranchNameAction('origin/feature/login'))).toBe(
      'origin/feature/login',
    )
    expect(parseCopyBranchNameAction('checkout-remote:origin/main')).toBeNull()
  })
})

describe('switch and reset branch menu', () => {
  function setupMenu() {
    setActivePinia(createPinia())
    useRepoStore().activeRepoId = 'repo-a'
    usePluginsStore().loaded = true
    let menu!: ReturnType<typeof useCommitContextMenu>
    const wrapper = shallowMount(defineComponent({
      setup() {
        menu = useCommitContextMenu(ref('main'), ref('head'), () => false, vi.fn(), vi.fn())
        return () => null
      },
    }), { global: { plugins: [i18n] } })
    menu.onCommitContextMenu(new MouseEvent('contextmenu'), {
      oid: 'target', short_oid: 'target', summary: 'target commit', message: 'target commit',
      author_name: 'Test', author_email: 'test@example.com', author_time: 0, time: 0,
      parent_oids: [], is_unreachable: false, is_stash: false, is_reflog_tip: false,
    })
    return { menu, wrapper }
  }

  it('offers the dialog and captures the right-clicked commit without resetting immediately', async () => {
    const { menu, wrapper } = setupMenu()
    expect(menu.commitMenuItems.value.find(item => item.action === 'switch-reset-branch')?.disabled).toBe(false)
    await menu.onCommitMenuAction('switch-reset-branch')
    expect(menu.showSwitchResetBranchDialog.value).toBe(true)
    expect(menu.dialogCommit.value?.oid).toBe('target')
    wrapper.unmount()
  })

  it('disables the entry during an ongoing Git operation and excludes stash rows', () => {
    const { menu, wrapper } = setupMenu()
    useMergeRebaseStore().setRepoState({ kind: 'merge' })
    expect(menu.commitMenuItems.value.find(item => item.action === 'switch-reset-branch')?.disabled).toBe(true)
    if (menu.commitMenu.commit) menu.commitMenu.commit.is_stash = true
    expect(menu.commitMenuItems.value.some(item => item.action === 'switch-reset-branch')).toBe(false)
    wrapper.unmount()
  })

  it('does not open an old menu target in another repository', async () => {
    const { menu, wrapper } = setupMenu()
    useRepoStore().activeRepoId = 'repo-b'
    await menu.onCommitMenuAction('switch-reset-branch')
    expect(menu.showSwitchResetBranchDialog.value).toBe(false)
    wrapper.unmount()
  })
})
