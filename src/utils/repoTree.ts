import type { RepoMeta, SubmoduleInfo } from '@/types/git'
import { matchesSidebarSearch, normalizeSidebarSearchQuery } from './sidebarSearch'

export interface RepoTreeRow {
  repo: RepoMeta
  depth: number
  sourceIndex: number
  parentRepoId?: string
}

export type SubmodulesByRepoId = Record<string, SubmoduleInfo[]>

export function normalizeRepoPath(path: string): string {
  let normalized = path.replace(/\\/g, '/')
  while (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1)
  }
  return normalized
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
