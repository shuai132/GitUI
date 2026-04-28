import type { DiffLine, FileDiff } from '@/types/git'

export type FullDiffLineKind = 'del' | 'add' | 'ctx' | 'empty'

export interface FullDiffCell {
  lineNo?: number
  content: string
  kind: FullDiffLineKind
  hunkIndex?: number
  isHunkStart?: boolean
}

export interface FullDiffRow {
  left: FullDiffCell
  right: FullDiffCell
}

export interface FullInlineRow {
  kind: 'del' | 'add' | 'ctx'
  oldLineNo?: number
  newLineNo?: number
  content: string
  hunkIndex?: number
  isHunkStart?: boolean
}

export interface FullFileContent {
  oldText: string
  newText: string
}

export function splitFileLines(text: string): string[] {
  if (text.length === 0) return []
  const lines = text.split(/\r\n|\n|\r/)
  if (text.endsWith('\n') || text.endsWith('\r')) {
    lines.pop()
  }
  return lines
}

export function buildFullSideBySideRows(
  diff: FileDiff,
  content: FullFileContent,
): FullDiffRow[] {
  const oldLines = splitFileLines(content.oldText)
  const newLines = splitFileLines(content.newText)
  const rows: FullDiffRow[] = []
  let oldCursor = 1
  let newCursor = 1

  for (let hunkIndex = 0; hunkIndex < diff.hunks.length; hunkIndex++) {
    const hunk = diff.hunks[hunkIndex]
    const oldStart = hunk.old_start > 0 ? hunk.old_start : oldCursor
    const newStart = hunk.new_start > 0 ? hunk.new_start : newCursor

    appendContextRows(rows, oldLines, newLines, oldCursor, newCursor, oldStart, newStart)
    oldCursor += Math.max(0, oldStart - oldCursor)
    newCursor += Math.max(0, newStart - newCursor)

    let markedHunkStart = false
    let delBuf: DiffLine[] = []
    let addBuf: DiffLine[] = []

    const nextChangeMeta = (): Pick<FullDiffCell, 'hunkIndex' | 'isHunkStart'> => {
      const isHunkStart = !markedHunkStart
      markedHunkStart = true
      return { hunkIndex, isHunkStart }
    }

    const flushChanges = () => {
      const maxLen = Math.max(delBuf.length, addBuf.length)
      for (let i = 0; i < maxLen; i++) {
        const delLine = delBuf[i]
        const addLine = addBuf[i]
        const meta = nextChangeMeta()
        rows.push({
          left: delLine
            ? {
                lineNo: delLine.old_lineno,
                content: normalizeDiffLineContent(delLine.content),
                kind: 'del',
                ...meta,
              }
            : { content: '', kind: 'empty' },
          right: addLine
            ? {
                lineNo: addLine.new_lineno,
                content: normalizeDiffLineContent(addLine.content),
                kind: 'add',
                ...meta,
              }
            : { content: '', kind: 'empty' },
        })
      }
      delBuf = []
      addBuf = []
    }

    for (const line of hunk.lines) {
      if (line.origin === '-') {
        delBuf.push(line)
        oldCursor++
      } else if (line.origin === '+') {
        addBuf.push(line)
        newCursor++
      } else {
        flushChanges()
        rows.push({
          left: {
            lineNo: line.old_lineno,
            content: normalizeDiffLineContent(line.content),
            kind: 'ctx',
          },
          right: {
            lineNo: line.new_lineno,
            content: normalizeDiffLineContent(line.content),
            kind: 'ctx',
          },
        })
        oldCursor++
        newCursor++
      }
    }

    flushChanges()
  }

  appendContextRows(
    rows,
    oldLines,
    newLines,
    oldCursor,
    newCursor,
    oldLines.length + 1,
    newLines.length + 1,
  )

  return rows
}

export function buildFullInlineRows(
  diff: FileDiff,
  content: FullFileContent,
): FullInlineRow[] {
  const rows: FullInlineRow[] = []

  for (const row of buildFullSideBySideRows(diff, content)) {
    if (row.left.kind === 'del') {
      rows.push({
        kind: 'del',
        oldLineNo: row.left.lineNo,
        content: row.left.content,
        hunkIndex: row.left.hunkIndex,
        isHunkStart: row.left.isHunkStart,
      })
    }
    if (row.right.kind === 'add') {
      rows.push({
        kind: 'add',
        newLineNo: row.right.lineNo,
        content: row.right.content,
        hunkIndex: row.right.hunkIndex,
        isHunkStart: row.right.isHunkStart && row.left.kind !== 'del',
      })
    }
    if (row.left.kind === 'ctx' && row.right.kind === 'ctx') {
      rows.push({
        kind: 'ctx',
        oldLineNo: row.left.lineNo,
        newLineNo: row.right.lineNo,
        content: row.right.content,
      })
    }
  }

  return rows
}

function appendContextRows(
  rows: FullDiffRow[],
  oldLines: string[],
  newLines: string[],
  oldFrom: number,
  newFrom: number,
  oldUntil: number,
  newUntil: number,
) {
  let oldLineNo = oldFrom
  let newLineNo = newFrom

  while (oldLineNo < oldUntil || newLineNo < newUntil) {
    const hasOld = oldLineNo < oldUntil && oldLineNo <= oldLines.length
    const hasNew = newLineNo < newUntil && newLineNo <= newLines.length
    rows.push({
      left: hasOld
        ? { lineNo: oldLineNo, content: oldLines[oldLineNo - 1] ?? '', kind: 'ctx' }
        : { content: '', kind: 'empty' },
      right: hasNew
        ? { lineNo: newLineNo, content: newLines[newLineNo - 1] ?? '', kind: 'ctx' }
        : { content: '', kind: 'empty' },
    })
    if (hasOld) oldLineNo++
    if (hasNew) newLineNo++
    if (!hasOld && !hasNew) break
  }
}

function normalizeDiffLineContent(content: string): string {
  return (content ?? '').replace(/\n$/, '')
}
