import { highlightLine } from '@/lib/highlight'
import { diffChars, tokensToHtml, type DiffToken, type DiffTokenKind } from '@/lib/wordDiff'

interface ChangeRange {
  start: number
  end: number
}

type PlaceholderKind = 'del-placeholder' | 'add-placeholder'

interface Placeholder {
  kind: PlaceholderKind
  offset: number
}

type RenderTokenKind = DiffTokenKind | PlaceholderKind

interface RenderToken {
  kind: RenderTokenKind
  text: string
}

export interface DiffLinePairHtml {
  leftHtml: string
  rightHtml: string
}

const MIN_INLINE_DIFF_SIMILARITY = 0.55
const MAX_TOKEN_COUNT = 200

type SegmentKind = 'word' | 'cjk' | 'space' | 'punct'

interface Segment {
  kind: SegmentKind
  text: string
}

interface SegmentOp {
  kind: DiffTokenKind
  left?: Segment
  right?: Segment
}

export function diffLinePairHtml(
  left: string,
  right: string,
  leftLang: string | null,
  rightLang: string | null,
): DiffLinePairHtml {
  const raw = diffChars(left, right)
  if (isWholeLineFallback(left, right, raw.leftTokens, raw.rightTokens)) {
    return {
      leftHtml: renderDiffLineHtml(left, raw.leftTokens, 'del', leftLang),
      rightHtml: renderDiffLineHtml(right, raw.rightTokens, 'add', rightLang),
    }
  }

  if (lineSimilarity(left, right, raw.leftTokens) < MIN_INLINE_DIFF_SIMILARITY) {
    return {
      leftHtml: highlightLine(left, leftLang),
      rightHtml: highlightLine(right, rightLang),
    }
  }

  const { leftTokens, rightTokens } = diffBySegments(left, right) ?? raw
  return {
    leftHtml: renderDiffLineHtml(left, leftTokens, 'del', leftLang),
    rightHtml: renderDiffLineHtml(right, rightTokens, 'add', rightLang),
  }
}

function isWholeLineFallback(
  left: string,
  right: string,
  leftTokens: DiffToken[],
  rightTokens: DiffToken[],
): boolean {
  return (
    leftTokens.length === 1 &&
    rightTokens.length === 1 &&
    leftTokens[0].kind === 'del' &&
    rightTokens[0].kind === 'add' &&
    leftTokens[0].text === left &&
    rightTokens[0].text === right
  )
}

function lineSimilarity(left: string, right: string, tokens: DiffToken[]): number {
  const maxLength = Math.max(left.length, right.length)
  if (maxLength === 0) return 1

  const equalLength = tokens.reduce(
    (sum, token) => sum + (token.kind === 'eq' ? token.text.length : 0),
    0,
  )
  return equalLength / maxLength
}

function diffBySegments(
  left: string,
  right: string,
): { leftTokens: RenderToken[]; rightTokens: RenderToken[] } | null {
  const leftSegments = splitSegments(left)
  const rightSegments = splitSegments(right)
  if (leftSegments.length > MAX_TOKEN_COUNT || rightSegments.length > MAX_TOKEN_COUNT) {
    return null
  }

  const ops = segmentOps(leftSegments, rightSegments)
  const leftTokens: RenderToken[] = []
  const rightTokens: RenderToken[] = []

  let delBuffer: Segment[] = []
  let addBuffer: Segment[] = []

  const flushChanges = () => {
    const maxLen = Math.max(delBuffer.length, addBuffer.length)
    for (let i = 0; i < maxLen; i++) {
      appendChangedSegmentPair(
        delBuffer[i],
        addBuffer[i],
        leftTokens,
        rightTokens,
        delBuffer.length > 0 && addBuffer.length > 0,
      )
    }
    delBuffer = []
    addBuffer = []
  }

  for (const op of ops) {
    if (op.kind === 'eq') {
      flushChanges()
      appendRenderToken(leftTokens, { kind: 'eq', text: op.left?.text ?? '' })
      appendRenderToken(rightTokens, { kind: 'eq', text: op.right?.text ?? '' })
    } else if (op.kind === 'del' && op.left) {
      delBuffer.push(op.left)
    } else if (op.kind === 'add' && op.right) {
      addBuffer.push(op.right)
    }
  }
  flushChanges()

  return { leftTokens, rightTokens }
}

