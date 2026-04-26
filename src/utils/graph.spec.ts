import { describe, it, expect } from 'vitest'
import { computeGraphLayout } from './graph'
import type { CommitInfo } from '@/types/git'

describe('Graph Layout Algorithm (computeGraphLayout)', () => {
  it('should correctly layout a simple linear history', () => {
    const commits = [
      { oid: '333', parent_oids: ['222'], is_unreachable: false, is_stash: false, author_name: '', author_email: '', message: '', time: 0 },
      { oid: '222', parent_oids: ['111'], is_unreachable: false, is_stash: false, author_name: '', author_email: '', message: '', time: 0 },
      { oid: '111', parent_oids: [], is_unreachable: false, is_stash: false, author_name: '', author_email: '', message: '', time: 0 },
    ] as unknown as CommitInfo[]

    const { rows } = computeGraphLayout(commits)
    
    expect(rows).toHaveLength(3)
    
    // All should be in column 0
    expect(rows[0].column).toBe(0)
    expect(rows[1].column).toBe(0)
    expect(rows[2].column).toBe(0)

    // Segment checks
    expect(rows[0].segments).toContainEqual(expect.objectContaining({
      fromCol: 0, toCol: 0, upper: false, lower: true
    }))
  })

  it('should handle a simple merge commit (2 parents)', () => {
    const commits = [
      { oid: 'merge1', parent_oids: ['parent1', 'parent2'], is_unreachable: false, is_stash: false, author_name: '', author_email: '', message: '', time: 0 },
      { oid: 'parent1', parent_oids: ['root'], is_unreachable: false, is_stash: false, author_name: '', author_email: '', message: '', time: 0 },
      { oid: 'parent2', parent_oids: ['root'], is_unreachable: false, is_stash: false, author_name: '', author_email: '', message: '', time: 0 },
      { oid: 'root', parent_oids: [], is_unreachable: false, is_stash: false, author_name: '', author_email: '', message: '', time: 0 },
    ] as unknown as CommitInfo[]

    const { rows } = computeGraphLayout(commits)

    expect(rows).toHaveLength(4)
    
    // Merge commit claims lane 0
    expect(rows[0].column).toBe(0)
    // parent1 inherits lane 0
    expect(rows[1].column).toBe(0)
    // parent2 gets a new lane, likely lane 1
    expect(rows[2].column).toBe(1)
    // root goes back to lane 0 (where parent1 is), and parent2 converges into it
    expect(rows[3].column).toBe(0)

    // The merge commit should have segments branching to col 0 and col 1
    const mergeSegments = rows[0].segments
    expect(mergeSegments.some(s => s.fromCol === 0 && s.toCol === 0 && s.lower)).toBe(true) // primary
    expect(mergeSegments.some(s => s.fromCol === 0 && s.toCol === 1 && s.lower)).toBe(true) // secondary
  })
})
