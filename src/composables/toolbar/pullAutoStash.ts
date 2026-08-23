import type { RepoStateKind } from '@/types/git'
import { runWithAutoStash, type AutoStashRestore } from '@/utils/autoStash'

export type PullAutoStashRestore = AutoStashRestore

export interface PullAutoStashResult {
  pullSucceeded: boolean
  pullError: unknown | null
  restore: PullAutoStashRestore
}

interface PullAutoStashOptions {
  stash: () => Promise<string>
  pull: () => Promise<void>
  getRepoState: () => Promise<{ kind: RepoStateKind }>
  restore: (stashOid: string) => Promise<void>
}

/**
 * 执行 Pull 的自动 stash 生命周期。只有仓库确认回到 clean 状态才恢复，
 * 避免把原始改动叠加到 Pull 留下的 merge / rebase 中间态上。
 */
export async function runPullWithAutoStash(
  options: PullAutoStashOptions,
): Promise<PullAutoStashResult> {
  const result = await runWithAutoStash({
    stash: options.stash,
    operation: options.pull,
    getRepoState: options.getRepoState,
    restore: options.restore,
  })
  return {
    pullSucceeded: result.operationSucceeded,
    pullError: result.operationError,
    restore: result.restore,
  }
}
