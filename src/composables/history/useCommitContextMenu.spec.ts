import { describe, expect, it } from 'vitest'
import {
  copyBranchNameAction,
  parseCopyBranchNameAction,
  remoteBranchContextMenuItems,
} from './useCommitContextMenu'
import type { BranchInfo } from '@/types/git'

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
