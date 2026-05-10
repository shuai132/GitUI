import { describe, expect, it } from 'vitest'
import type { FileDiff, SubmoduleInfo, SubmoduleState } from '@/types/git'
import {
  GITLINK_FILE_MODE,
  buildSubmodulePathSet,
  canOpenSubmodule,
  findSubmoduleByPath,
  findSubmoduleForDiff,
  isGitlinkFileMode,
  isSubmodulePath,
} from '@/utils/submodules'

function submodule(path: string, state: SubmoduleState): SubmoduleInfo {
  return {
    name: path,
    path,
    state,
    has_workdir_modifications: false,
  }
}

function diff(oldPath?: string, newPath?: string): Pick<FileDiff, 'old_path' | 'new_path'> {
  return {
    old_path: oldPath,
    new_path: newPath,
  }
}

describe('submodule utils', () => {
  it('matches submodule paths from a shared path set', () => {
    const paths = buildSubmodulePathSet(['libs/core', 'vendor/ui'])

    expect(isSubmodulePath(paths, 'libs/core')).toBe(true)
    expect(isSubmodulePath(paths, 'libs/core/src/index.ts')).toBe(false)
    expect(isSubmodulePath(paths, undefined)).toBe(false)
  })

  it('finds submodules by direct path and diff sides', () => {
    const submodules = [
      submodule('libs/core', 'up_to_date'),
      submodule('vendor/ui', 'modified'),
    ]

    expect(findSubmoduleByPath(submodules, 'vendor/ui')?.name).toBe('vendor/ui')
    expect(findSubmoduleForDiff(submodules, diff('old/path', 'libs/core'))?.name).toBe('libs/core')
    expect(findSubmoduleForDiff(submodules, diff('vendor/ui', undefined))?.name).toBe('vendor/ui')
    expect(findSubmoduleForDiff(submodules, diff('docs/readme.md', undefined))).toBeUndefined()
  })

  it('allows opening only submodules with an available workdir', () => {
    expect(canOpenSubmodule(submodule('ready', 'up_to_date'))).toBe(true)
    expect(canOpenSubmodule(submodule('dirty', 'modified'))).toBe(true)
    expect(canOpenSubmodule(submodule('pending-init', 'uninitialized'))).toBe(false)
    expect(canOpenSubmodule(submodule('pending-clone', 'not_cloned'))).toBe(false)
    expect(canOpenSubmodule(submodule('missing', 'not_found'))).toBe(false)
    expect(canOpenSubmodule(undefined)).toBe(false)
  })

  it('identifies gitlink file modes', () => {
    expect(isGitlinkFileMode(GITLINK_FILE_MODE)).toBe(true)
    expect(isGitlinkFileMode(0o100644)).toBe(false)
    expect(isGitlinkFileMode(undefined)).toBe(false)
  })
})
