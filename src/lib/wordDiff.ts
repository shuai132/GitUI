/**
 * wordDiff.ts — 字符级 diff 工具
 *
 * 使用 Myers LCS 算法对两个字符串做逐字符对比，返回一组 DiffToken，
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
 * 对两个字符串做字符级 Myers diff。
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

  const ops = myersDiff(left, right)

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

// ── Myers 算法核心 ────────────────────────────────────────────────────

interface Op {
  kind: 'eq' | 'del' | 'add'
  text: string
}

function myersDiff(a: string, b: string): Op[] {
  const n = a.length
  const m = b.length
  const max = n + m

  if (max === 0) return []

  // V[k] = 最远到达 x（在 diagonal k = x - y 上）
  const V: Int32Array = new Int32Array(2 * max + 2)
  // trace[d] = 该步 V 的快照（用于回溯）
  const trace: Int32Array[] = []

  outer: for (let d = 0; d <= max; d++) {
    trace.push(new Int32Array(V))
    for (let k = -d; k <= d; k += 2) {
      let x: number
      const kIdx = k + max
      if (k === -d || (k !== d && V[kIdx - 1] < V[kIdx + 1])) {
        x = V[kIdx + 1]
      } else {
        x = V[kIdx - 1] + 1
      }
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x++
        y++
      }
      V[kIdx] = x
      if (x >= n && y >= m) {
        trace.push(new Int32Array(V))
        break outer
      }
    }
  }

  return backtrack(a, b, trace, max)
}

function backtrack(
  a: string,
  b: string,
  trace: Int32Array[],
  offset: number,
): Op[] {
  const ops: Op[] = []
  let x = a.length
  let y = b.length

  for (let d = trace.length - 1; d >= 0; d--) {
    const V = trace[d]
    const k = x - y
    const kIdx = k + offset

    let prevK: number
    if (k === -d || (k !== d && V[kIdx - 1] < V[kIdx + 1])) {
      prevK = k + 1
    } else {
      prevK = k - 1
    }

    const prevX = V[prevK + offset]
    const prevY = prevX - prevK

    // 对角线（相等）
    while (x > prevX + 1 && y > prevY + 1 && x > 0 && y > 0) {
      x--; y--
      ops.unshift({ kind: 'eq', text: a[x] })
    }

    if (d > 0) {
      if (x === prevX) {
        ops.unshift({ kind: 'add', text: b[y - 1] })
        y--
      } else {
        ops.unshift({ kind: 'del', text: a[x - 1] })
        x--
      }
    }

    // 最后一段对角线
    while (x > prevX && y > prevY && x > 0 && y > 0) {
      x--; y--
      ops.unshift({ kind: 'eq', text: a[x] })
    }
  }

  // 合并相邻同类 token，减少 DOM 节点数
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
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
