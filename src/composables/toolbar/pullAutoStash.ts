import type { RepoStateKind } from '@/types/git'

export type PullAutoStashRestore =
  | { kind: 'restored' }
  | { kind: 'deferred'; repoState: RepoStateKind | 'unknown'; cause?: unknown }
  | { kind: 'failed'; cause: unknown }

export interface PullAutoStashResult {
  pullSucceeded: boolean
  pullError: unknown | null
  restore: PullAutoStashRestore
}

interface PullAutoStashOptions {
  stash: () => Promise<void>
  pull: () => Promise<void>
  getRepoState: () => Promise<{ kind: RepoStateKind }>
  restore: () => Promise<void>
}

/**
 * 执行 Pull 的自动 stash 生命周期。只有仓库确认回到 clean 状态才恢复，
 * 避免把原始改动叠加到 Pull 留下的 merge / rebase 中间态上。
 */
export async function runPullWithAutoStash(
  options: PullAutoStashOptions,
): Promise<PullAutoStashResult> {
  await options.stash()

  let pullSucceeded = false
  let pullError: unknown | null = null
  try {
    await options.pull()
    pullSucceeded = true
  } catch (cause: unknown) {
    pullError = cause
  }

  let repoState: RepoStateKind | 'unknown'
  try {
    repoState = (await options.getRepoState()).kind
  } catch (cause: unknown) {
    return {
      pullSucceeded,
      pullError,
      restore: { kind: 'deferred', repoState: 'unknown', cause },
    }
  }

  if (repoState !== 'clean') {
    return {
      pullSucceeded,
      pullError,
      restore: { kind: 'deferred', repoState },
    }
  }

  try {
    await options.restore()
    return { pullSucceeded, pullError, restore: { kind: 'restored' } }
  } catch (cause: unknown) {
    return {
      pullSucceeded,
      pullError,
      restore: { kind: 'failed', cause },
    }
  }
}