function appendChangedSegmentPair(
  left: Segment | undefined,
  right: Segment | undefined,
  leftTokens: RenderToken[],
  rightTokens: RenderToken[],
  isReplacementRun: boolean,
) {
  if (left && right && left.kind === 'word' && right.kind === 'word') {
    const inner = diffIdentifierParts(left.text, right.text, isReplacementRun)
    if (inner) {
      inner.leftTokens.forEach((token) => appendRenderToken(leftTokens, token))
      inner.rightTokens.forEach((token) => appendRenderToken(rightTokens, token))
      return
    }
  }

  if (left && right && left.kind === right.kind && left.kind !== 'word') {
    const { leftTokens: innerLeft, rightTokens: innerRight } = diffChars(left.text, right.text)
    innerLeft.forEach((token) => appendRenderToken(leftTokens, token.kind === 'add' ? { kind: 'del', text: token.text } : token))
    innerRight.forEach((token) => appendRenderToken(rightTokens, token.kind === 'del' ? { kind: 'add', text: token.text } : token))
    return
  }

  if (left) appendRenderToken(leftTokens, { kind: 'del', text: left.text })
  if (!left && right && !isReplacementRun) appendRenderToken(leftTokens, { kind: 'add-placeholder', text: '' })
  if (right) appendRenderToken(rightTokens, { kind: 'add', text: right.text })
  if (!right && left && !isReplacementRun) appendRenderToken(rightTokens, { kind: 'del-placeholder', text: '' })
}

function diffIdentifierParts(
  left: string,
  right: string,
  isReplacementRun: boolean,
): { leftTokens: RenderToken[]; rightTokens: RenderToken[] } | null {
  const leftParts = splitIdentifierParts(left)
  const rightParts = splitIdentifierParts(right)
  const ops = partOps(leftParts, rightParts)
  const hasEqualPart = ops.some((op) => op.kind === 'eq')
  if (!hasEqualPart) return null

  const leftTokens: RenderToken[] = []
  const rightTokens: RenderToken[] = []
  let delBuffer: string[] = []
  let addBuffer: string[] = []

  const flushChanges = () => {
    const maxLen = Math.max(delBuffer.length, addBuffer.length)
    const hasBothSides = delBuffer.length > 0 && addBuffer.length > 0
    for (let i = 0; i < maxLen; i++) {
      const del = delBuffer[i]
      const add = addBuffer[i]
      if (del !== undefined) appendRenderToken(leftTokens, { kind: 'del', text: del })
      if (del === undefined && add !== undefined && (!isReplacementRun || !hasBothSides)) {
        appendRenderToken(leftTokens, { kind: 'add-placeholder', text: '' })
      }
      if (add !== undefined) appendRenderToken(rightTokens, { kind: 'add', text: add })
      if (add === undefined && del !== undefined && (!isReplacementRun || !hasBothSides)) {
        appendRenderToken(rightTokens, { kind: 'del-placeholder', text: '' })
      }
    }
    delBuffer = []
    addBuffer = []
  }

  for (const op of ops) {
    if (op.kind === 'eq') {
      flushChanges()
      appendRenderToken(leftTokens, { kind: 'eq', text: op.text })
      appendRenderToken(rightTokens, { kind: 'eq', text: op.text })
    } else if (op.kind === 'del') {
      delBuffer.push(op.text)
    } else {
      addBuffer.push(op.text)
    }
  }
  flushChanges()

  return { leftTokens, rightTokens }
}

function splitIdentifierParts(value: string): string[] {
  const parts: string[] = []
  let current = ''
  let prefix = ''

  for (const char of value) {
    if (char === '_') {
      if (current) {
        parts.push(current)
        current = ''
      }
      prefix += char
      continue
    }

    if (current && isCamelBoundary(current, char)) {
      parts.push(current)
      current = ''
    }

    if (!current && prefix) {
      current = prefix
      prefix = ''
    }
    current += char
  }

  if (current) parts.push(current)
  if (prefix) parts.push(prefix)
  return parts.length > 0 ? parts : [value]
}

