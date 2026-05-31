import { describe, expect, it } from 'vitest'
import { filterBranchTags, remoteBranchTagsAtCommit } from './useCommitTags'
import type { BranchInfo } from '@/types/git'

describe('filterBranchTags', () => {
  const branches: BranchInfo[] = [
    {
      name: 'main',
      is_remote: false,
      is_head: true,
      commit_oid: 'aaa',
    },
    {
      name: 'origin/main',
      is_remote: true,
      is_head: false,
      commit_oid: 'aaa',
    },
  ]

  it('keeps remote branch chips when remote branches are visible', () => {
    expect(filterBranchTags(branches, true).map((b) => b.name)).toEqual([
      'main',
      'origin/main',
    ])
  })

  it('hides remote branch chips when remote branches are disabled', () => {
    expect(filterBranchTags(branches, false).map((b) => b.name)).toEqual(['main'])
  })
})

describe('remoteBranchTagsAtCommit', () => {
  const branches: BranchInfo[] = [
    {
      name: 'main',
      is_remote: false,
      is_head: true,
      commit_oid: 'aaa',
    },
    {
      name: 'origin/main',
      is_remote: true,
      is_head: false,
      commit_oid: 'aaa',
    },
    {
      name: 'origin/topic',
      is_remote: true,
      is_head: false,
      commit_oid: 'bbb',
    },
  ]

  it('returns visible remote branch chips at the target commit', () => {
    expect(remoteBranchTagsAtCommit(branches, 'aaa', true).map((b) => b.name)).toEqual([
      'origin/main',
    ])
  })

  it('does not expose hidden remote branch chips as checkout candidates', () => {
    expect(remoteBranchTagsAtCommit(branches, 'aaa', false)).toEqual([])
  })
})
