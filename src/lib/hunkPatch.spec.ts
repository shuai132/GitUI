import { describe, expect, it } from 'vitest'
import type { DiffHunk, FileDiff } from '@/types/git'
import { buildHunkPatch } from './hunkPatch'

describe('hunkPatch', () => {
  it('builds a forward patch for staging a hunk', () => {
    expect(buildHunkPatch(fileDiff(), 0, 'forward')).toBe(
      [
        'diff --git a/file.txt b/file.txt\n',
        '--- a/file.txt\n',
        '+++ b/file.txt\n',
        '@@ -2,1 +2,1 @@\n',
        '-two\n',
        '+TWO\n',
      ].join(''),
    )
  })

  it('builds a reverse patch for rollback or unstaging a hunk', () => {
    expect(buildHunkPatch(fileDiff(), 0, 'reverse')).toBe(
      [
        'diff --git a/file.txt b/file.txt\n',
        '--- a/file.txt\n',
        '+++ b/file.txt\n',
        '@@ -2,1 +2,1 @@\n',
        '+two\n',
        '-TWO\n',
      ].join(''),
    )
  })

  it('uses /dev/null for the empty side of a new-file hunk', () => {
    expect(buildHunkPatch(fileDiff([newFileHunk()], { old_blob_oid: undefined }), 0, 'forward')).toBe(
      [
        'diff --git a/file.txt b/file.txt\n',
        '--- /dev/null\n',
        '+++ b/file.txt\n',
        '@@ -0,0 +1,2 @@\n',
        '+one\n',
        '+two\n',
      ].join(''),
    )
  })

  it('does not treat tracked empty-file edits as new files', () => {
    expect(buildHunkPatch(fileDiff([newFileHunk()]), 0, 'forward')).toContain(
      '--- a/file.txt\n+++ b/file.txt\n',
    )
  })
})

function fileDiff(
  hunks: DiffHunk[] = [changedLineHunk()],
  overrides: Partial<Pick<FileDiff, 'old_blob_oid' | 'new_blob_oid'>> = {},
): FileDiff {
  return {
    old_path: 'file.txt',
    new_path: 'file.txt',
    is_binary: false,
    hunks,
    additions: 1,
    deletions: 1,
    old_blob_oid: 'old',
    new_blob_oid: 'new',
    encoding: 'UTF-8',
    ...overrides,
  }
}

function changedLineHunk(): DiffHunk {
  return {
    old_start: 2,
    old_lines: 1,
    new_start: 2,
    new_lines: 1,
    header: '@@ -2 +2 @@',
    lines: [
      { origin: '-', content: 'two\n', old_lineno: 2 },
      { origin: '+', content: 'TWO\n', new_lineno: 2 },
    ],
  }
}

function newFileHunk(): DiffHunk {
  return {
    old_start: 0,
    old_lines: 0,
    new_start: 1,
    new_lines: 2,
    header: '@@ -0,0 +1,2 @@',
    lines: [
      { origin: '+', content: 'one\n', new_lineno: 1 },
      { origin: '+', content: 'two\n', new_lineno: 2 },
    ],
  }
}
