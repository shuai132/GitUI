import { describe, expect, it } from 'vitest'
import { filterBranchTags } from './useCommitTags'
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
