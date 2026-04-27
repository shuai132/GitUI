import { computed, ref, watch, type Ref } from 'vue'
import type { FileDiff, FileStatusKind } from '@/types/git'
import { buildFileTree, flattenTree } from '@/utils/fileTree'

const HISTORY_VIEW_MODE_KEY = 'history-view-mode'

export type CommitFileViewMode = 'list' | 'tree'

export type CommitFileDisplayItem =
  | { type: 'file'; path: string; file: FileDiff; depth: number; index: number }
  | { type: 'dir'; path: string; name: string; depth: number; expanded: boolean }

function readInitialViewMode(): CommitFileViewMode {
  const mode = localStorage.getItem(HISTORY_VIEW_MODE_KEY)
  return mode === 'tree' ? 'tree' : 'list'
}

function diffPath(diff: FileDiff): string {
  return diff.new_path ?? diff.old_path ?? ''
}

export function commitFileStatus(diff: FileDiff): FileStatusKind {
  if (!diff.old_blob_oid) return 'added'
  if (!diff.new_blob_oid) return 'deleted'
  if (diff.old_path !== diff.new_path) return 'renamed'
  return 'modified'
}

export function useCommitFileItems(
  diffs: Ref<FileDiff[]>,
  commitOid: Ref<string | undefined>,
) {
  const viewMode = ref<CommitFileViewMode>(readInitialViewMode())
  const isAllExpanded = ref(false)
  const expandedDirs = ref(new Set<string>())

  function buildTree() {
    return buildFileTree(diffs.value, diffPath)
  }

  function expandTopLevelDirs() {
    expandedDirs.value.clear()
    for (const node of buildTree()) {
      if (node.isDir) expandedDirs.value.add(node.path)
    }
  }

  function toggleViewMode() {
    viewMode.value = viewMode.value === 'list' ? 'tree' : 'list'
    localStorage.setItem(HISTORY_VIEW_MODE_KEY, viewMode.value)
  }

  function toggleExpandCollapseAll() {
    isAllExpanded.value = !isAllExpanded.value
    if (!isAllExpanded.value) {
      expandedDirs.value.clear()
      return
    }

    const stack = [...buildTree()]
    while (stack.length > 0) {
      const node = stack.pop()!
      if (node.isDir) {
        expandedDirs.value.add(node.path)
        stack.push(...node.children)
      }
    }
  }

  function toggleDir(path: string) {
    if (expandedDirs.value.has(path)) {
      expandedDirs.value.delete(path)
    } else {
      expandedDirs.value.add(path)
    }
  }

  const displayItems = computed<CommitFileDisplayItem[]>(() => {
    if (viewMode.value !== 'tree') {
      return diffs.value.map((diff, index) => ({
        type: 'file',
        path: diffPath(diff),
        file: diff,
        depth: 0,
        index,
      }))
    }

    const pathToIndex = new Map(diffs.value.map((diff, index) => [diffPath(diff), index]))
    const flat = flattenTree(buildTree(), expandedDirs.value)
    return flat.map((node) => {
      if (node.isDir) {
        return {
          type: 'dir',
          path: node.path,
          name: node.name,
          depth: node.depth,
          expanded: expandedDirs.value.has(node.path),
        }
      }

      const index = pathToIndex.get(node.path) ?? -1
      return {
        type: 'file',
        path: node.path,
        file: node.file!,
        depth: node.depth,
        index,
      }
    })
  })

  watch(viewMode, (mode) => {
    if (mode === 'tree' && expandedDirs.value.size === 0) {
      expandTopLevelDirs()
    }
  })

  watch(commitOid, () => {
    if (viewMode.value !== 'tree') return
    expandTopLevelDirs()
    isAllExpanded.value = false
  })

  return {
    viewMode,
    isAllExpanded,
    expandedDirs,
    displayItems,
    toggleViewMode,
    toggleExpandCollapseAll,
    toggleDir,
  }
}
