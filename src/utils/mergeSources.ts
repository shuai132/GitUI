import type { BranchInfo } from '@/types/git'

export type DragActionDisabledReason =
  | 'ongoing'
  | 'detached'
  | 'no_source_branch'
  | 'no_target_commit'
  | 'source_is_current_branch'
  | 'target_is_head'

export interface DragActionState {
  currentBranchName: string | null
  sourceBranchNames: string[]
  targetBranchNames: string[]
  mergeSourceNames: string[]
  canMerge: boolean
  canRebase: boolean
  mergeDisabledReason: DragActionDisabledReason | null
  rebaseDisabledReason: DragActionDisabledReason | null
}

export function mergeSourceNames(
  branches: BranchInfo[],
  preferredNames: string[] = [],
): string[] {
  const names = new Set<string>()

  for (const name of preferredNames) {
    if (name) names.add(name)
  }

  for (const branch of branches) {
    if (branch.is_head) continue
    names.add(branch.name)
  }

  return Array.from(names)
}

export function mergeSourceNamesAtCommit(
  branches: BranchInfo[],
  commitOid: string,
): string[] {
  return branches
    .filter((branch) => branch.commit_oid === commitOid && !branch.is_head)
    .map((branch) => branch.name)
}

export function resolveReferenceOid(branches: BranchInfo[], spec: string): string | null {
  const branchOid = branches.find((branch) => branch.name === spec)?.commit_oid
  if (branchOid) return branchOid
  return /^[0-9a-f]{40}$/i.test(spec) ? spec : null
}

export function branchNamesAtCommit(
  branches: BranchInfo[],
  commitOid: string | null,
): string[] {
  if (!commitOid) return []
  return branches
    .filter((branch) => branch.commit_oid === commitOid)
    .map((branch) => branch.name)
}

export function buildDragActionState(
  branches: BranchInfo[],
  sourceOid: string | null,
  targetOid: string | null,
  headOid: string | null,
  isOngoing: boolean,
): DragActionState {
  const currentBranch = branches.find((branch) => branch.is_head && !branch.is_remote) ?? null
  const sourceBranchNames = branchNamesAtCommit(branches, sourceOid)
  const targetBranchNames = branchNamesAtCommit(branches, targetOid)
  const mergeCandidates = sourceOid ? mergeSourceNamesAtCommit(branches, sourceOid) : []
  const sourceIsCurrentBranch =
    sourceOid !== null &&
    currentBranch?.commit_oid === sourceOid

  let mergeDisabledReason: DragActionDisabledReason | null = null
  if (isOngoing) {
    mergeDisabledReason = 'ongoing'
  } else if (!currentBranch) {
    mergeDisabledReason = 'detached'
  } else if (sourceIsCurrentBranch) {
    mergeDisabledReason = 'source_is_current_branch'
  } else if (mergeCandidates.length === 0) {
    mergeDisabledReason = 'no_source_branch'
  }

  let rebaseDisabledReason: DragActionDisabledReason | null = null
  if (isOngoing) {
    rebaseDisabledReason = 'ongoing'
  } else if (!currentBranch) {
    rebaseDisabledReason = 'detached'
  } else if (!targetOid) {
    rebaseDisabledReason = 'no_target_commit'
  } else if (targetOid !== null && headOid === targetOid) {
    rebaseDisabledReason = 'target_is_head'
  }

  return {
    currentBranchName: currentBranch?.name ?? null,
    sourceBranchNames,
    targetBranchNames,
    mergeSourceNames: mergeCandidates,
    canMerge: mergeDisabledReason === null,
    canRebase: rebaseDisabledReason === null,
    mergeDisabledReason,
    rebaseDisabledReason,
  }
}
