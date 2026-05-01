import { describe, expect, it } from 'vitest'
import {
  buildDocumentDiffGroups,
  buildDocumentDiffRows,
  buildDocumentInlineRows,
  hasDocumentDiffChanges,
} from './documentDiff'

describe('documentDiff', () => {
  it('pairs changed lines and keeps unchanged context', () => {
    const rows = buildDocumentDiffRows('Title\nold value\nFooter', 'Title\nnew value\nFooter')

    expect(rows).toHaveLength(3)
    expect(rows[0].left.kind).toBe('ctx')
    expect(rows[1].left.kind).toBe('del')
    expect(rows[1].right.kind).toBe('add')
    expect(rows[1].left.html).toContain('word-del')
    expect(rows[1].right.html).toContain('word-add')
    expect(rows[2].right.content).toBe('Footer')
    expect(hasDocumentDiffChanges(rows)).toBe(true)
  })

  it('aligns inserted and removed lines with empty cells', () => {
    const rows = buildDocumentDiffRows('A\nB\nC', 'A\nB\nB2\nC')

    expect(rows.map((row) => [row.left.kind, row.right.kind])).toEqual([
      ['ctx', 'ctx'],
      ['ctx', 'ctx'],
      ['empty', 'add'],
      ['ctx', 'ctx'],
    ])
    expect(rows[2].right.content).toBe('B2')
  })

  it('groups changes with context rows for hunk mode', () => {
    const rows = buildDocumentDiffRows(
      ['A', 'B', 'C', 'old', 'D', 'E', 'F'].join('\n'),
      ['A', 'B', 'C', 'new', 'D', 'E', 'F'].join('\n'),
    )

    const groups = buildDocumentDiffGroups(rows, 1)

    expect(groups).toHaveLength(1)
    expect(groups[0].header).toBe('@@ -3,3 +3,3 @@')
    expect(groups[0].rows.map((row) => [row.left.content, row.right.content])).toEqual([
      ['C', 'C'],
      ['old', 'new'],
      ['D', 'D'],
    ])
  })

  it('builds inline rows from side-by-side rows', () => {
    const rows = buildDocumentDiffRows('A\nold\nC', 'A\nnew\nC')

    const inlineRows = buildDocumentInlineRows(rows)

    expect(inlineRows.map((row) => row.kind)).toEqual(['ctx', 'del', 'add', 'ctx'])
    expect(inlineRows[1].oldLineNo).toBe(2)
    expect(inlineRows[2].newLineNo).toBe(2)
  })
})
