import type { RepoStateKind } from '@/types/git'

export type AutoStashRestore =
  | { kind: 'restored' }
  | { kind: 'deferred'; repoState: RepoStateKind | 'unknown'; cause?: unknown }
  | { kind: 'failed'; cause: unknown }

export interface AutoStashResult {
  operationSucceeded: boolean
  operationError: unknown | null
  restore: AutoStashRestore
}

interface AutoStashOptions {
  stash: () => Promise<string>
  operation: () => Promise<void>
  getRepoState: () => Promise<{ kind: RepoStateKind }>
  restore: (stashOid: string) => Promise<void>
}

/**
 * Runs a Git operation with a temporary stash. Original changes are restored only
 * after the repository is confirmed clean, so they cannot be overlaid onto an
 * unfinished merge, rebase, cherry-pick, or revert.
 */
export async function runWithAutoStash(
  options: AutoStashOptions,
): Promise<AutoStashResult> {
  const stashTarget = await options.stash()

  let operationSucceeded = false
  let operationError: unknown | null = null
  try {
    await options.operation()
    operationSucceeded = true
  } catch (cause: unknown) {
    operationError = cause
  }

  let repoState: RepoStateKind | 'unknown'
  try {
    repoState = (await options.getRepoState()).kind
  } catch (cause: unknown) {
    return {
      operationSucceeded,
      operationError,
      restore: { kind: 'deferred', repoState: 'unknown', cause },
    }
  }

  if (repoState !== 'clean') {
    return {
      operationSucceeded,
      operationError,
      restore: { kind: 'deferred', repoState },
    }
  }

  try {
    await options.restore(stashTarget)
    return { operationSucceeded, operationError, restore: { kind: 'restored' } }
  } catch (cause: unknown) {
    return {
      operationSucceeded,
      operationError,
      restore: { kind: 'failed', cause },
    }
  }
}
