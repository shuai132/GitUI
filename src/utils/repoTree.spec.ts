import { describe, expect, it } from 'vitest'
import type { RepoMeta, SubmoduleInfo } from '@/types/git'
import {
  buildRepoTreeRows,
  filterRepoTreeRows,
  normalizeRepoPath,
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
})
