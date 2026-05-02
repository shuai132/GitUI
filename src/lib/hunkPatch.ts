import type { DiffHunk, DiffLine, FileDiff } from '@/types/git'

export type HunkPatchDirection = 'forward' | 'reverse'

export type HunkPatchSideOptions = {
  oldSideIsNull?: boolean
  newSideIsNull?: boolean
}

export function buildHunkPatch(
  diff: FileDiff,
  hunkIndex: number,
  direction: HunkPatchDirection,
  sideOptions: HunkPatchSideOptions = {},
): string | null {
  const hunk = diff.hunks[hunkIndex]
  if (!hunk) return null

  const oldPath = diff.old_path ?? diff.new_path
  const newPath = diff.new_path ?? diff.old_path
  if (!oldPath || !newPath) return null

  const forwardOldNull = sideOptions.oldSideIsNull ?? isNullOldSide(diff, hunk)
  const forwardNewNull = sideOptions.newSideIsNull ?? isNullNewSide(diff, hunk)
  const fromPath = direction === 'forward' ? oldPath : newPath
  const toPath = direction === 'forward' ? newPath : oldPath
  const fromNull = direction === 'forward' ? forwardOldNull : forwardNewNull
  const toNull = direction === 'forward' ? forwardNewNull : forwardOldNull

  const lines: string[] = []
  lines.push(`diff --git a/${fromPath} b/${toPath}\n`)
  lines.push(`--- ${fromNull ? '/dev/null' : `a/${fromPath}`}\n`)
  lines.push(`+++ ${toNull ? '/dev/null' : `b/${toPath}`}\n`)
  lines.push(buildHunkHeader(hunk, direction, fromNull || toNull))

  for (const line of hunk.lines) {
    lines.push(`${lineOrigin(line, direction)}${lineContent(line)}`)
  }

  return lines.join('')
}

function isNullOldSide(diff: FileDiff, hunk: DiffHunk): boolean {
  return (
    diff.old_blob_oid == null &&
    hunk.old_lines === 0 &&
    hunk.lines.every((line) => line.origin === '+')
  )
}

function isNullNewSide(diff: FileDiff, hunk: DiffHunk): boolean {
  return (
    diff.new_blob_oid == null &&
    hunk.new_lines === 0 &&
    hunk.lines.every((line) => line.origin === '-')
  )
}

function buildHunkHeader(
  hunk: DiffHunk,
  direction: HunkPatchDirection,
  preserveTargetStart: boolean,
): string {
  const match = hunk.header.match(/^@@[^@]+@@(.*)$/)
  const ctx = match ? match[1] : ''
  const oldStart = direction === 'forward' ? hunk.old_start : hunk.new_start
  const oldLines = direction === 'forward' ? hunk.old_lines : hunk.new_lines
  const targetStart = direction === 'forward' ? hunk.new_start : hunk.old_start
  const newLines = direction === 'forward' ? hunk.new_lines : hunk.old_lines
  // libgit2 applies these standalone hunks against the mutable source side.
  // If earlier unapplied hunks shifted the target side, using the target
  // start line here makes libgit2 look in the wrong place.
  const newStart = preserveTargetStart ? targetStart : oldStart
  return `@@ -${oldStart},${oldLines} +${newStart},${newLines} @@${ctx}\n`
}

function lineOrigin(line: DiffLine, direction: HunkPatchDirection): string {
  if (direction === 'forward') return line.origin
  if (line.origin === '-') return '+'
  if (line.origin === '+') return '-'
  return ' '
}

function lineContent(line: DiffLine): string {
  return line.content.endsWith('\n') ? line.content : `${line.content}\n`
}
