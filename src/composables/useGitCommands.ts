import { invoke } from '@tauri-apps/api/core'
import type {
  RepoMeta,
  WorkspaceStatus,
  CommitDetail,
  CommitInfo,
  LogPage,
  FileDiff,
  FileBlame,
  BlobData,
  BranchInfo,
  SubmoduleInfo,
  StashEntry,
  ReflogEntry,
  TagInfo,
  RepoState,
  MergeStrategy,
  RebaseTodoItem,
  ConflictFile,
  BuildInfo,
  RemoteInfo,
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
  async function call<T>(op: string, args?: Record<string, unknown>, opts?: { silent?: boolean }): Promise<T> {
    const dbg = debugStore.push(op, args)
    const start = performance.now()
    try {
      const result = await invoke<T>(op, args)
      debugStore.resolve(dbg.id, performance.now() - start)
      return result
    } catch (raw) {
      const rawStr = typeof raw === 'string' ? raw : raw instanceof Error ? raw.message : JSON.stringify(raw)
      debugStore.reject(dbg.id, performance.now() - start, rawStr)
      if (opts?.silent) throw raw
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

  const getRepoState = (repoId: string) =>
    call<RepoState>('get_repo_state', { repoId })

  const applyPatch = (repoId: string, patchText: string) =>
    call<void>('apply_patch', { repoId, patchText })

  // ---- Merge / Rebase / Conflict ----
  const mergeBranch = (
    repoId: string,
    sourceBranch: string,
    strategy: MergeStrategy,
    message: string | null,
  ) =>
    call<void>('merge_branch', {
      repoId,
      sourceBranch,
      strategy,
      message: message ?? null,
    })

  const mergeContinue = (repoId: string, message: string) =>
    call<void>('merge_continue', { repoId, message })

  const mergeAbort = (repoId: string) =>
    call<void>('merge_abort', { repoId })

  const rebasePlan = (repoId: string, upstream: string, onto: string | null) =>
    call<RebaseTodoItem[]>('rebase_plan', {
      repoId,
      upstream,
      onto: onto ?? null,
    })

  const rebaseStart = (
    repoId: string,
    upstream: string,
    onto: string | null,
    todo: RebaseTodoItem[] | null,
  ) =>
    call<void>('rebase_start', {
      repoId,
      upstream,
      onto: onto ?? null,
      todo: todo ?? null,
    })

  const rebaseContinue = (repoId: string, amendedMessage: string | null) =>
    call<void>('rebase_continue', {
      repoId,
      amendedMessage: amendedMessage ?? null,
    })

  const rebaseSkip = (repoId: string) =>
    call<void>('rebase_skip', { repoId })

  const rebaseAbort = (repoId: string) =>
    call<void>('rebase_abort', { repoId })

  const getConflictFile = (repoId: string, filePath: string) =>
    call<ConflictFile>('get_conflict_file', { repoId, filePath })

  const markConflictResolved = (
    repoId: string,
    filePath: string,
    content: string,
  ) => call<void>('mark_conflict_resolved', { repoId, filePath, content })

  const checkoutConflictSide = (
    repoId: string,
    filePath: string,
    side: 'ours' | 'theirs',
  ) => call<void>('checkout_conflict_side', { repoId, filePath, side })

  // ---- Commit ----
  const createCommit = (repoId: string, message: string) =>
    call<string>('create_commit', { repoId, message })

  const amendCommit = (repoId: string, message: string) =>
    call<string>('amend_commit', { repoId, message })

  const amendCommitMessage = (
    repoId: string,
    message: string,
    authorTime?: number,
    committerTime?: number,
    authorName?: string,
    authorEmail?: string,
  ) => call<string>('amend_commit_message', { repoId, message, authorTime, committerTime, authorName, authorEmail })

  const checkoutCommit = (repoId: string, oid: string) =>
    call<void>('checkout_commit', { repoId, oid })

  const cherryPickCommit = (repoId: string, oid: string) =>
    call<void>('cherry_pick_commit', { repoId, oid })

  const cherryPickContinue = (repoId: string) =>
    call<void>('cherry_pick_continue', { repoId })

  const cherryPickAbort = (repoId: string) =>
    call<void>('cherry_pick_abort', { repoId })

  const revertCommit = (repoId: string, oid: string) =>
    call<void>('revert_commit', { repoId, oid })

  const revertContinue = (repoId: string) =>
    call<void>('revert_continue', { repoId })

  const revertAbort = (repoId: string) =>
    call<void>('revert_abort', { repoId })

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

  const getCommitSummary = (repoId: string, oid: string, includeStats = true) =>
    call<CommitDetail>('get_commit_summary', { repoId, oid, includeStats })

  const getCommitDetail = (repoId: string, oid: string) =>
    call<CommitDetail>('get_commit_detail', { repoId, oid })

  const getFileLog = (repoId: string, filePath: string, offset: number, limit: number) =>
    call<CommitInfo[]>('get_file_log', { repoId, filePath, offset, limit })

  // ---- Diff ----
  const getFileDiff = (repoId: string, filePath: string, staged: boolean) =>
    call<FileDiff>('get_file_diff', { repoId, filePath, staged })

  const getBlobBytes = (repoId: string, oid: string, silent = false) =>
    call<BlobData>('get_blob_bytes', { repoId, oid }, { silent })

  const readWorktreeFile = (repoId: string, relPath: string, silent = false) =>
    call<BlobData>('read_worktree_file', { repoId, relPath }, { silent })

  const getFileDiffAtCommit = (repoId: string, filePath: string, oid: string) =>
    call<FileDiff>('get_file_diff_at_commit', { repoId, filePath, oid })

  const getFileBlame = (repoId: string, filePath: string) =>
    call<FileBlame>('get_file_blame', { repoId, filePath })

  // ---- Branch ----
  const listBranches = (repoId: string) =>
    call<BranchInfo[]>('list_branches', { repoId })

  const createBranch = (repoId: string, name: string, fromOid?: string) =>
    call<void>('create_branch', { repoId, name, fromOid })

  const switchBranch = (repoId: string, name: string, force = false) =>
    call<void>('switch_branch', { repoId, name, force })

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

  const pushBranch = (
    repoId: string,
    remoteName: string,
    branchName: string,
    mode: 'normal' | 'force' | 'force_with_lease',
  ) => call<void>('push_branch', { repoId, remoteName, branchName, mode })

  const pushTag = (repoId: string, remoteName: string, tagName: string, force = false) =>
    call<void>('push_tag', { repoId, remoteName, tagName, force })

  const pullBranch = (
    repoId: string,
    remoteName: string,
    branchName: string,
    mode: 'ff' | 'ff_only' | 'rebase',
  ) => call<void>('pull_branch', { repoId, remoteName, branchName, mode })

  const listRemotes = (repoId: string) =>
    call<RemoteInfo[]>('list_remotes', { repoId })

  const addRemote = (repoId: string, name: string, url: string) =>
    call<void>('add_remote', { repoId, name, url })

  const editRemote = (repoId: string, oldName: string, newName: string, newUrl: string) =>
    call<void>('edit_remote', { repoId, oldName, newName, newUrl })

  const removeRemote = (repoId: string, name: string) =>
    call<void>('remove_remote', { repoId, name })

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

  const addSubmodule = (repoId: string, url: string, path: string) =>
    call<void>('add_submodule', { repoId, url, path })

  // ---- Stash ----
  const stashPush = (repoId: string, message?: string) =>
    call<void>('stash_push', { repoId, message: message ?? null })

  const stashPop = (repoId: string, index = 0) =>
    call<void>('stash_pop', { repoId, index })

  const stashApply = (repoId: string, index: number) =>
    call<void>('stash_apply', { repoId, index })

  const stashDrop = (repoId: string, index: number) =>
    call<void>('stash_drop', { repoId, index })

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

  const dropUnreachableCommit = (repoId: string, oid: string) =>
    call<number>('drop_unreachable_commit', { repoId, oid })

  const previewDropUnreachableCommit = (repoId: string, oid: string) =>
    call<number>('preview_drop_unreachable_commit', { repoId, oid })

  const revealFile = (path: string) =>
    call<void>('reveal_file', { path })

  const openFileInEditor = (path: string) =>
    call<void>('open_file_in_editor', { path })

  const openTerminalHere = (dirPath: string, terminalApp?: string | null) =>
    call<void>('open_terminal_here', { dirPath, terminalApp: terminalApp ?? null })

  const addToGitignore = (repoId: string, filePath: string) =>
    call<void>('add_to_gitignore', { repoId, filePath })

  const checkoutFileAtCommit = (repoId: string, sha: string, filePath: string) =>
    call<void>('checkout_file_at_commit', { repoId, sha, filePath })

  const getBuildInfo = () =>
    call<BuildInfo>('get_build_info')

  const listSystemFonts = () =>
    call<string[]>('list_system_fonts')

  const setAutoFetchInterval = (secs: number) =>
    call<void>('set_auto_fetch_interval', { secs })

  const setActiveRepoForFetch = (repoId: string | null) =>
    call<void>('set_active_repo_for_fetch', { repoId })

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
    getRepoState,
    applyPatch,
    mergeBranch,
    mergeContinue,
    mergeAbort,
    rebasePlan,
    rebaseStart,
    rebaseContinue,
    rebaseSkip,
    rebaseAbort,
    getConflictFile,
    markConflictResolved,
    checkoutConflictSide,
    createCommit,
    amendCommit,
    amendCommitMessage,
    checkoutCommit,
    cherryPickCommit,
    cherryPickContinue,
    cherryPickAbort,
    revertCommit,
    revertContinue,
    revertAbort,
    resetToCommit,
    createTag,
    getLog,
    getCommitSummary,
    getCommitDetail,
    getFileLog,
    getFileDiff,
    getBlobBytes,
    readWorktreeFile,
    getFileDiffAtCommit,
    getFileBlame,
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
    addRemote,
    editRemote,
    removeRemote,
    listSubmodules,
    initSubmodule,
    updateSubmodule,
    setSubmoduleUrl,
    submoduleWorkdir,
    deinitSubmodule,
    addSubmodule,
    stashPush,
    stashPop,
    stashApply,
    stashDrop,
    stashList,
    openTerminal,
    openInNewWindow,
    revealInFileManager,
    consumeStartupRepo,
    discardAllChanges,
    discardFile,
    getReflog,
    runGc,
    dropUnreachableCommit,
    previewDropUnreachableCommit,
    revealFile,
    openFileInEditor,
    openTerminalHere,
    addToGitignore,
    checkoutFileAtCommit,
    getBuildInfo,
    listSystemFonts,
    setAutoFetchInterval,
    setActiveRepoForFetch,
    terminalSpawn,
    terminalWrite,
    terminalResize,
    terminalClose,
  }
}
