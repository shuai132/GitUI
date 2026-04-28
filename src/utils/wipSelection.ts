import type { FileEntry } from '@/types/git'

export function isSameWipFile(
  file: FileEntry,
  selectedPath: string | null,
  selectedStaged: boolean | null | undefined,
): boolean {
  if (selectedPath === null || file.path !== selectedPath) return false
  return selectedStaged == null || file.staged === selectedStaged
}

export function findSelectedWipIndex(
  files: FileEntry[],
  selectedPath: string | null,
  selectedStaged: boolean,
): number {
  if (selectedPath === null) return -1
  return files.findIndex((file) => isSameWipFile(file, selectedPath, selectedStaged))
}

export function findWipFileBySelection(
  files: FileEntry[],
  selectedPath: string | null,
  selectedStaged: boolean,
): FileEntry | undefined {
  if (selectedPath === null) return undefined
  return (
    files.find((file) => isSameWipFile(file, selectedPath, selectedStaged)) ??
    files.find((file) => file.path === selectedPath)
  )
}
