import type { CommitInfo } from '@/types/git'

// Lane 颜色走 CSS 变量 (--graph-lane-1..8)，由 main.css 按主题提供具体值。
// CommitGraphRow.vue 通过 style 绑定到 fill/stroke，浏览器解析 var() 以响应主题切换。
export const GRAPH_COLORS = [
  'var(--graph-lane-1)',
  'var(--graph-lane-2)',
  'var(--graph-lane-3)',
  'var(--graph-lane-4)',
  'var(--graph-lane-5)',
  'var(--graph-lane-6)',
  'var(--graph-lane-7)',
  'var(--graph-lane-8)',
]

export const LANE_W = 14  // px per lane
export const ROW_H = 28   // row height px
export const CIRCLE_R = 5 // commit circle radius px

export interface GraphSegment {
  fromCol: number
  toCol: number
  color: string
  /** whether this segment occupies the upper half (above commit circle) */
  upper: boolean
  /** whether this segment occupies the lower half (below commit circle) */
  lower: boolean
}

export interface GraphRow {
  oid: string
  column: number
  color: string
  segments: GraphSegment[]
  totalColumns: number
  /** 该提交不在任何 ref 的可达集合中（仅 reflog 可达） */
  isUnreachable: boolean
  /** 该提交是某条 stash 的根提交 */
  isStash: boolean
}

function laneX(col: number): number {
  return col * LANE_W + LANE_W / 2
}

export { laneX }

/**
 * Computes per-row graph layout data for a list of commits in topological order.
 * Uses a lane-assignment algorithm (pvigier variant):
 *  - Each "lane" holds an OID that is "expected" in that column.
 *  - When a commit is processed, it claims its lane, updates outgoing lane reservations
 *    for its parents, and emits segments for all lines visible in that row.
 */
