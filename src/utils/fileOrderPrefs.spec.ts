import { describe, expect, it } from 'vitest'
import {
  moveFileOrderPaths,
  normalizeFileOrderBucket,
  normalizeFileOrderPrefsByRepoPath,
  orderedFileIndices,
  sortByFileOrder,
  type FileOrderBucket,
} from '@/utils/fileOrderPrefs'

const files = ['src/app.ts', 'package-lock.json', 'README.md', 'dist/index.js']

function pathOf(path: string): string {
  return path
}

describe('fileOrderPrefs', () => {
  it('moves front paths before unchanged files and back paths after them', () => {
    const bucket: FileOrderBucket = {
      front: ['README.md'],
      back: ['package-lock.json'],
    }

    expect(sortByFileOrder(files, bucket, pathOf)).toEqual([
      'README.md',
      'src/app.ts',
      'dist/index.js',
      'package-lock.json',
    ])
  })

  it('keeps unrecorded files in their original relative order', () => {
    const bucket: FileOrderBucket = {
      front: ['dist/index.js'],
      back: [],
    }

    expect(sortByFileOrder(files, bucket, pathOf)).toEqual([
      'dist/index.js',
      'src/app.ts',
      'package-lock.json',
      'README.md',
    ])
  })

  it('returns ordered original indices for commit diff selection', () => {
    const bucket: FileOrderBucket = {
      front: ['README.md'],
      back: ['src/app.ts'],
    }

    expect(orderedFileIndices(files, bucket, pathOf)).toEqual([2, 1, 3, 0])
  })

  it('moves multiple paths as a block and keeps their visual order', () => {
    const bucket = moveFileOrderPaths(
      { front: ['existing.txt'], back: ['package-lock.json'] },
      ['README.md', 'dist/index.js'],
      'front',
    )

    expect(bucket).toEqual({
      front: ['README.md', 'dist/index.js', 'existing.txt'],
      back: ['package-lock.json'],
    })
  })

  it('moves a path between front and back without duplicates', () => {
    const bucket = moveFileOrderPaths(
      { front: ['README.md'], back: ['package-lock.json'] },
      ['README.md', 'package-lock.json'],
      'back',
    )

    expect(bucket).toEqual({
      front: [],
      back: ['README.md', 'package-lock.json'],
    })
  })

  it('removes paths when restoring the default position', () => {
    const bucket = moveFileOrderPaths(
      { front: ['README.md'], back: ['package-lock.json'] },
      ['README.md'],
      'default',
    )

    expect(bucket).toEqual({
      front: [],
      back: ['package-lock.json'],
    })
  })

  it('normalizes bad bucket and repo preference data', () => {
    expect(normalizeFileOrderBucket({
      front: ['a.txt', 'a.txt', 1],
      back: ['a.txt', 'b.txt', null],
    })).toEqual({
      front: ['a.txt'],
      back: ['b.txt'],
    })

    expect(normalizeFileOrderPrefsByRepoPath({
      '/repo/a': { front: ['a.txt'], back: [] },
      '/repo/b': { front: [], back: ['b.txt'] },
      '/repo/empty': { front: [], back: [] },
      '': { front: ['ignored.txt'], back: [] },
      '/repo/bad': 'bad',
    })).toEqual({
      '/repo/a': { front: ['a.txt'], back: [] },
      '/repo/b': { front: [], back: ['b.txt'] },
    })
  })
})
