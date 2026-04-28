/**
 * wordDiff.ts — 字符级 diff 工具
 *
 * 使用 LCS 算法对两个字符串做逐字符对比，返回一组 DiffToken，
 * 分别标记 `eq`（相同）、`del`（仅左侧有）、`add`（仅右侧有）。
 *
 * 使用场景：在 SideBySideDiff 和 InlineDiff 的配对 del/add 行中
 * 高亮行内的具体变化片段，提升可读性。
 *
 * 性能注意：单行超过 MAX_LEN 字符时退化为整行高亮，避免 O(N²) 卡顿。
 */

export type DiffTokenKind = 'eq' | 'del' | 'add'

export interface DiffToken {
  kind: DiffTokenKind
  text: string
}

const MAX_LEN = 500

/**
 * 对两个字符串做字符级 diff。
 * 返回 `left` 侧的 token 序列（含 eq/del）和 `right` 侧的 token 序列（含 eq/add）。
 */
export function diffChars(
  left: string,
  right: string,
): { leftTokens: DiffToken[]; rightTokens: DiffToken[] } {
  // 超长行退化为整行标注
  if (left.length > MAX_LEN || right.length > MAX_LEN) {
    return {
      leftTokens: [{ kind: 'del', text: left }],
      rightTokens: [{ kind: 'add', text: right }],
    }
  }

  // 完全相同的快速路径
  if (left === right) {
    return {
      leftTokens: [{ kind: 'eq', text: left }],
      rightTokens: [{ kind: 'eq', text: right }],
    }
  }

  const ops = lcsDiff(left, right)

  const leftTokens: DiffToken[] = []
  const rightTokens: DiffToken[] = []

  for (const op of ops) {
    if (op.kind === 'eq') {
      leftTokens.push({ kind: 'eq', text: op.text })
      rightTokens.push({ kind: 'eq', text: op.text })
    } else if (op.kind === 'del') {
      leftTokens.push({ kind: 'del', text: op.text })
    } else {
      rightTokens.push({ kind: 'add', text: op.text })
    }
  }

  return { leftTokens, rightTokens }
}

// ── LCS 算法核心 ──────────────────────────────────────────────────────

interface Op {
  kind: 'eq' | 'del' | 'add'
  text: string
}

function lcsDiff(a: string, b: string): Op[] {
  const n = a.length
  const m = b.length

  if (n === 0 && m === 0) return []
  if (n === 0) return [{ kind: 'add', text: b }]
  if (m === 0) return [{ kind: 'del', text: a }]

  let prefixLen = 0
  while (prefixLen < n && prefixLen < m && a[prefixLen] === b[prefixLen]) {
    prefixLen++
  }

  let suffixLen = 0
  while (
    suffixLen < n - prefixLen &&
    suffixLen < m - prefixLen &&
    a[n - 1 - suffixLen] === b[m - 1 - suffixLen]
  ) {
    suffixLen++
  }

  const prefix = a.slice(0, prefixLen)
  const suffix = a.slice(n - suffixLen)
  const midA = a.slice(prefixLen, n - suffixLen)
  const midB = b.slice(prefixLen, m - suffixLen)

  const ops: Op[] = []
  if (prefix) ops.push({ kind: 'eq', text: prefix })
  ops.push(...lcsMiddleDiff(midA, midB))
  if (suffix) ops.push({ kind: 'eq', text: suffix })

  return mergeOps(ops)
}

function lcsMiddleDiff(a: string, b: string): Op[] {
  const n = a.length
  const m = b.length
  if (n === 0 && m === 0) return []
  if (n === 0) return [{ kind: 'add', text: b }]
  if (m === 0) return [{ kind: 'del', text: a }]

  const width = m + 1
  const lengths = new Uint16Array((n + 1) * width)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const idx = i * width + j
      if (a[i] === b[j]) {
        lengths[idx] = lengths[(i + 1) * width + j + 1] + 1
      } else {
        const delLen = lengths[(i + 1) * width + j]
        const addLen = lengths[i * width + j + 1]
        lengths[idx] = delLen >= addLen ? delLen : addLen
      }
    }
  }

  const ops: Op[] = []
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      ops.push({ kind: 'eq', text: a[i] })
      i++
      j++
    } else if (
      j >= m ||
      (i < n && lengths[(i + 1) * width + j] >= lengths[i * width + j + 1])
    ) {
      ops.push({ kind: 'del', text: a[i] })
      i++
    } else {
      ops.push({ kind: 'add', text: b[j] })
      j++
    }
  }

  return mergeOps(ops)
}

function mergeOps(ops: Op[]): Op[] {
  if (ops.length === 0) return []
  const merged: Op[] = [{ ...ops[0] }]
  for (let i = 1; i < ops.length; i++) {
    const last = merged[merged.length - 1]
    if (ops[i].kind === last.kind) {
      last.text += ops[i].text
    } else {
      merged.push({ ...ops[i] })
    }
  }
  return merged
}

/**
 * 将 DiffToken[] 渲染成安全的 HTML 字符串（转义 < > &）。
 * `kind` 为 'del' 或 'add' 时套 `<mark class="word-del/add">` 标签。
 * `kind` 为 'eq' 时直接转义输出（保留空格）。
 */
export function tokensToHtml(tokens: DiffToken[]): string {
  return tokens
    .map((t) => {
      const escaped = escHtml(t.text)
      if (t.kind === 'eq') return escaped
      return `<mark class="word-${t.kind}">${escaped}</mark>`
    })
    .join('')
}

function escHtml(s: string): string {
  if (typeof s !== 'string') return ''
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
