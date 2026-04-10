import { invoke } from '@tauri-apps/api/core'
import type {
  RepoMeta,
  WorkspaceStatus,
  CommitInfo,
  CommitDetail,
  LogPage,
  FileDiff,
  BranchInfo,
} from '@/types/git'

export function useGitCommands() {
  // ---- Repo ----
  const openRepo = (path: string) =>
    invoke<RepoMeta>('open_repo', { path })

  const closeRepo = (repoId: string) =>
    invoke<void>('close_repo', { repoId })

  const listRepos = () =>
    invoke<RepoMeta[]>('list_repos')

  const validateRepoPath = (path: string) =>
    invoke<boolean>('validate_repo_path', { path })

  // ---- Status ----
  const getStatus = (repoId: string) =>
    invoke<WorkspaceStatus>('get_status', { repoId })

  const stageFile = (repoId: string, filePath: string) =>
    invoke<void>('stage_file', { repoId, filePath })

  const unstageFile = (repoId: string, filePath: string) =>
    invoke<void>('unstage_file', { repoId, filePath })

  const stageAll = (repoId: string) =>
    invoke<void>('stage_all', { repoId })

  const unstageAll = (repoId: string) =>
    invoke<void>('unstage_all', { repoId })

  // ---- Commit ----
  const createCommit = (repoId: string, message: string) =>
    invoke<string>('create_commit', { repoId, message })

  // ---- Log ----
  const getLog = (repoId: string, offset: number, limit: number) =>
    invoke<LogPage>('get_log', { repoId, offset, limit })

  const getCommitDetail = (repoId: string, oid: string) =>
    invoke<CommitDetail>('get_commit_detail', { repoId, oid })

  // ---- Diff ----
  const getFileDiff = (repoId: string, filePath: string, staged: boolean) =>
    invoke<FileDiff>('get_file_diff', { repoId, filePath, staged })

  // ---- Branch ----
  const listBranches = (repoId: string) =>
    invoke<BranchInfo[]>('list_branches', { repoId })

  const createBranch = (repoId: string, name: string, fromOid?: string) =>
    invoke<void>('create_branch', { repoId, name, fromOid })

  const switchBranch = (repoId: string, name: string) =>
    invoke<void>('switch_branch', { repoId, name })

  const deleteBranch = (repoId: string, name: string) =>
    invoke<void>('delete_branch', { repoId, name })

  // ---- Remote ----
  const fetchRemote = (repoId: string, remoteName: string) =>
    invoke<void>('fetch_remote', { repoId, remoteName })

  const pushBranch = (repoId: string, remoteName: string, branchName: string) =>
    invoke<void>('push_branch', { repoId, remoteName, branchName })

  const pullBranch = (repoId: string, remoteName: string, branchName: string) =>
    invoke<void>('pull_branch', { repoId, remoteName, branchName })

  const listRemotes = (repoId: string) =>
    invoke<string[]>('list_remotes', { repoId })

  return {
    openRepo,
    closeRepo,
    listRepos,
    validateRepoPath,
    getStatus,
    stageFile,
    unstageFile,
    stageAll,
    unstageAll,
    createCommit,
    getLog,
    getCommitDetail,
    getFileDiff,
    listBranches,
    createBranch,
    switchBranch,
    deleteBranch,
    fetchRemote,
    pushBranch,
    pullBranch,
    listRemotes,
  }
}
