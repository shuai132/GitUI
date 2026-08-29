import type { FileDiff } from '@/types/git'

type DiffPaths = Pick<FileDiff, 'old_path' | 'new_path'>

export function isRenamedDiff(diff: DiffPaths): boolean {
  return Boolean(diff.old_path && diff.new_path && diff.old_path !== diff.new_path)
}

export function displayDiffPath(diff: DiffPaths): string {
  if (isRenamedDiff(diff)) {
    return `${diff.old_path} → ${diff.new_path}`
  }
  return diff.new_path ?? diff.old_path ?? ''
}