function isCamelBoundary(current: string, nextChar: string): boolean {
  const prev = current[current.length - 1]
  return /[a-z0-9]/.test(prev) && /[A-Z]/.test(nextChar)
}

interface PartOp {
  kind: DiffTokenKind
  text: string
}

function partOps(left: string[], right: string[]): PartOp[] {
  const n = left.length
  const m = right.length
  const width = m + 1
  const lengths = new Uint16Array((n + 1) * width)

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const idx = i * width + j
      if (left[i] === right[j]) {
        lengths[idx] = lengths[(i + 1) * width + j + 1] + 1
      } else {
        const delLen = lengths[(i + 1) * width + j]
        const addLen = lengths[i * width + j + 1]
        lengths[idx] = delLen >= addLen ? delLen : addLen
      }
    }
  }

  const ops: PartOp[] = []
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && left[i] === right[j]) {
      ops.push({ kind: 'eq', text: left[i] })
      i++
      j++
    } else if (
      j >= m ||
      (i < n && lengths[(i + 1) * width + j] >= lengths[i * width + j + 1])
    ) {
      ops.push({ kind: 'del', text: left[i] })
      i++
    } else {
      ops.push({ kind: 'add', text: right[j] })
      j++
    }
  }

  return ops
}

function splitSegments(value: string): Segment[] {
  const segments: Segment[] = []
  let current: Segment | null = null

  for (const char of value) {
    const kind = segmentKind(char)
    if (kind !== 'cjk' && kind !== 'punct' && current !== null && current.kind === kind) {
      current.text += char
    } else {
      current = { kind, text: char }
      segments.push(current)
    }
  }

  return segments
}

function segmentKind(char: string): SegmentKind {
  if (/\s/.test(char)) return 'space'
  if (/\p{Script=Han}/u.test(char)) return 'cjk'
  if (/[\p{L}\p{N}_]/u.test(char)) return 'word'
  return 'punct'
}

function segmentOps(left: Segment[], right: Segment[]): SegmentOp[] {
  const n = left.length
  const m = right.length
  const width = m + 1
  const lengths = new Uint16Array((n + 1) * width)

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const idx = i * width + j
      if (segmentsEqual(left[i], right[j])) {
        lengths[idx] = lengths[(i + 1) * width + j + 1] + 1
      } else {
        const delLen = lengths[(i + 1) * width + j]
        const addLen = lengths[i * width + j + 1]
        lengths[idx] = delLen >= addLen ? delLen : addLen
      }
    }
  }

  const ops: SegmentOp[] = []
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && segmentsEqual(left[i], right[j])) {
      ops.push({ kind: 'eq', left: left[i], right: right[j] })
      i++
      j++
    } else if (
      j >= m ||
      (i < n && lengths[(i + 1) * width + j] >= lengths[i * width + j + 1])
    ) {
      ops.push({ kind: 'del', left: left[i] })
      i++
    } else {
      ops.push({ kind: 'add', right: right[j] })
      j++
    }
  }

  return ops
}

function segmentsEqual(left: Segment, right: Segment): boolean {
  return left.kind === right.kind && left.text === right.text
}

function appendRenderToken(tokens: RenderToken[], token: RenderToken) {
  if (isPlaceholderKind(token.kind)) {
    const last = tokens[tokens.length - 1]
    if (last?.kind === token.kind) return
    tokens.push({ ...token })
    return
  }
  if (token.text.length === 0) return
  const last = tokens[tokens.length - 1]
  if (last?.kind === token.kind) {
    last.text += token.text
  } else {
    tokens.push({ ...token })
  }
}

function appendToken(tokens: DiffToken[], token: DiffToken) {
  if (token.text.length === 0) return
  const last = tokens[tokens.length - 1]
  if (last?.kind === token.kind) {
    last.text += token.text
  } else {
    tokens.push({ ...token })
  }
}

function isPlaceholderKind(kind: RenderTokenKind): kind is PlaceholderKind {
  return kind === 'del-placeholder' || kind === 'add-placeholder'
}

