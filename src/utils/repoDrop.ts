export interface DropPoint {
  x: number
  y: number
}

export interface DropRect {
  left: number
  top: number
  right: number
  bottom: number
}

export function toLogicalDropPoint(
  physicalPoint: DropPoint,
  scaleFactor: number,
): DropPoint {
  const scale = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1
  return {
    x: physicalPoint.x / scale,
    y: physicalPoint.y / scale,
  }
}

export function isDropPointInsideRect(
  point: DropPoint,
  rect: DropRect,
  margin = 0,
): boolean {
  return (
    point.x >= rect.left - margin &&
    point.x <= rect.right + margin &&
    point.y >= rect.top - margin &&
    point.y <= rect.bottom + margin
  )
}

export function normalizeDroppedRepoPaths(paths: readonly string[]): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []

  for (const rawPath of paths) {
    let path = rawPath.trim()
    while (path.length > 1 && (path.endsWith('/') || path.endsWith('\\'))) {
      path = path.slice(0, -1)
    }
    if (!path || seen.has(path)) continue
    seen.add(path)
    normalized.push(path)
  }

  return normalized
}
