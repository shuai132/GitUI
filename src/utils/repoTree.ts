import type { RepoMeta, SubmoduleInfo } from '@/types/git'
import { matchesSidebarSearch, normalizeSidebarSearchQuery } from './sidebarSearch'

export interface RepoTreeRow {
  repo: RepoMeta
  depth: number
  sourceIndex: number
  parentRepoId?: string
}

export type SubmodulesByRepoId = Record<string, SubmoduleInfo[]>

interface RepoParentPath {
  full: string
  segments: string[]
}

export function normalizeRepoPath(path: string): string {
  let normalized = path.replace(/\\/g, '/')
  while (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1)
  }
  return normalized
}

function repoParentPath(path: string): RepoParentPath {
  const normalized = normalizeRepoPath(path)
  const separatorIndex = normalized.lastIndexOf('/')
  const full = separatorIndex < 0
    ? '.'
    : separatorIndex === 0
      ? '/'
      : normalized.slice(0, separatorIndex)
  const segments = full === '/' ? ['/'] : full.split('/').filter(Boolean)
  return { full, segments: segments.length > 0 ? segments : [full] }
}

/**
 * 只为同名仓库生成父路径标签，并从路径末尾开始取最短的唯一片段。
 */
export function buildRepoDisambiguationLabels(repos: RepoMeta[]): Map<string, string> {
  const reposByName = new Map<string, RepoMeta[]>()
  for (const repo of repos) {
    const group = reposByName.get(repo.name) ?? []
    group.push(repo)
    reposByName.set(repo.name, group)
  }

  const labels = new Map<string, string>()
  for (const group of reposByName.values()) {
    if (group.length < 2) continue
    const parents = group.map((repo) => ({ repo, parent: repoParentPath(repo.path) }))
    const maxDepth = Math.max(...parents.map(({ parent }) => parent.segments.length))

    let uniqueLabels: string[] | null = null
    for (let depth = 1; depth <= maxDepth; depth++) {
      const candidates = parents.map(({ parent }) =>
        parent.segments.slice(-depth).join('/'),
      )
      if (new Set(candidates).size === group.length) {
        uniqueLabels = candidates
        break
      }
    }

    parents.forEach(({ repo, parent }, index) => {
      labels.set(repo.id, uniqueLabels?.[index] ?? parent.full)
    })
  }
  return labels
}

export function resolveSubmoduleWorkdir(parentPath: string, submodulePath: string): string {
  return normalizeRepoPath(`${normalizeRepoPath(parentPath)}/${submodulePath}`)
}

export function buildRepoTreeRows(
  repos: RepoMeta[],
  submodulesByRepoId: SubmodulesByRepoId,
): RepoTreeRow[] {
  const repoById = new Map(repos.map((repo) => [repo.id, repo]))
  const sourceIndexById = new Map(repos.map((repo, index) => [repo.id, index]))
  const repoIdByPath = new Map(
    repos.map((repo) => [normalizeRepoPath(repo.path), repo.id]),
  )

  const parentByChildId = new Map<string, string>()
  const childrenByParentId = new Map<string, string[]>()

  for (const parentRepo of repos) {
    for (const submodule of submodulesByRepoId[parentRepo.id] ?? []) {
      const childRepoId = repoIdByPath.get(
        resolveSubmoduleWorkdir(parentRepo.path, submodule.path),
      )
      if (!childRepoId || childRepoId === parentRepo.id || parentByChildId.has(childRepoId)) {
        continue
      }
      parentByChildId.set(childRepoId, parentRepo.id)
      const children = childrenByParentId.get(parentRepo.id) ?? []
      children.push(childRepoId)
      childrenByParentId.set(parentRepo.id, children)
    }
  }

  for (const children of childrenByParentId.values()) {
    children.sort((a, b) => (sourceIndexById.get(a) ?? 0) - (sourceIndexById.get(b) ?? 0))
  }

  const roots = repos
    .filter((repo) => !parentByChildId.has(repo.id))
    .map((repo) => repo.id)
  const rootIds = roots.length > 0 ? roots : repos.map((repo) => repo.id)
  const rows: RepoTreeRow[] = []
  const visited = new Set<string>()

  function append(repoId: string, depth: number, parentRepoId?: string) {
    if (visited.has(repoId)) return
    const repo = repoById.get(repoId)
    if (!repo) return
    visited.add(repoId)
    rows.push({
      repo,
      depth,
      sourceIndex: sourceIndexById.get(repoId) ?? rows.length,
      parentRepoId,
    })

    for (const childRepoId of childrenByParentId.get(repoId) ?? []) {
      append(childRepoId, depth + 1, repoId)
    }
  }

  for (const repoId of rootIds) {
    append(repoId, 0)
  }
  for (const repo of repos) {
    append(repo.id, 0)
  }

  return rows
}

export function filterRepoTreeRows(rows: RepoTreeRow[], query: string): RepoTreeRow[] {
  if (!normalizeSidebarSearchQuery(query)) return rows

  const parentByRepoId = new Map(
    rows.flatMap((row) => row.parentRepoId ? [[row.repo.id, row.parentRepoId] as const] : []),
  )
  const includedRepoIds = new Set<string>()

  for (const row of rows) {
    if (!matchesSidebarSearch(query, row.repo.name, row.repo.path)) continue
    includedRepoIds.add(row.repo.id)

    let parentRepoId = parentByRepoId.get(row.repo.id)
    while (parentRepoId) {
      includedRepoIds.add(parentRepoId)
      parentRepoId = parentByRepoId.get(parentRepoId)
    }
  }

  return rows.filter((row) => includedRepoIds.has(row.repo.id))
}

/**
 * 搜索结果会保留 Submodule 的父仓库作为视觉上下文；键盘选择只应停在
 * 真正匹配名称或路径的行，避免 Enter 误切到未匹配的父仓库。
 */
export function repoSearchCandidateRows(
  visibleRows: RepoTreeRow[],
  query: string,
): RepoTreeRow[] {
  if (!normalizeSidebarSearchQuery(query)) return visibleRows
  return visibleRows.filter((row) =>
    matchesSidebarSearch(query, row.repo.name, row.repo.path),
  )
}

export function moveRepoSearchSelection(
  currentIndex: number,
  delta: -1 | 1,
  rowCount: number,
): number {
  if (rowCount <= 0) return -1
  if (currentIndex < 0 || currentIndex >= rowCount) {
    return delta > 0 ? 0 : rowCount - 1
  }
  return (currentIndex + delta + rowCount) % rowCount
}
