import type { FileDiff, SubmoduleInfo } from '@/types/git'

export const GITLINK_FILE_MODE = 0o160000
export type SubmoduleSetupAction = 'init-submodule' | 'update-submodule'

export function buildSubmodulePathSet(paths: readonly string[] | undefined): Set<string> {
  return new Set(paths ?? [])
}

export function isSubmodulePath(pathSet: ReadonlySet<string>, path: string | null | undefined): boolean {
  return !!path && pathSet.has(path)
}

export function findSubmoduleByPath(
  submodules: readonly SubmoduleInfo[],
  path: string | null | undefined,
): SubmoduleInfo | undefined {
  if (!path) return undefined
  return submodules.find((submodule) => submodule.path === path)
}

export function findSubmoduleForDiff(
  submodules: readonly SubmoduleInfo[],
  diff: Pick<FileDiff, 'old_path' | 'new_path'>,
): SubmoduleInfo | undefined {
  return findSubmoduleByPath(submodules, diff.new_path) ??
    findSubmoduleByPath(submodules, diff.old_path)
}

export function canOpenSubmodule(submodule: SubmoduleInfo | undefined): submodule is SubmoduleInfo {
  return !!submodule &&
    submodule.state !== 'uninitialized' &&
    submodule.state !== 'not_cloned' &&
    submodule.state !== 'not_found'
}

export function submoduleSetupAction(
  submodule: SubmoduleInfo | undefined,
): SubmoduleSetupAction | null {
  if (!submodule) return null
  if (submodule.state === 'uninitialized') return 'init-submodule'
  if (submodule.state === 'not_cloned' || submodule.state === 'not_found') {
    return 'update-submodule'
  }
  return null
}

export function isGitlinkFileMode(mode: number | null | undefined): boolean {
  return mode === GITLINK_FILE_MODE
}
