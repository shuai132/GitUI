import { describe, expect, it } from 'vitest'
import {
  buildConflictAlignment,
  buildConflictOutputMap,
  conflictRowKey,
  type AlignRow,
} from './conflictMerge'

function rowSummary(row: AlignRow) {
  return {
    left: row.left,
    leftNo: row.leftNo,
    right: row.right,
    rightNo: row.rightNo,
    status: row.status,
    hunkId: row.hunkId,
  }
}

describe('conflictMerge', () => {
  it('aligns identical content without conflict hunks', () => {
    const alignment = buildConflictAlignment('a\nb\nc', 'a\nb\nc')

    expect(alignment.hunks).toHaveLength(0)
    expect(alignment.rows.map(rowSummary)).toEqual([
      { left: 'a', leftNo: 1, right: 'a', rightNo: 1, status: 'equal', hunkId: null },
      { left: 'b', leftNo: 2, right: 'b', rightNo: 2, status: 'equal', hunkId: null },
      { left: 'c', leftNo: 3, right: 'c', rightNo: 3, status: 'equal', hunkId: null },
    ])

    expect(buildConflictOutputMap(alignment.rows, new Set()).lines).toEqual(['a', 'b', 'c'])
  })

  it('keeps one-sided additions selectable on their own side', () => {
    const alignment = buildConflictAlignment('a\nours\nb', 'a\nb')

    expect(alignment.hunks).toEqual([
      { id: 0, headerIdx: 1, startIdx: 1, endIdx: 1, leftRowIdx: [1], rightRowIdx: [] },
    ])
    expect(alignment.rows.map(rowSummary)).toEqual([
      { left: 'a', leftNo: 1, right: 'a', rightNo: 1, status: 'equal', hunkId: null },
      { left: 'ours', leftNo: 2, right: null, rightNo: null, status: 'left-only', hunkId: 0 },
      { left: 'b', leftNo: 3, right: 'b', rightNo: 2, status: 'equal', hunkId: null },
    ])

    const selected = new Set([conflictRowKey('a', 1)])
    expect(buildConflictOutputMap(alignment.rows, selected).lines).toEqual(['a', 'ours', 'b'])
  })

  it('zips adjacent left-only and right-only rows into changed rows', () => {
    const alignment = buildConflictAlignment('a\nours\nb', 'a\ntheirs\nb')

    expect(alignment.hunks).toEqual([
      { id: 0, headerIdx: 1, startIdx: 1, endIdx: 1, leftRowIdx: [1], rightRowIdx: [1] },
    ])
    expect(alignment.rows.map(rowSummary)).toEqual([
      { left: 'a', leftNo: 1, right: 'a', rightNo: 1, status: 'equal', hunkId: null },
      { left: 'ours', leftNo: 2, right: 'theirs', rightNo: 2, status: 'changed', hunkId: 0 },
      { left: 'b', leftNo: 3, right: 'b', rightNo: 3, status: 'equal', hunkId: null },
    ])

    const selected = new Set([conflictRowKey('a', 1), conflictRowKey('b', 1)])
    expect(buildConflictOutputMap(alignment.rows, selected).lines).toEqual(['a', 'ours', 'theirs', 'b'])
  })

  it('inserts hunk header rows only for multi-line hunks', () => {
    const alignment = buildConflictAlignment('a\nours 1\nours 2\nb\nours 3\nc', 'a\ntheirs 1\ntheirs 2\nb\ntheirs 3\nc')

    expect(alignment.hunks).toEqual([
      { id: 0, headerIdx: 1, startIdx: 2, endIdx: 3, leftRowIdx: [2, 3], rightRowIdx: [2, 3] },
      { id: 1, headerIdx: 5, startIdx: 5, endIdx: 5, leftRowIdx: [5], rightRowIdx: [5] },
    ])
    expect(alignment.rows.map((row) => row.status)).toEqual([
      'equal',
      'hunk-header',
      'changed',
      'changed',
      'equal',
      'changed',
      'equal',
    ])
  })

  it('drops the trailing split sentinel while preserving intentional blank lines', () => {
    const alignment = buildConflictAlignment('a\n\nours\n', 'a\n\ntheirs\n')

    expect(alignment.rows.map(rowSummary)).toEqual([
      { left: 'a', leftNo: 1, right: 'a', rightNo: 1, status: 'equal', hunkId: null },
      { left: '', leftNo: 2, right: '', rightNo: 2, status: 'equal', hunkId: null },
      { left: 'ours', leftNo: 3, right: 'theirs', rightNo: 3, status: 'changed', hunkId: 0 },
    ])
  })

  it('builds output lines and row mappings in render order', () => {
    const alignment = buildConflictAlignment('a\nours 1\nours 2\nb', 'a\ntheirs 1\ntheirs 2\nb')
    const selected = new Set([
      conflictRowKey('b', 2),
      conflictRowKey('a', 3),
    ])

    const output = buildConflictOutputMap(alignment.rows, selected)

    expect(output.lines).toEqual(['a', 'theirs 1', 'ours 2', 'b'])
    expect(output.rowToLine).toEqual([1, 2, 2, 3, 4])
    expect(output.lineToRow).toEqual([0, 0, 2, 3, 4])
  })
})
