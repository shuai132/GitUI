import { describe, expect, it } from 'vitest'
import type { FileDiff } from '@/types/git'
import { commitFileStatus } from './useCommitFileItems'

function diff(overrides: Partial<FileDiff>): FileDiff {
  return {
    old_path: 'file.txt',
    new_path: 'file.txt',
    is_binary: false,
    hunks: [],
    additions: 0,
    deletions: 0,
    old_blob_oid: 'old',
    new_blob_oid: 'new',
    old_file_mode: 0o100644,
    new_file_mode: 0o100644,
    encoding: 'UTF-8',
    ...overrides,
  }
}

describe('commitFileStatus', () => {
  it('detects file type changes from file mode metadata', () => {
    expect(commitFileStatus(diff({ new_file_mode: 0o120000 }))).toBe('type_changed')
  })

  it('keeps executable bit changes as modified', () => {
    expect(commitFileStatus(diff({ new_file_mode: 0o100755 }))).toBe('modified')
  })
})
