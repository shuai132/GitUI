use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoMeta {
    pub id: String,
    pub path: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum FileStatusKind {
    Added,
    Modified,
    Deleted,
    Renamed,
    Untracked,
    Conflicted,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEntry {
    pub path: String,
    pub old_path: Option<String>,
    pub status: FileStatusKind,
    pub staged: bool,
    #[serde(default)]
    pub additions: usize,
    #[serde(default)]
    pub deletions: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceStatus {
    pub staged: Vec<FileEntry>,
    pub unstaged: Vec<FileEntry>,
    pub untracked: Vec<FileEntry>,
    pub head_branch: Option<String>,
    pub head_commit: Option<String>,
    pub head_commit_message: Option<String>,
    pub is_detached: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommitInfo {
    pub oid: String,
    pub short_oid: String,
    pub message: String,
    pub summary: String,
    pub author_name: String,
    pub author_email: String,
    pub time: i64,
    pub parent_oids: Vec<String>,
    /// 该提交在所有 ref 之外，仅通过 reflog 才能找到（"丢失引用"）
    #[serde(default)]
    pub is_unreachable: bool,
    /// 该提交是一条 stash 的根提交
    #[serde(default)]
    pub is_stash: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BranchInfo {
    pub name: String,
    pub is_remote: bool,
    pub is_head: bool,
    pub upstream: Option<String>,
    pub commit_oid: Option<String>,
    /// 本地分支相对上游的领先提交数（无上游时为 None）
    pub ahead: Option<u32>,
    /// 本地分支相对上游的落后提交数（无上游时为 None）
    pub behind: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagInfo {
    /// 标签短名（去掉 `refs/tags/` 前缀）
    pub name: String,
    /// 标签指向的 commit oid（附注标签会 peel 到 commit）
    pub commit_oid: String,
    /// 是否为附注标签（annotated），否则为轻量标签
    pub is_annotated: bool,
    /// 附注标签的 message；轻量标签为 None
    pub message: Option<String>,
    /// 附注标签的 tagger 名字；轻量标签为 None
    pub tagger_name: Option<String>,
    /// 附注标签的创建时间（秒，Unix epoch）；轻量标签为 None
    pub time: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffHunk {
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    pub header: String,
    pub lines: Vec<DiffLine>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffLine {
    pub origin: char,
    pub content: String,
    pub old_lineno: Option<u32>,
    pub new_lineno: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileDiff {
    pub old_path: Option<String>,
    pub new_path: Option<String>,
    pub is_binary: bool,
    pub hunks: Vec<DiffHunk>,
    pub additions: usize,
    pub deletions: usize,
    /// 旧侧 blob oid；新增/未跟踪场景为 None（对应 git2 的零 oid）
    #[serde(default)]
    pub old_blob_oid: Option<String>,
    /// 新侧 blob oid；删除场景或工作区未暂存的修改侧为 None
    #[serde(default)]
    pub new_blob_oid: Option<String>,
}

/// 二进制 blob 的字节数据（base64 编码），用于图片预览等场景。
/// 超过大小阈值时 `truncated=true` 且 `bytes_base64` 为空。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlobData {
    pub bytes_base64: String,
    pub size: u64,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommitDetail {
    pub info: CommitInfo,
    pub diffs: Vec<FileDiff>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogPage {
    pub commits: Vec<CommitInfo>,
    pub has_more: bool,
    pub total_loaded: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StashEntry {
    pub index: usize,
    pub message: String,
    pub commit_oid: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum SubmoduleState {
    /// 在 .gitmodules 中存在但 .git/config 中未注册
    Uninitialized,
    /// 已 init 但工作区没有 clone（WD_UNINITIALIZED）
    NotCloned,
    /// workdir commit 与父仓库记录的 head commit 一致，且工作区干净
    UpToDate,
    /// workdir commit 偏离 head commit，或工作区有本地修改
    Modified,
    /// 条目存在于 .gitmodules 中但磁盘上找不到（罕见情况）
    NotFound,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReflogEntry {
    pub oid: String,
    pub short_oid: String,
    /// reflog 动作描述，如 "commit: fix bug" / "reset: moving to HEAD~1"
    pub message: String,
    pub committer_name: String,
    pub time: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubmoduleInfo {
    pub name: String,
    pub path: String,
    pub url: Option<String>,
    pub head_oid: Option<String>,
    pub workdir_oid: Option<String>,
    pub state: SubmoduleState,
    pub has_workdir_modifications: bool,
}
