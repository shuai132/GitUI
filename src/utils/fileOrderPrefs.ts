export type FileOrderPlacement = 'front' | 'back' | 'default'

export interface FileOrderBucket {
  front: string[]
  back: string[]
}

export type FileOrderPrefsByRepoPath = Record<string, FileOrderBucket>

export const EMPTY_FILE_ORDER_BUCKET: FileOrderBucket = {
  front: [],
  back: [],
}

const MAX_PATHS_PER_BUCKET = 500

function uniquePaths(paths: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const path of paths) {
    if (!path || seen.has(path)) continue
    seen.add(path)
    result.push(path)
  }
  return result
}

export function normalizeFileOrderBucket(value: unknown): FileOrderBucket {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { front: [], back: [] }
  }

  const record = value as Partial<Record<keyof FileOrderBucket, unknown>>
  const front = Array.isArray(record.front)
    ? uniquePaths(record.front.filter((path): path is string => typeof path === 'string'))
    : []
  const frontSet = new Set(front)
  const back = Array.isArray(record.back)
    ? uniquePaths(record.back.filter((path): path is string => typeof path === 'string'))
        .filter((path) => !frontSet.has(path))
    : []

  return {
    front: front.slice(0, MAX_PATHS_PER_BUCKET),
    back: back.slice(-MAX_PATHS_PER_BUCKET),
  }
}

export function normalizeFileOrderPrefsByRepoPath(value: unknown): FileOrderPrefsByRepoPath {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  const result: FileOrderPrefsByRepoPath = {}
  for (const [repoPath, bucket] of Object.entries(value)) {
    if (!repoPath) continue
    const normalized = normalizeFileOrderBucket(bucket)
    if (normalized.front.length > 0 || normalized.back.length > 0) {
      result[repoPath] = normalized
    }
  }
  return result
}

export function moveFileOrderPaths(
  bucket: FileOrderBucket,
  paths: readonly string[],
  placement: FileOrderPlacement,
): FileOrderBucket {
  const moving = uniquePaths(paths)
  if (moving.length === 0) return normalizeFileOrderBucket(bucket)

  const movingSet = new Set(moving)
  const current = normalizeFileOrderBucket(bucket)
  const front = current.front.filter((path) => !movingSet.has(path))
  const back = current.back.filter((path) => !movingSet.has(path))

  if (placement === 'front') {
    return normalizeFileOrderBucket({ front: [...moving, ...front], back })
  }
  if (placement === 'back') {
    return normalizeFileOrderBucket({ front, back: [...back, ...moving] })
  }
  return normalizeFileOrderBucket({ front, back })
}

export function sortByFileOrder<T>(
  items: readonly T[],
  bucket: FileOrderBucket,
  getPath: (item: T) => string,
): T[] {
  const order = orderedFileIndices(items, bucket, getPath)
  return order.map((index) => items[index])
}

export function orderedFileIndices<T>(
  items: readonly T[],
  bucket: FileOrderBucket,
  getPath: (item: T) => string,
): number[] {
  const normalized = normalizeFileOrderBucket(bucket)
  if (items.length === 0 || (normalized.front.length === 0 && normalized.back.length === 0)) {
    return items.map((_, index) => index)
  }

  const pathToIndices = new Map<string, number[]>()
  items.forEach((item, index) => {
    const path = getPath(item)
    if (!path) return
    const indices = pathToIndices.get(path)
    if (indices) {
      indices.push(index)
    } else {
      pathToIndices.set(path, [index])
    }
  })

  const used = new Set<number>()
  const result: number[] = []
  const pushPathMatches = (path: string) => {
    const indices = pathToIndices.get(path) ?? []
    for (const index of indices) {
      if (used.has(index)) continue
      used.add(index)
      result.push(index)
    }
  }

  normalized.front.forEach(pushPathMatches)

  const backSet = new Set(normalized.back)
  items.forEach((item, index) => {
    if (used.has(index)) return
    if (backSet.has(getPath(item))) return
    used.add(index)
    result.push(index)
  })

  normalized.back.forEach(pushPathMatches)

  return result
}
