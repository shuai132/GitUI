export interface RepoMeta {
  id: string
  path: string
  name: string
}

export type FileStatusKind = 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked' | 'conflicted'

export interface FileEntry {
  path: string
  old_path?: string
  status: FileStatusKind
  staged: boolean
}

export interface WorkspaceStatus {
  staged: FileEntry[]
  unstaged: FileEntry[]
  untracked: FileEntry[]
  head_branch?: string
  head_commit?: string
  is_detached: boolean
}

export interface CommitInfo {
  oid: string
  short_oid: string
  message: string
  summary: string
  author_name: string
  author_email: string
  time: number
  parent_oids: string[]
}

export interface BranchInfo {
  name: string
  is_remote: boolean
  is_head: boolean
  upstream?: string
  commit_oid?: string
  ahead?: number
  behind?: number
}

export interface DiffLine {
  origin: string
  content: string
  old_lineno?: number
  new_lineno?: number
}

export interface DiffHunk {
  old_start: number
  old_lines: number
  new_start: number
  new_lines: number
  header: string
  lines: DiffLine[]
}

export interface FileDiff {
  old_path?: string
  new_path?: string
  is_binary: boolean
  hunks: DiffHunk[]
  additions: number
  deletions: number
}

export interface CommitDetail {
  info: CommitInfo
  diffs: FileDiff[]
}

export interface LogPage {
  commits: CommitInfo[]
  has_more: boolean
  total_loaded: number
}

export interface StashEntry {
  index: number
  message: string
  commit_oid: string
}

export type SubmoduleState =
  | 'uninitialized'
  | 'not_cloned'
  | 'up_to_date'
  | 'modified'
  | 'not_found'

export interface SubmoduleInfo {
  name: string
  path: string
  url?: string
  head_oid?: string
  workdir_oid?: string
  state: SubmoduleState
  has_workdir_modifications: boolean
}

// Graph node for DAG visualization
export interface GraphNode {
  oid: string
  column: number
  color: string
  parent_columns: Array<{
    from_col: number
    to_col: number
    color: string
    merge_commit: boolean
  }>
}
