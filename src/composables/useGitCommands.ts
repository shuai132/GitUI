import { invoke } from '@tauri-apps/api/core'
import type {
  RepoMeta,
  WorkspaceStatus,
  CommitDetail,
  LogPage,
  FileDiff,
  BlobData,
  BranchInfo,
  SubmoduleInfo,
  StashEntry,
  ReflogEntry,
  TagInfo,
} from '@/types/git'
import { useErrorsStore } from '@/stores/errors'
import { useDebugStore } from '@/stores/debug'

export function useGitCommands() {
  const errorsStore = useErrorsStore()
  const debugStore = useDebugStore()

  /**
   * 统一包装所有 IPC 调用：
   * 1. 成功 → 返回原值
   * 2. 失败 → push 到 errorsStore，rethrow 一个 Error(friendlyMessage)
   *
   * 每次调用同时记录到 debugStore（命令名、参数、耗时、结果）。
   */
  async function call<T>(op: string, args?: Record<string, unknown>): Promise<T> {
    const dbg = debugStore.push(op, args)
    const start = performance.now()
    try {
      const result = await invoke<T>(op, args)
      debugStore.resolve(dbg.id, performance.now() - start)
      return result
    } catch (raw) {
      const rawStr = typeof raw === 'string' ? raw : raw instanceof Error ? raw.message : JSON.stringify(raw)
      debugStore.reject(dbg.id, performance.now() - start, rawStr)
      const entry = errorsStore.push(op, raw)
      throw new Error(entry.friendly)
    }
  }

  // ---- Repo ----
  const openRepo = (path: string) =>
    call<RepoMeta>('open_repo', { path })

  const closeRepo = (repoId: string) =>
    call<void>('close_repo', { repoId })

  const listRepos = () =>
    call<RepoMeta[]>('list_repos')

  const validateRepoPath = (path: string) =>
    call<boolean>('validate_repo_path', { path })

  const cloneRepo = (opts: {
    url: string
    parentDir: string
    name?: string
    depth?: number
    recurseSubmodules: boolean
  }) => call<string>('clone_repo', { opts })

  const initRepo = (path: string) =>
    call<string>('init_repo', { path })

  // ---- Status ----
  const getStatus = (repoId: string) =>
    call<WorkspaceStatus>('get_status', { repoId })

  const stageFile = (repoId: string, filePath: string) =>
    call<void>('stage_file', { repoId, filePath })

  const unstageFile = (repoId: string, filePath: string) =>
    call<void>('unstage_file', { repoId, filePath })

  const stageAll = (repoId: string) =>
    call<void>('stage_all', { repoId })

  const unstageAll = (repoId: string) =>
    call<void>('unstage_all', { repoId })

  // ---- Commit ----
  const createCommit = (repoId: string, message: string) =>
    call<string>('create_commit', { repoId, message })

  const amendCommit = (repoId: string, message: string) =>
    call<string>('amend_commit', { repoId, message })

  const checkoutCommit = (repoId: string, oid: string) =>
    call<void>('checkout_commit', { repoId, oid })

  const cherryPickCommit = (repoId: string, oid: string) =>
    call<void>('cherry_pick_commit', { repoId, oid })

  const revertCommit = (repoId: string, oid: string) =>
    call<void>('revert_commit', { repoId, oid })

  const resetToCommit = (
    repoId: string,
    oid: string,
    mode: 'soft' | 'mixed' | 'hard',
  ) => call<void>('reset_to_commit', { repoId, oid, mode })

  const createTag = (
    repoId: string,
    name: string,
    oid: string,
    message: string | null,
  ) => call<void>('create_tag', { repoId, name, oid, message })

  // ---- Log ----
  const getLog = (
    repoId: string,
    offset: number,
    limit: number,
    includeUnreachable: boolean,
    includeStashes: boolean,
  ) =>
    call<LogPage>('get_log', {
      repoId,
      offset,
      limit,
      includeUnreachable,
      includeStashes,
    })

  const getCommitDetail = (repoId: string, oid: string) =>
    call<CommitDetail>('get_commit_detail', { repoId, oid })

  // ---- Diff ----
  const getFileDiff = (repoId: string, filePath: string, staged: boolean) =>
    call<FileDiff>('get_file_diff', { repoId, filePath, staged })

  const getBlobBytes = (repoId: string, oid: string) =>
    call<BlobData>('get_blob_bytes', { repoId, oid })

  const readWorktreeFile = (repoId: string, relPath: string) =>
    call<BlobData>('read_worktree_file', { repoId, relPath })

  // ---- Branch ----
  const listBranches = (repoId: string) =>
    call<BranchInfo[]>('list_branches', { repoId })

  const createBranch = (repoId: string, name: string, fromOid?: string) =>
    call<void>('create_branch', { repoId, name, fromOid })

  const switchBranch = (repoId: string, name: string) =>
    call<void>('switch_branch', { repoId, name })

  const deleteBranch = (repoId: string, name: string) =>
    call<void>('delete_branch', { repoId, name })

  const checkoutRemoteBranch = (
    repoId: string,
    remoteBranch: string,
    localName: string,
    track: boolean,
  ) =>
    call<void>('checkout_remote_branch', {
      repoId,
      remoteBranch,
      localName,
      track,
    })

  // ---- Tag ----
  const listTags = (repoId: string) =>
    call<TagInfo[]>('list_tags', { repoId })

  const deleteTag = (repoId: string, name: string) =>
    call<void>('delete_tag', { repoId, name })

  const listRemoteTags = (repoId: string, remoteName: string) =>
    call<string[]>('list_remote_tags', { repoId, remoteName })

  // ---- Remote ----
  const fetchRemote = (repoId: string, remoteName: string) =>
    call<void>('fetch_remote', { repoId, remoteName })

  const pushBranch = (repoId: string, remoteName: string, branchName: string) =>
    call<void>('push_branch', { repoId, remoteName, branchName })

  const pushTag = (repoId: string, remoteName: string, tagName: string) =>
    call<void>('push_tag', { repoId, remoteName, tagName })

  const pullBranch = (
    repoId: string,
    remoteName: string,
    branchName: string,
    mode: 'ff' | 'ff_only' | 'rebase',
  ) => call<void>('pull_branch', { repoId, remoteName, branchName, mode })

  const listRemotes = (repoId: string) =>
    call<string[]>('list_remotes', { repoId })

  // ---- Submodule ----
  const listSubmodules = (repoId: string) =>
    call<SubmoduleInfo[]>('list_submodules', { repoId })

  const initSubmodule = (repoId: string, name: string) =>
    call<void>('init_submodule', { repoId, name })

  const updateSubmodule = (repoId: string, name: string) =>
    call<void>('update_submodule', { repoId, name })

  const setSubmoduleUrl = (repoId: string, name: string, url: string) =>
    call<void>('set_submodule_url', { repoId, name, url })

  const submoduleWorkdir = (repoId: string, name: string) =>
    call<string>('submodule_workdir', { repoId, name })

  const deinitSubmodule = (repoId: string, name: string) =>
    call<void>('deinit_submodule', { repoId, name })

  // ---- Stash ----
  const stashPush = (repoId: string, message?: string) =>
    call<void>('stash_push', { repoId, message: message ?? null })

  const stashPop = (repoId: string) =>
    call<void>('stash_pop', { repoId })

  const stashList = (repoId: string) =>
    call<StashEntry[]>('stash_list', { repoId })

  // ---- System ----
  /**
   * 打开外部终端。`terminalApp` 仅在 macOS 下生效（作为 `open -a` 的 app 名），
   * 其它平台后端会忽略该参数，走自动探测逻辑。
   */
  const openTerminal = (repoId: string, terminalApp?: string | null) =>
    call<void>('open_terminal', { repoId, terminalApp: terminalApp ?? null })

  const openInNewWindow = (repoId: string) =>
    call<void>('open_in_new_window', { repoId })

  const revealInFileManager = (repoId: string) =>
    call<void>('reveal_in_file_manager', { repoId })

  const consumeStartupRepo = () =>
    call<string | null>('consume_startup_repo')

  const discardAllChanges = (repoId: string) =>
    call<void>('discard_all_changes', { repoId })

  const discardFile = (repoId: string, filePath: string) =>
    call<void>('discard_file', { repoId, filePath })

  const getReflog = (repoId: string) =>
    call<ReflogEntry[]>('get_reflog', { repoId })

  const runGc = (repoId: string) =>
    call<string>('run_gc', { repoId })

  // ---- Terminal (in-app PTY) ----
  const terminalSpawn = (repoId: string, cols: number, rows: number) =>
    call<string>('terminal_spawn', { repoId, cols, rows })

  const terminalWrite = (sessionId: string, data: string) =>
    call<void>('terminal_write', { sessionId, data })

  const terminalResize = (sessionId: string, cols: number, rows: number) =>
    call<void>('terminal_resize', { sessionId, cols, rows })

  const terminalClose = (sessionId: string) =>
    call<void>('terminal_close', { sessionId })

  return {
    openRepo,
    closeRepo,
    listRepos,
    validateRepoPath,
    cloneRepo,
    initRepo,
    getStatus,
    stageFile,
    unstageFile,
    stageAll,
    unstageAll,
    createCommit,
    amendCommit,
    checkoutCommit,
    cherryPickCommit,
    revertCommit,
    resetToCommit,
    createTag,
    getLog,
    getCommitDetail,
    getFileDiff,
    getBlobBytes,
    readWorktreeFile,
    listBranches,
    createBranch,
    switchBranch,
    deleteBranch,
    checkoutRemoteBranch,
    listTags,
    deleteTag,
    listRemoteTags,
    fetchRemote,
    pushBranch,
    pushTag,
    pullBranch,
    listRemotes,
    listSubmodules,
    initSubmodule,
    updateSubmodule,
    setSubmoduleUrl,
    submoduleWorkdir,
    deinitSubmodule,
    stashPush,
    stashPop,
    stashList,
    openTerminal,
    openInNewWindow,
    revealInFileManager,
    consumeStartupRepo,
    discardAllChanges,
    discardFile,
    getReflog,
    runGc,
    terminalSpawn,
    terminalWrite,
    terminalResize,
    terminalClose,
  }
}
