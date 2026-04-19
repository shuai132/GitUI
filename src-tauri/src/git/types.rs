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
    #[serde(default = "RepoState::clean_default")]
    pub repo_state: RepoState,
}

/// 仓库当前所处的"状态"：clean / merge 中 / rebase 中 / cherry-pick 中 / 等等。
/// 来源：libgit2 `Repository::state()` + 读取 `.git/` 下的中间文件。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum RepoStateKind {
    Clean,
    Merge,
    Rebase,
    RebaseInteractive,
    RebaseMerge,
    CherryPick,
    Revert,
    Bisect,
    ApplyMailbox,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoState {
    pub kind: RepoStateKind,
    pub head_oid: Option<String>,
    /// `.git/MERGE_MSG`（merge 模板消息）
    pub merge_msg: Option<String>,
    /// `.git/MERGE_HEAD` 的第一行（待合入的 commit oid）
    pub merge_head: Option<String>,
    /// rebase: `.git/rebase-merge/onto` 或 `.git/rebase-apply/onto`
    pub rebase_onto: Option<String>,
    /// rebase: `.git/rebase-merge/orig-head`
    pub rebase_orig_head: Option<String>,
    /// rebase: `.git/rebase-merge/head-name`
    pub rebase_head_name: Option<String>,
    /// rebase 当前步（1-based）
    pub rebase_step: Option<u32>,
    /// rebase 总步数
    pub rebase_total: Option<u32>,
    /// rebase 当前正在处理的 commit oid（stopped-sha）
    pub rebase_current_oid: Option<String>,
}

impl RepoState {
    pub fn clean_default() -> Self {
        RepoState {
            kind: RepoStateKind::Clean,
            head_oid: None,
            merge_msg: None,
            merge_head: None,
            rebase_onto: None,
            rebase_orig_head: None,
            rebase_head_name: None,
            rebase_step: None,
            rebase_total: None,
            rebase_current_oid: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum MergeStrategy {
    /// 自动：允许 fast-forward，否则做非 ff 合并
    Auto,
    /// 强制 fast-forward；若不能则报错
    FastForward,
    /// 禁止 fast-forward，始终创建 merge commit
    NoFastForward,
    /// Squash：把 source 的改动压扁写入 index，不创建 merge commit
    Squash,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum RebaseActionKind {
    Pick,
    Reword,
    Squash,
    Fixup,
    Drop,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RebaseTodoItem {
    pub oid: String,
    pub short_oid: String,
    pub action: RebaseActionKind,
    pub subject: String,
    /// reword / squash 时前端填入的新消息；其它动作为 None
    pub new_message: Option<String>,
    /// reword 时可选覆盖 author date（Unix 秒）；None = 保留原值
    #[serde(default)]
    pub new_author_time: Option<i64>,
    /// reword 时可选覆盖 committer date（Unix 秒）；None = 当前时间
    #[serde(default)]
    pub new_committer_time: Option<i64>,
}

/// 冲突文件的三方数据（base=stage1, ours=stage2, theirs=stage3）。
/// 每侧若对应 stage 不存在（删除冲突）则为 None。字节以 UTF-8 解析，非文本时返回
/// 原始字节的 lossy 串（前端会拒绝在三路编辑器里打开并提示"二进制冲突"）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConflictFile {
    pub path: String,
    pub base: Option<String>,
    pub ours: Option<String>,
    pub theirs: Option<String>,
    /// 工作区当前内容（含冲突标记 `<<<<<<<`），前端可作为合并起点
    pub merged_preview: String,
    /// 任一侧疑似二进制（含 NUL 字节），前端应禁用三路编辑器
    pub is_binary: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommitInfo {
    pub oid: String,
    pub short_oid: String,
    pub message: String,
    pub summary: String,
    pub author_name: String,
    pub author_email: String,
    pub author_time: i64,
    pub time: i64,
    pub parent_oids: Vec<String>,
    /// 该提交在所有 ref 之外，仅通过 reflog 才能找到（"丢失引用"）
    #[serde(default)]
    pub is_unreachable: bool,
    /// 该提交是一条 stash 的根提交
    #[serde(default)]
    pub is_stash: bool,
    /// 该提交是 HEAD reflog 闭包中的 "tip"：oid 直接出现在某条 reflog entry 的 new_oid 里，
    /// 且不是任何其他 reflog oid 的严格祖先。只有 tip 才能通过 `drop_unreachable_commit`
    /// 直接从视图中移除；非 tip 的 unreachable commit 需要先把它的"后代 tip"移除，
    /// 它才会晋升为新的 tip。详见 docs/10-stash-reflog.md。
    #[serde(default)]
    pub is_reflog_tip: bool,
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

/// blame 中连续若干行属于同一次提交的片段
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlameHunk {
    /// 起始行号（1-based）
    pub start_line: u32,
    /// 该 hunk 包含的行数
    pub num_lines: u32,
    pub commit_oid: String,
    pub short_oid: String,
    pub author_name: String,
    pub author_email: String,
    pub time: i64,
    pub summary: String,
}

/// 文件 blame 结果：行内容 + 逐 hunk 注解
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileBlame {
    /// 文件内容按行（不含换行符）
    pub lines: Vec<String>,
    pub hunks: Vec<BlameHunk>,
}

/// 构建信息：版本号 + 编译时注入的短 commit hash。
/// `git_hash` 在以下任一条件成立时为 None：
/// - 编译时不在 git 工作树中（如 crates.io 发布、容器构建无 .git）
/// - CI 未传 `GIT_HASH` env，且本地 `git rev-parse` 失败
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BuildInfo {
    pub version: String,
    pub git_hash: Option<String>,
}
