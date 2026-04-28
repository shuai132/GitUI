import { describe, expect, it } from 'vitest'
import type { FileEntry } from '@/types/git'
import { findSelectedWipIndex, findWipFileBySelection, isSameWipFile } from '@/utils/wipSelection'

function file(path: string, staged: boolean): FileEntry {
  return {
    path,
    status: 'modified',
    staged,
    additions: 1,
    deletions: 0,
  }
}

describe('wipSelection', () => {
  it('distinguishes identical paths in unstaged and staged sections', () => {
    const files = [
      file('shared.ts', false),
      file('other.ts', false),
      file('shared.ts', true),
      file('later.ts', true),
    ]

    expect(findSelectedWipIndex(files, 'shared.ts', false)).toBe(0)
    expect(findSelectedWipIndex(files, 'shared.ts', true)).toBe(2)
  })

  it('matches selected row by path and staged side when available', () => {
    const unstaged = file('shared.ts', false)
    const staged = file('shared.ts', true)

    expect(isSameWipFile(unstaged, 'shared.ts', false)).toBe(true)
    expect(isSameWipFile(staged, 'shared.ts', false)).toBe(false)
    expect(isSameWipFile(staged, 'shared.ts', true)).toBe(true)
  })

  it('falls back to the same path when the selected side disappeared', () => {
    const files = [file('shared.ts', false)]

    expect(findWipFileBySelection(files, 'shared.ts', true)).toEqual(files[0])
    expect(findWipFileBySelection(files, 'missing.ts', true)).toBeUndefined()
  })
})
