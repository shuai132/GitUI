import { describe, expect, it } from 'vitest'
import { buildDocumentDiffRows } from './documentDiff'

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
})
