import { describe, expect, it } from 'vitest'
import { countChangedWorkspacePaths, isSameStashTarget } from './stashPopSafety'
import type { FileEntry, StashEntry, WorkspaceStatus } from '@/types/git'

function file(path: string, staged: boolean): FileEntry {
  return {
    path,
    status: 'modified',
    staged,
    additions: 1,
    deletions: 0,
  }
}

function status(overrides: Partial<WorkspaceStatus> = {}): WorkspaceStatus {
  return {
    staged: [],
    unstaged: [],
    untracked: [],
    is_detached: false,
    repo_state: { kind: 'clean' },
    ...overrides,
  }
}

describe('countChangedWorkspacePaths', () => {
  it('keeps a clean or unavailable workspace on the one-click path', () => {
    expect(countChangedWorkspacePaths(null)).toBe(0)
    expect(countChangedWorkspacePaths(status())).toBe(0)
  })

  it('counts staged, unstaged, and untracked paths without duplicates', () => {
    expect(countChangedWorkspacePaths(status({
      staged: [file('shared.ts', true)],
      unstaged: [file('shared.ts', false), file('other.ts', false)],
      untracked: [file('new.ts', false)],
    }))).toBe(3)
  })
})

describe('isSameStashTarget', () => {
  const entry: StashEntry = {
    index: 0,
    message: 'WIP',
    commit_oid: 'abc123',
  }

  it('matches both the stash index and immutable commit OID', () => {
    expect(isSameStashTarget([entry], 0, 'abc123')).toBe(true)
    expect(isSameStashTarget([{ ...entry, commit_oid: 'new456' }], 0, 'abc123')).toBe(false)
    expect(isSameStashTarget([{ ...entry, index: 1 }], 0, 'abc123')).toBe(false)
  })
})
