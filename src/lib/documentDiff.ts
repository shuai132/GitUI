import { splitFileLines } from '@/lib/fullFileDiff'
import { diffChars, tokensToHtml } from '@/lib/wordDiff'

export type DocumentDiffCellKind = 'ctx' | 'del' | 'add' | 'empty'

export interface DocumentDiffCell {
  lineNo?: number
  content: string
  html: string
  kind: DocumentDiffCellKind
}

export interface DocumentDiffRow {
  left: DocumentDiffCell
  right: DocumentDiffCell
}

interface LineOp {
  kind: 'eq' | 'del' | 'add'
  text: string
  oldLineNo?: number
  newLineNo?: number
}

const MAX_LCS_LINES = 2_000

export function buildDocumentDiffRows(oldText: string, newText: string): DocumentDiffRow[] {
  const oldLines = splitFileLines(oldText)
  const newLines = splitFileLines(newText)

  if (oldLines.length + newLines.length > MAX_LCS_LINES) {
    return buildFallbackRows(oldLines, newLines)
  }

  return pairChangeRuns(lineOps(oldLines, newLines))
}

function lineOps(oldLines: string[], newLines: string[]): LineOp[] {
  const n = oldLines.length
  const m = newLines.length
  const width = m + 1
  const lengths = new Uint16Array((n + 1) * width)

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const idx = i * width + j
      if (oldLines[i] === newLines[j]) {
        lengths[idx] = lengths[(i + 1) * width + j + 1] + 1
      } else {
        const delLen = lengths[(i + 1) * width + j]
        const addLen = lengths[i * width + j + 1]
        lengths[idx] = delLen >= addLen ? delLen : addLen
      }
    }
  }

  const ops: LineOp[] = []
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && oldLines[i] === newLines[j]) {
      ops.push({ kind: 'eq', text: oldLines[i], oldLineNo: i + 1, newLineNo: j + 1 })
      i++
      j++
    } else if (
      j >= m ||
      (i < n && lengths[(i + 1) * width + j] >= lengths[i * width + j + 1])
    ) {
      ops.push({ kind: 'del', text: oldLines[i], oldLineNo: i + 1 })
      i++
    } else {
      ops.push({ kind: 'add', text: newLines[j], newLineNo: j + 1 })
      j++
    }
  }

  return ops
}

function pairChangeRuns(ops: LineOp[]): DocumentDiffRow[] {
  const rows: DocumentDiffRow[] = []
  let delBuf: LineOp[] = []
  let addBuf: LineOp[] = []

  const flush = () => {
    const count = Math.max(delBuf.length, addBuf.length)
    for (let i = 0; i < count; i++) {
      const del = delBuf[i]
      const add = addBuf[i]
      rows.push(pairCells(del, add))
    }
    delBuf = []
    addBuf = []
  }

  for (const op of ops) {
    if (op.kind === 'eq') {
      flush()
      rows.push({
        left: cell('ctx', op.text, op.oldLineNo),
        right: cell('ctx', op.text, op.newLineNo),
      })
    } else if (op.kind === 'del') {
      delBuf.push(op)
    } else {
      addBuf.push(op)
    }
  }
  flush()

  return rows
}

function pairCells(del?: LineOp, add?: LineOp): DocumentDiffRow {
  if (del && add) {
    const { leftTokens, rightTokens } = diffChars(del.text, add.text)
    return {
      left: cell('del', del.text, del.oldLineNo, tokensToHtml(leftTokens)),
      right: cell('add', add.text, add.newLineNo, tokensToHtml(rightTokens)),
    }
  }

  return {
    left: del ? cell('del', del.text, del.oldLineNo) : emptyCell(),
    right: add ? cell('add', add.text, add.newLineNo) : emptyCell(),
  }
}

function buildFallbackRows(oldLines: string[], newLines: string[]): DocumentDiffRow[] {
  const count = Math.max(oldLines.length, newLines.length)
  const rows: DocumentDiffRow[] = []
  for (let i = 0; i < count; i++) {
    const oldLine = oldLines[i]
    const newLine = newLines[i]
    if (oldLine === newLine) {
      rows.push({
        left: cell('ctx', oldLine, i + 1),
        right: cell('ctx', newLine, i + 1),
      })
    } else {
      rows.push({
        left: oldLine === undefined ? emptyCell() : cell('del', oldLine, i + 1),
        right: newLine === undefined ? emptyCell() : cell('add', newLine, i + 1),
      })
    }
  }
  return rows
}

function cell(
  kind: Exclude<DocumentDiffCellKind, 'empty'>,
  content: string,
  lineNo?: number,
  html = escapeHtml(content),
): DocumentDiffCell {
  return { kind, content, lineNo, html }
}

function emptyCell(): DocumentDiffCell {
  return { kind: 'empty', content: '', html: '' }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
