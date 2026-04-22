export interface RepoMeta {
  id: string
  path: string
  name: string
}

export type FileStatusKind = 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked' | 'conflicted'

export interface RemoteInfo {
  name: string
  url: string | null
}

export interface FileEntry {
  path: string
  old_path?: string
  status: FileStatusKind
  staged: boolean
  additions: number
  deletions: number
}

export interface WorkspaceStatus {
  staged: FileEntry[]
  unstaged: FileEntry[]
  untracked: FileEntry[]
  head_branch?: string
  head_commit?: string
  head_commit_message?: string
  is_detached: boolean
  repo_state: RepoState
}

export type RepoStateKind =
  | 'clean'
  | 'merge'
  | 'rebase'
  | 'rebase_interactive'
  | 'rebase_merge'
  | 'cherry_pick'
  | 'revert'
  | 'bisect'
  | 'apply_mailbox'

export interface RepoState {
  kind: RepoStateKind
  head_oid?: string
  merge_msg?: string
  merge_head?: string
  rebase_onto?: string
  rebase_orig_head?: string
  rebase_head_name?: string
  rebase_step?: number
  rebase_total?: number
  rebase_current_oid?: string
}

export type MergeStrategy = 'auto' | 'fast_forward' | 'no_fast_forward' | 'squash'

export type RebaseActionKind = 'pick' | 'reword' | 'squash' | 'fixup' | 'drop'

export interface RebaseTodoItem {
  oid: string
  short_oid: string
  action: RebaseActionKind
  subject: string
  new_message?: string
  /** reword 时可选覆盖 author date（Unix 秒）；缺省 = 保留原值 */
  new_author_time?: number
  /** reword 时可选覆盖 committer date（Unix 秒）；缺省 = 当前时间 */
  new_committer_time?: number
  /** reword 时可选覆盖 author name；缺省 = 保留原值 */
  new_author_name?: string
  /** reword 时可选覆盖 author email；缺省 = 保留原值 */
  new_author_email?: string
}

export interface ConflictFile {
  path: string
  base?: string
  ours?: string
  theirs?: string
  merged_preview: string
  is_binary: boolean
}

export interface CommitInfo {
  oid: string
  short_oid: string
  message: string
  summary: string
  author_name: string
  author_email: string
  /** author date（Unix 秒），`git log` 默认展示此时间 */
  author_time: number
  /** committer date（Unix 秒），rebase/amend 后会更新 */
  time: number
  parent_oids: string[]
  /** 该提交不在任何 ref 的可达集合中（仅 reflog 可达） */
  is_unreachable: boolean
  /** 该提交是某条 stash 的根提交 */
  is_stash: boolean
  /** 该提交是 HEAD reflog 闭包的 tip（oid 在 reflog 且不是其他 reflog oid 的严格祖先）。
   *  仅 tip 能通过右键菜单直接从 reflog 中移除。 */
  is_reflog_tip: boolean
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

export interface TagInfo {
  name: string
  commit_oid: string
  is_annotated: boolean
  message?: string
  tagger_name?: string
  time?: number
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
  /** 旧侧 blob oid；新增/未跟踪场景为空 */
  old_blob_oid?: string
  /** 新侧 blob oid；删除或 WIP 未暂存修改侧为空 */
  new_blob_oid?: string
  /** 检测到的文件编码名，如 "UTF-8" / "GBK" / "Shift_JIS" */
  encoding: string
}

/** 二进制 blob 的字节数据（base64 编码），用于图片预览等 */
export interface BlobData {
  bytes_base64: string
  size: number
  truncated: boolean
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

export interface ReflogEntry {
  oid: string
  short_oid: string
  message: string
  committer_name: string
  time: number
}

export interface BlameHunk {
  /** 起始行号（1-based） */
  start_line: number
  num_lines: number
  commit_oid: string
  short_oid: string
  author_name: string
  author_email: string
  time: number
  summary: string
}

export interface FileBlame {
  /** 文件内容按行（不含换行符） */
  lines: string[]
  hunks: BlameHunk[]
}

/** 构建信息：版本号 + 编译时注入的短 commit hash（缺失时为 null） */
export interface BuildInfo {
  version: string
  git_hash: string | null
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
