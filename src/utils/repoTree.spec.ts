import { describe, expect, it } from 'vitest'
import type { RepoMeta, SubmoduleInfo } from '@/types/git'
import {
  buildRepoTreeRows,
  filterRepoTreeRows,
  moveRepoSearchSelection,
  normalizeRepoPath,
  repoSearchCandidateRows,
  resolveSubmoduleWorkdir,
} from '@/utils/repoTree'

function repo(id: string, path: string): RepoMeta {
  return { id, path, name: id }
}

function submodule(path: string): SubmoduleInfo {
  return {
    name: path,
    path,
    state: 'up_to_date',
    has_workdir_modifications: false,
  }
}

describe('repoTree', () => {
  it('normalizes separators and trailing slashes', () => {
    expect(normalizeRepoPath('C:\\work\\repo\\')).toBe('C:/work/repo')
    expect(resolveSubmoduleWorkdir('/work/parent/', 'libs/child')).toBe('/work/parent/libs/child')
  })

  it('places opened submodule repositories under their parent repository', () => {
    const repos = [
      repo('parent', '/work/parent'),
      repo('sibling', '/work/sibling'),
      repo('child', '/work/parent/libs/child'),
    ]

    const rows = buildRepoTreeRows(repos, {
      parent: [submodule('libs/child')],
    })

    expect(rows.map((row) => [row.repo.id, row.depth, row.parentRepoId ?? null])).toEqual([
      ['parent', 0, null],
      ['child', 1, 'parent'],
      ['sibling', 0, null],
    ])
  })

  it('keeps regular nested repositories flat when they are not listed as submodules', () => {
    const repos = [
      repo('parent', '/work/parent'),
      repo('nested', '/work/parent/tools/nested'),
    ]

    const rows = buildRepoTreeRows(repos, {})

    expect(rows.map((row) => [row.repo.id, row.depth])).toEqual([
      ['parent', 0],
      ['nested', 0],
    ])
  })

  it('filters repositories by name or path and preserves matching ancestors', () => {
    const rows = buildRepoTreeRows(
      [
        repo('parent', '/work/parent'),
        repo('sibling', '/work/sibling'),
        repo('child', '/work/parent/libs/payment-sdk'),
      ],
      { parent: [submodule('libs/payment-sdk')] },
    )

    expect(filterRepoTreeRows(rows, 'PAYMENT').map((row) => row.repo.id)).toEqual([
      'parent',
      'child',
    ])
    expect(filterRepoTreeRows(rows, 'sibling').map((row) => row.repo.id)).toEqual(['sibling'])
    expect(filterRepoTreeRows(rows, '  ')).toBe(rows)
  })

  it('keeps parent context visible but excludes it from keyboard candidates', () => {
    const rows = buildRepoTreeRows(
      [
        repo('parent', '/work/parent'),
        repo('child', '/work/parent/vendor/payment-child'),
      ],
      { parent: [submodule('vendor/payment-child')] },
    )
    const visible = filterRepoTreeRows(rows, 'child')

    expect(visible.map((row) => row.repo.id)).toEqual(['parent', 'child'])
    expect(repoSearchCandidateRows(visible, 'child').map((row) => row.repo.id)).toEqual([
      'child',
    ])
  })

  it('cycles keyboard selection through repository candidates', () => {
    expect(moveRepoSearchSelection(-1, 1, 3)).toBe(0)
    expect(moveRepoSearchSelection(-1, -1, 3)).toBe(2)
    expect(moveRepoSearchSelection(2, 1, 3)).toBe(0)
    expect(moveRepoSearchSelection(0, -1, 3)).toBe(2)
    expect(moveRepoSearchSelection(0, 1, 0)).toBe(-1)
  })
})
