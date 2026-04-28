import { describe, expect, it } from 'vitest'
import type { DiffHunk, FileDiff } from '@/types/git'
import { buildFullInlineRows, buildFullSideBySideRows, splitFileLines } from './fullFileDiff'

describe('fullFileDiff', () => {
  it('splits file text without adding a phantom trailing line', () => {
    expect(splitFileLines('a\n')).toEqual(['a'])
    expect(splitFileLines('a\n\n')).toEqual(['a', ''])
    expect(splitFileLines('')).toEqual([])
  })

  it('fills unchanged lines around a modified line', () => {
    const diff = fileDiff([
      {
        old_start: 2,
        old_lines: 1,
        new_start: 2,
        new_lines: 1,
        header: '@@ -2 +2 @@',
        lines: [
          { origin: '-', content: 'two\n', old_lineno: 2 },
          { origin: '+', content: 'two changed\n', new_lineno: 2 },
        ],
      },
    ])

    const rows = buildFullSideBySideRows(diff, {
      oldText: 'one\ntwo\nthree\n',
      newText: 'one\ntwo changed\nthree\n',
    })

    expect(rows.map((row) => [row.left.kind, row.left.lineNo, row.right.kind, row.right.lineNo])).toEqual([
      ['ctx', 1, 'ctx', 1],
      ['del', 2, 'add', 2],
      ['ctx', 3, 'ctx', 3],
    ])
  })

  it('fills the unchanged gap between multiple hunks once', () => {
    const diff = fileDiff([
      {
        old_start: 2,
        old_lines: 1,
        new_start: 2,
        new_lines: 1,
        header: '@@ -2 +2 @@',
        lines: [
          { origin: '-', content: 'b\n', old_lineno: 2 },
          { origin: '+', content: 'B\n', new_lineno: 2 },
        ],
      },
      {
        old_start: 5,
        old_lines: 1,
        new_start: 5,
        new_lines: 1,
        header: '@@ -5 +5 @@',
        lines: [
          { origin: '-', content: 'e\n', old_lineno: 5 },
          { origin: '+', content: 'E\n', new_lineno: 5 },
        ],
      },
    ])

    const rows = buildFullInlineRows(diff, {
      oldText: 'a\nb\nc\nd\ne\nf\n',
      newText: 'a\nB\nc\nd\nE\nf\n',
    })

    expect(rows.map((row) => row.content)).toEqual(['a', 'b', 'B', 'c', 'd', 'e', 'E', 'f'])
  })

  it('handles an insertion at the start of a file', () => {
    const diff = fileDiff([
      {
        old_start: 0,
        old_lines: 0,
        new_start: 1,
        new_lines: 1,
        header: '@@ -0,0 +1 @@',
        lines: [{ origin: '+', content: 'a\n', new_lineno: 1 }],
      },
    ])

    const rows = buildFullSideBySideRows(diff, {
      oldText: 'b\n',
      newText: 'a\nb\n',
    })

    expect(rows.map((row) => [row.left.kind, row.left.lineNo, row.right.kind, row.right.lineNo])).toEqual([
      ['empty', undefined, 'add', 1],
      ['ctx', 1, 'ctx', 2],
    ])
    expect(rows[0].right.isHunkStart).toBe(true)
  })

  it('marks only the first inline change row as the hunk start', () => {
    const diff = fileDiff([
      {
        old_start: 1,
        old_lines: 1,
        new_start: 1,
        new_lines: 1,
        header: '@@ -1 +1 @@',
        lines: [
          { origin: '-', content: 'a\n', old_lineno: 1 },
          { origin: '+', content: 'A\n', new_lineno: 1 },
        ],
      },
    ])

    const rows = buildFullInlineRows(diff, { oldText: 'a\n', newText: 'A\n' })

    expect(rows.map((row) => [row.kind, row.isHunkStart])).toEqual([
      ['del', true],
      ['add', false],
    ])
  })
})

function fileDiff(hunks: DiffHunk[]): FileDiff {
  return {
    old_path: 'file.txt',
    new_path: 'file.txt',
    is_binary: false,
    hunks,
    additions: 0,
    deletions: 0,
    old_blob_oid: 'old',
    new_blob_oid: 'new',
    encoding: 'UTF-8',
  }
}
