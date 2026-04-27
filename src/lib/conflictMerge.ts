export type ConflictSide = 'a' | 'b'

export type AlignRowStatus =
  | 'equal'
  | 'left-only'
  | 'right-only'
  | 'changed'
  | 'hunk-header'

export type AlignRow = {
  left: string | null
  leftNo: number | null
  right: string | null
  rightNo: number | null
  status: AlignRowStatus
  hunkId: number | null
  baseCls: string
}

export type ConflictHunk = {
  id: number
  headerIdx: number
  startIdx: number
  endIdx: number
  leftRowIdx: number[]
  rightRowIdx: number[]
}

export type ConflictAlignment = {
  rows: AlignRow[]
  hunks: ConflictHunk[]
}

export type ConflictOutputMap = {
  lines: string[]
  rowToLine: number[]
  lineToRow: number[]
}

type LineItem = {
  content: string
  lineNo: number
}

export function conflictRowKey(side: ConflictSide, idx: number): string {
  return `${side}:${idx}`
}

export function buildConflictAlignment(ours: string, theirs: string): ConflictAlignment {
  const a = splitConflictLines(ours)
  const b = splitConflictLines(theirs)

  const m = a.length
  const n = b.length
  const dp: Uint32Array[] = []
  for (let i = 0; i <= m; i++) dp.push(new Uint32Array(n + 1))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1
      else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }

  const raw: AlignRow[] = []
  let i = m
  let j = n
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      raw.push(makeAlignRow(a[i - 1], i, b[j - 1], j, 'equal'))
      i--
      j--
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      raw.push(makeAlignRow(a[i - 1], i, null, null, 'left-only'))
      i--
    } else {
      raw.push(makeAlignRow(null, null, b[j - 1], j, 'right-only'))
      j--
    }
  }
  while (i > 0) {
    raw.push(makeAlignRow(a[i - 1], i, null, null, 'left-only'))
    i--
  }
  while (j > 0) {
    raw.push(makeAlignRow(null, null, b[j - 1], j, 'right-only'))
    j--
  }
  raw.reverse()

  const zippedRows = zipChangedBlocks(raw)
  return addConflictHunks(zippedRows)
}

export function buildConflictOutputMap(rows: AlignRow[], selectedRows: Set<string>): ConflictOutputMap {
  const lines: string[] = []
  const rowToLine: number[] = []
  const lineToRow: number[] = [0]
  let line = 1

  for (let idx = 0; idx < rows.length; idx++) {
    rowToLine.push(line)
    const row = rows[idx]
    if (row.status === 'equal') {
      lines.push(row.left ?? '')
      lineToRow.push(idx)
      line += 1
    } else if (row.status === 'hunk-header') {
      continue
    } else if (row.hunkId !== null) {
      if (row.left !== null && selectedRows.has(conflictRowKey('a', idx))) {
        lines.push(row.left)
        lineToRow.push(idx)
        line += 1
      }
      if (row.right !== null && selectedRows.has(conflictRowKey('b', idx))) {
        lines.push(row.right)
        lineToRow.push(idx)
        line += 1
      }
    }
  }

  return { lines, rowToLine, lineToRow }
}

function splitConflictLines(content: string): string[] {
  const lines = content.split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

function makeAlignRow(
  left: string | null,
  leftNo: number | null,
  right: string | null,
  rightNo: number | null,
  status: AlignRowStatus,
): AlignRow {
  return {
    left,
    leftNo,
    right,
    rightNo,
    status,
    hunkId: null,
    baseCls: '',
  }
}

function zipChangedBlocks(raw: AlignRow[]): AlignRow[] {
  const rows: AlignRow[] = []
  let idx = 0

  while (idx < raw.length) {
    if (raw[idx].status === 'equal') {
      rows.push(raw[idx])
      idx++
      continue
    }

    let end = idx
    while (end < raw.length && raw[end].status !== 'equal') end++

    const leftItems: LineItem[] = []
    const rightItems: LineItem[] = []
    for (let p = idx; p < end; p++) {
      const rawRow = raw[p]
      if (rawRow.left !== null && rawRow.leftNo !== null) {
        leftItems.push({ content: rawRow.left, lineNo: rawRow.leftNo })
      }
      if (rawRow.right !== null && rawRow.rightNo !== null) {
        rightItems.push({ content: rawRow.right, lineNo: rawRow.rightNo })
      }
    }

    const maxLen = Math.max(leftItems.length, rightItems.length)
    for (let i = 0; i < maxLen; i++) {
      const left = leftItems[i]
      const right = rightItems[i]
      if (left && right) rows.push(makeAlignRow(left.content, left.lineNo, right.content, right.lineNo, 'changed'))
      else if (left) rows.push(makeAlignRow(left.content, left.lineNo, null, null, 'left-only'))
      else if (right) rows.push(makeAlignRow(null, null, right.content, right.lineNo, 'right-only'))
    }

    idx = end
  }

  return rows
}

function addConflictHunks(rows: AlignRow[]): ConflictAlignment {
  const finalRows: AlignRow[] = []
  const hunks: ConflictHunk[] = []
  let currentHunk: ConflictHunk | null = null

  for (let origIdx = 0; origIdx < rows.length; origIdx++) {
    const row = rows[origIdx]
    if (row.status === 'equal') {
      currentHunk = null
      row.baseCls = 'row'
      finalRows.push(row)
      continue
    }

    if (!currentHunk) {
      let end = origIdx
      while (end + 1 < rows.length && rows[end + 1].status !== 'equal') end++
      const isMulti = end > origIdx
      let headerIdx: number
      let startIdx: number

      if (isMulti) {
        headerIdx = finalRows.length
        finalRows.push({
          left: null,
          leftNo: null,
          right: null,
          rightNo: null,
          status: 'hunk-header',
          hunkId: hunks.length,
          baseCls: 'row row-hunk-header',
        })
        startIdx = finalRows.length
      } else {
        startIdx = finalRows.length
        headerIdx = startIdx
      }

      currentHunk = {
        id: hunks.length,
        headerIdx,
        startIdx,
        endIdx: startIdx,
        leftRowIdx: [],
        rightRowIdx: [],
      }
      hunks.push(currentHunk)
    }

    row.hunkId = currentHunk.id
    const newIdx = finalRows.length
    currentHunk.endIdx = newIdx
    if (row.left !== null) currentHunk.leftRowIdx.push(newIdx)
    if (row.right !== null) currentHunk.rightRowIdx.push(newIdx)
    row.baseCls = `row row-diff row-${row.status}`
    finalRows.push(row)
  }

  return { rows: finalRows, hunks }
}