function renderDiffLineHtml(
  content: string,
  tokens: RenderToken[],
  changeKind: Extract<DiffTokenKind, 'del' | 'add'>,
  lang: string | null,
): string {
  if (!lang) return renderPlainTokens(tokens)

  const ranges = changedRanges(tokens, changeKind)
  const placeholders = placeholderPositions(tokens)
  const highlighted = highlightLine(content, lang)
  if (ranges.length === 0 && placeholders.length === 0) return highlighted
  return wrapHighlightedRanges(highlighted, ranges, placeholders, `word-${changeKind}`)
}

function changedRanges(
  tokens: RenderToken[],
  changeKind: Extract<DiffTokenKind, 'del' | 'add'>,
): ChangeRange[] {
  const ranges: ChangeRange[] = []
  let offset = 0
  for (const token of tokens) {
    const nextOffset = offset + token.text.length
    if (token.kind === changeKind && nextOffset > offset) {
      ranges.push({ start: offset, end: nextOffset })
    }
    offset = nextOffset
  }
  return ranges
}

function placeholderPositions(tokens: RenderToken[]): Placeholder[] {
  const placeholders: Placeholder[] = []
  let offset = 0
  for (const token of tokens) {
    if (isPlaceholderKind(token.kind)) {
      placeholders.push({ kind: token.kind, offset })
    }
    offset += token.text.length
  }
  return placeholders
}

function renderPlainTokens(tokens: RenderToken[]): string {
  return tokens
    .map((token) => {
      if (isPlaceholderKind(token.kind)) return placeholderHtml(token.kind)
      return tokensToHtml([{ kind: token.kind, text: token.text }])
    })
    .join('')
}

function wrapHighlightedRanges(
  html: string,
  ranges: ChangeRange[],
  placeholders: Placeholder[],
  className: string,
): string {
  let result = ''
  let sourceIndex = 0
  let displayIndex = 0
  let rangeIndex = 0
  let placeholderIndex = 0
  let markOpen = false

  const closeMark = () => {
    if (!markOpen) return
    result += '</mark>'
    markOpen = false
  }

  const shouldMark = () => {
    while (rangeIndex < ranges.length && displayIndex >= ranges[rangeIndex].end) {
      rangeIndex++
    }
    const range = ranges[rangeIndex]
    return range !== undefined && displayIndex >= range.start && displayIndex < range.end
  }

  const appendPlaceholders = () => {
    if (
      placeholderIndex >= placeholders.length ||
      placeholders[placeholderIndex].offset !== displayIndex
    ) {
      return
    }
    closeMark()
    while (placeholderIndex < placeholders.length && placeholders[placeholderIndex].offset === displayIndex) {
      result += placeholderHtml(placeholders[placeholderIndex].kind)
      placeholderIndex++
    }
  }

  while (sourceIndex < html.length) {
    appendPlaceholders()

    if (html[sourceIndex] === '<') {
      closeMark()
      const tagEnd = html.indexOf('>', sourceIndex)
      if (tagEnd === -1) {
        result += html.slice(sourceIndex)
        break
      }
      result += html.slice(sourceIndex, tagEnd + 1)
      sourceIndex = tagEnd + 1
      continue
    }

    const markCurrent = shouldMark()
    if (markCurrent && !markOpen) {
      result += `<mark class="${className}">`
      markOpen = true
    } else if (!markCurrent) {
      closeMark()
    }

    const entityEnd = html[sourceIndex] === '&' ? html.indexOf(';', sourceIndex + 1) : -1
    if (entityEnd !== -1) {
      result += html.slice(sourceIndex, entityEnd + 1)
      sourceIndex = entityEnd + 1
    } else {
      result += html[sourceIndex]
      sourceIndex++
    }
    displayIndex++
  }

  appendPlaceholders()
  closeMark()
  return result
}

function placeholderHtml(kind: PlaceholderKind): string {
  const className = kind === 'del-placeholder' ? 'word-del word-placeholder' : 'word-add word-placeholder'
  return `<mark class="${className}"></mark>`
}