export function computeGraphLayout(commits: CommitInfo[]): GraphRow[] {
  // lanes[col] = the OID we're waiting for in that column (null = free)
  const lanes: Array<string | null> = []
  const laneColors: string[] = []
  let colorCounter = 0

  const result: GraphRow[] = []

  for (const commit of commits) {
    // ── 1. Find which lane this commit belongs to ──────────────────────
    let myCol = lanes.indexOf(commit.oid)

    if (myCol === -1) {
      // Not reserved yet — pick first free slot or extend
      const freeIdx = lanes.indexOf(null)
      if (freeIdx !== -1) {
        myCol = freeIdx
      } else {
        myCol = lanes.length
        lanes.push(null)
        laneColors.push('')
      }
      laneColors[myCol] = GRAPH_COLORS[colorCounter++ % GRAPH_COLORS.length]
    }

    const myColor = laneColors[myCol]

    // Snapshot the lane state *before* we modify it (= "incoming" state)
    const prevLanes = lanes.slice()
    const prevColors = laneColors.slice()

    // ── 2. Release this commit's lane ──────────────────────────────────
    lanes[myCol] = null

    // ── 3. Assign parents to lanes ────────────────────────────────────
    const parentCols: number[] = []

    for (let pi = 0; pi < commit.parent_oids.length; pi++) {
      const parentOid = commit.parent_oids[pi]

      // Check if parent already has a reserved lane
      const existingCol = lanes.indexOf(parentOid)

      if (existingCol !== -1) {
        // Parent already reserved — no need for a new lane
        parentCols.push(existingCol)
      } else if (pi === 0) {
        // First (primary) parent inherits this commit's lane
        lanes[myCol] = parentOid
        laneColors[myCol] = myColor
        parentCols.push(myCol)
      } else {
        // Additional parent (merge source) — find free slot or extend
        const freeIdx2 = lanes.indexOf(null)
        let newCol: number
        if (freeIdx2 !== -1) {
          newCol = freeIdx2
        } else {
          newCol = lanes.length
          lanes.push(null)
          laneColors.push('')
        }
        laneColors[newCol] = GRAPH_COLORS[colorCounter++ % GRAPH_COLORS.length]
        lanes[newCol] = parentOid
        parentCols.push(newCol)
      }
    }

    // Snapshot *after* modification (= "outgoing" state)
    const nextLanes = lanes.slice()
    const nextColors = laneColors.slice()

    // Trim trailing nulls for display width calculation
    let maxActiveCol = myCol
    for (let c = 0; c < nextLanes.length; c++) {
      if (nextLanes[c] !== null) maxActiveCol = Math.max(maxActiveCol, c)
    }
    for (let c = 0; c < prevLanes.length; c++) {
      if (prevLanes[c] !== null) maxActiveCol = Math.max(maxActiveCol, c)
    }
    // Also include all parentCols
    for (const pc of parentCols) maxActiveCol = Math.max(maxActiveCol, pc)

    const totalColumns = maxActiveCol + 1

    // ── 4. Build segments for this row ────────────────────────────────
    const segments: GraphSegment[] = []

    // Determine all columns that need lines drawn through them
    const allCols = new Set<number>()
    for (let c = 0; c < Math.max(prevLanes.length, nextLanes.length); c++) allCols.add(c)

    for (const col of allCols) {
      const prevOid = prevLanes[col] ?? null
      const nextOid = nextLanes[col] ?? null
      const prevColor = prevColors[col] ?? ''
      const nextColor = nextColors[col] ?? ''

      if (col === myCol) {
        // This is the commit's own column

        // Upper half: incoming line (if there was something flowing through before)
        if (prevOid === commit.oid) {
          // Line was flowing down into this commit
          segments.push({ fromCol: col, toCol: col, color: prevColor, upper: true, lower: false })
        }

        // Lower half: outgoing to primary parent (if lane is still occupied)
        if (nextOid !== null) {
          segments.push({ fromCol: col, toCol: col, color: nextColor, upper: false, lower: true })
        }

        // Additional parent connections (diagonal lower segments)
        for (let pi = 1; pi < parentCols.length; pi++) {
          const targetCol = parentCols[pi]
          if (targetCol !== myCol) {
            segments.push({
              fromCol: myCol,
              toCol: targetCol,
              color: nextColors[targetCol] ?? GRAPH_COLORS[0],
              upper: false,
              lower: true,
            })
          }
        }

        // If primary parent is in a different column (lane merged)
        if (parentCols.length > 0 && parentCols[0] !== myCol) {
          segments.push({
            fromCol: myCol,
            toCol: parentCols[0],
            color: myColor,
            upper: false,
            lower: true,
          })
        }
      } else {
        // Pass-through or converging lane
        const hasUpper = prevOid !== null
        const hasLower = nextOid !== null

        if (hasUpper && hasLower && prevOid === nextOid) {
          // Straight pass-through
          segments.push({ fromCol: col, toCol: col, color: prevColor, upper: true, lower: true })
        } else if (hasUpper && !hasLower) {
          // Line terminates — it was heading to this commit row's myCol
          // Draw upper half converging toward myCol
          segments.push({ fromCol: col, toCol: myCol, color: prevColor, upper: true, lower: false })
        } else if (!hasUpper && hasLower) {
          // New branch starting — coming from myCol (fork)
          segments.push({ fromCol: myCol, toCol: col, color: nextColor, upper: false, lower: true })
        } else if (hasUpper && hasLower && prevOid !== nextOid) {
          // Lane was reassigned — draw both halves independently
          segments.push({ fromCol: col, toCol: col, color: prevColor, upper: true, lower: false })
          segments.push({ fromCol: col, toCol: col, color: nextColor, upper: false, lower: true })
        }
      }
    }

    result.push({
      oid: commit.oid,
      column: myCol,
      color: myColor,
      segments,
      totalColumns,
      isUnreachable: commit.is_unreachable,
      isStash: commit.is_stash,
    })
  }

  return result
}
