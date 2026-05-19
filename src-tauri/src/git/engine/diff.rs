use base64::prelude::{Engine as _, BASE64_STANDARD};
use git2::{AttrCheckFlags, DiffFormat, DiffOptions, Repository};
use quick_xml::{events::Event, Reader};
use std::{
    io::{Cursor, Read},
    path::Path,
};
use zip::ZipArchive;

use crate::git::{
    encoding::{decode_with, detect_file_encoding},
    error::{GitError, GitResult},
    types::*,
};

use super::{build_commit_info, GitEngine, LARGE_BLOB_THRESHOLD_BYTES, MAX_PREVIEW_BYTES};

const MAX_DOCUMENT_TEXT_CHARS: usize = 250_000;

impl GitEngine {
    pub(super) fn add_tree_change_stats(
        repo: &Repository,
        old_tree: Option<&git2::Tree<'_>>,
        new_tree: Option<&git2::Tree<'_>>,
        stats: &mut CommitChangeStats,
    ) -> GitResult<()> {
        let mut opts = git2::DiffOptions::new();
        opts.context_lines(0).interhunk_lines(0);
        let diff = repo.diff_tree_to_tree(old_tree, new_tree, Some(&mut opts))?;
        Self::add_diff_change_stats(repo, &diff, stats)
    }

    fn add_diff_change_stats(
        repo: &Repository,
        diff: &git2::Diff<'_>,
        stats: &mut CommitChangeStats,
    ) -> GitResult<()> {
        let diff_stats = diff.stats()?;
        stats.files_changed += diff_stats.files_changed();
        stats.additions += diff_stats.insertions();
        stats.deletions += diff_stats.deletions();

        for delta in diff.deltas() {
            let old_file = delta.old_file();
            let new_file = delta.new_file();
            let (old_size, old_blob_binary) = Self::diff_file_blob_metadata(repo, &old_file);
            let (new_size, new_blob_binary) = Self::diff_file_blob_metadata(repo, &new_file);

            if old_file.is_binary() || new_file.is_binary() || old_blob_binary || new_blob_binary {
                stats.binary_files += 1;
            }

            let changed_blob_size = old_size.max(new_size);
            stats.largest_blob_bytes = stats.largest_blob_bytes.max(changed_blob_size);

            if changed_blob_size >= LARGE_BLOB_THRESHOLD_BYTES {
                stats.large_blob_count += 1;
                stats.large_blob_bytes = stats.large_blob_bytes.saturating_add(changed_blob_size);
            }
        }

        Ok(())
    }

    fn diff_file_blob_metadata(repo: &Repository, file: &git2::DiffFile<'_>) -> (u64, bool) {
        let oid = file.id();
        if oid.is_zero() {
            return (0, false);
        }
        repo.find_blob(oid)
            .map(|blob| (blob.size() as u64, blob.is_binary()))
            .unwrap_or_else(|_| (file.size(), false))
    }

    pub fn get_commit_summary(
        path: &str,
        oid_str: &str,
        include_stats: bool,
    ) -> GitResult<CommitDetail> {
        let repo = Self::open(path)?;
        let oid = git2::Oid::from_str(oid_str)
            .map_err(|e| GitError::OperationFailed(e.message().to_string()))?;
        let commit = repo.find_commit(oid)?;

        let parent_oids = commit.parent_ids().map(|p| p.to_string()).collect();
        let info = build_commit_info(&commit, parent_oids, false, false, false);

        let mut opts = git2::DiffOptions::new();
        opts.context_lines(0).interhunk_lines(0);

        let diff = if commit.parent_count() > 0 {
            let parent = commit.parent(0)?;
            let parent_tree = parent.tree()?;
            let commit_tree = commit.tree()?;
            repo.diff_tree_to_tree(Some(&parent_tree), Some(&commit_tree), Some(&mut opts))?
        } else {
            let commit_tree = commit.tree()?;
            repo.diff_tree_to_tree(None, Some(&commit_tree), Some(&mut opts))?
        };

        let mut diffs = Self::parse_diff_summary(&repo, &diff, include_stats)?;

        if commit.parent_count() == 3 {
            if let Ok(untracked_commit) = commit.parent(2) {
                if untracked_commit.parent_count() == 0
                    && untracked_commit
                        .message()
                        .unwrap_or("")
                        .starts_with("untracked")
                {
                    if let Ok(untracked_tree) = untracked_commit.tree() {
                        if let Ok(untracked_diff) =
                            repo.diff_tree_to_tree(None, Some(&untracked_tree), Some(&mut opts))
                        {
                            if let Ok(mut untracked_diffs) =
                                Self::parse_diff_summary(&repo, &untracked_diff, include_stats)
                            {
                                diffs.append(&mut untracked_diffs);
                            }
                        }
                    }
                }
            }
        }

        Ok(CommitDetail { info, diffs })
    }

    pub fn get_commit_detail(path: &str, oid_str: &str) -> GitResult<CommitDetail> {
        let repo = Self::open(path)?;
        let oid = git2::Oid::from_str(oid_str)
            .map_err(|e| GitError::OperationFailed(e.message().to_string()))?;
        let commit = repo.find_commit(oid)?;

        let parent_oids = commit.parent_ids().map(|p| p.to_string()).collect();
        let info = build_commit_info(&commit, parent_oids, false, false, false);

        let mut opts = git2::DiffOptions::new();
        opts.context_lines(0).interhunk_lines(0);

        let diff = if commit.parent_count() > 0 {
            let parent = commit.parent(0)?;
            let parent_tree = parent.tree()?;
            let commit_tree = commit.tree()?;
            repo.diff_tree_to_tree(Some(&parent_tree), Some(&commit_tree), Some(&mut opts))?
        } else {
            let commit_tree = commit.tree()?;
            repo.diff_tree_to_tree(None, Some(&commit_tree), Some(&mut opts))?
        };

        let mut diffs = Self::parse_diff(&repo, &diff)?;

        // stash 提交有 3 个父节点时，parent[2] 是未跟踪文件快照（untracked commit）。
        // 主 diff（HEAD vs WIP）不包含这些文件，需单独对比空树来补全。
        if commit.parent_count() == 3 {
            if let Ok(untracked_commit) = commit.parent(2) {
                if untracked_commit.parent_count() == 0
                    && untracked_commit
                        .message()
                        .unwrap_or("")
                        .starts_with("untracked")
                {
                    if let Ok(untracked_tree) = untracked_commit.tree() {
                        if let Ok(untracked_diff) =
                            repo.diff_tree_to_tree(None, Some(&untracked_tree), Some(&mut opts))
                        {
                            if let Ok(mut untracked_diffs) =
                                Self::parse_diff(&repo, &untracked_diff)
                            {
                                diffs.append(&mut untracked_diffs);
                            }
                        }
                    }
                }
            }
        }

        Ok(CommitDetail { info, diffs })
    }

    pub fn get_file_diff(path: &str, file_path: &str, staged: bool) -> GitResult<FileDiff> {
        let repo = Self::open(path)?;

        // 冲突文件：index 只有 stage 1/2/3，没有 stage 0，
        // 走 diff_index_to_workdir 会被跳过导致返回空。改用 stage 2 blob 与工作区手动 diff。
        if !staged {
            if let Some(diff) = Self::try_conflict_diff(&repo, file_path)? {
                return Ok(diff);
            }
        }

        let mut diff_opts = DiffOptions::new();
        diff_opts.pathspec(file_path).include_typechange(true);

        let diff = if staged {
            let head_tree = repo
                .head()
                .ok()
                .and_then(|h| h.peel_to_commit().ok())
                .and_then(|c| c.tree().ok());
            let index = repo.index()?;
            repo.diff_tree_to_index(head_tree.as_ref(), Some(&index), Some(&mut diff_opts))?
        } else {
            // Include untracked file content so newly-added (untracked) files
            // show a proper line-by-line diff instead of an empty result.
            diff_opts
                .include_untracked(true)
                .show_untracked_content(true)
                .recurse_untracked_dirs(true);
            let index = repo.index()?;
            repo.diff_index_to_workdir(Some(&index), Some(&mut diff_opts))?
        };

        let mut file_diff = Self::parse_diff(&repo, &diff)?
            .into_iter()
            .next()
            .unwrap_or_else(|| Self::empty_file_diff(file_path));
        Self::supplement_typechange_hunks(&repo, file_path, staged, &mut file_diff)?;
        Ok(file_diff)
    }

    fn supplement_typechange_hunks(
        repo: &Repository,
        file_path: &str,
        staged: bool,
        diff: &mut FileDiff,
    ) -> GitResult<()> {
        if !diff.hunks.is_empty() {
            return Ok(());
        }

        let Some(old_mode) = diff.old_file_mode else {
            return Ok(());
        };
        let Some(new_mode) = diff.new_file_mode else {
            return Ok(());
        };
        if file_type_bits(old_mode) == file_type_bits(new_mode) {
            return Ok(());
        }

        let old_bytes = diff
            .old_blob_oid
            .as_deref()
            .and_then(|oid| Self::blob_content(repo, oid))
            .unwrap_or_default();
        let new_bytes = if staged {
            diff.new_blob_oid
                .as_deref()
                .and_then(|oid| Self::blob_content(repo, oid))
                .unwrap_or_default()
        } else {
            Self::worktree_content(repo, file_path, new_mode).unwrap_or_else(|| {
                diff.new_blob_oid
                    .as_deref()
                    .and_then(|oid| Self::blob_content(repo, oid))
                    .unwrap_or_default()
            })
        };

        Self::fill_buffer_diff(repo, file_path, &old_bytes, &new_bytes, diff)
    }

    fn blob_content(repo: &Repository, oid_str: &str) -> Option<Vec<u8>> {
        git2::Oid::from_str(oid_str)
            .ok()
            .and_then(|oid| repo.find_blob(oid).ok())
            .map(|blob| blob.content().to_vec())
    }

    fn worktree_content(repo: &Repository, file_path: &str, mode: u32) -> Option<Vec<u8>> {
        let full_path = repo.workdir()?.join(file_path);
        if file_type_bits(mode) == 0o120000 {
            return std::fs::read_link(full_path)
                .ok()
                .map(|target| target.to_string_lossy().as_bytes().to_vec());
        }
        std::fs::read(full_path).ok()
    }

    fn fill_buffer_diff(
        repo: &Repository,
        file_path: &str,
        old_bytes: &[u8],
        new_bytes: &[u8],
        diff: &mut FileDiff,
    ) -> GitResult<()> {
        let is_binary = old_bytes.contains(&0) || new_bytes.contains(&0);
        diff.is_binary = diff.is_binary || is_binary;

        let attr_encoding: Option<String> = repo
            .get_attr(
                Path::new(file_path),
                "working-tree-encoding",
                AttrCheckFlags::default(),
            )
            .ok()
            .flatten()
            .map(|s| s.to_string());
        let bom_enc = encoding_rs::Encoding::for_bom(new_bytes)
            .map(|(e, _)| e)
            .or_else(|| encoding_rs::Encoding::for_bom(old_bytes).map(|(e, _)| e));
        let enc = if is_binary {
            encoding_rs::UTF_8
        } else {
            let mut sample = Vec::with_capacity(old_bytes.len().saturating_add(new_bytes.len()));
            sample.extend_from_slice(old_bytes);
            sample.extend_from_slice(new_bytes);
            detect_file_encoding(&sample, attr_encoding.as_deref(), bom_enc)
        };
        diff.encoding = if enc == encoding_rs::UTF_8 && bom_enc == Some(encoding_rs::UTF_8) {
            "UTF-8 BOM".to_owned()
        } else {
            enc.name().to_owned()
        };

        if is_binary {
            return Ok(());
        }

        let mut diff_opts = git2::DiffOptions::new();
        diff_opts.context_lines(3).interhunk_lines(0);
        let patch = git2::Patch::from_buffers(
            old_bytes,
            Some(std::path::Path::new(file_path)),
            new_bytes,
            Some(std::path::Path::new(file_path)),
            Some(&mut diff_opts),
        )?;

        let mut hunks = Vec::new();
        let mut additions = 0usize;
        let mut deletions = 0usize;
        for hi in 0..patch.num_hunks() {
            let (hunk, num_lines) = patch.hunk(hi)?;
            let mut cur = DiffHunk {
                old_start: hunk.old_start(),
                old_lines: hunk.old_lines(),
                new_start: hunk.new_start(),
                new_lines: hunk.new_lines(),
                header: decode_with(enc, hunk.header()),
                lines: vec![],
            };
            for li in 0..num_lines {
                let line = patch.line_in_hunk(hi, li)?;
                let origin = line.origin();
                match origin {
                    '+' => additions += 1,
                    '-' => deletions += 1,
                    _ => {}
                }
                cur.lines.push(DiffLine {
                    origin,
                    content: decode_with(enc, line.content()),
                    old_lineno: line.old_lineno(),
                    new_lineno: line.new_lineno(),
                });
            }
            hunks.push(cur);
        }

        diff.hunks = hunks;
        diff.additions = additions;
        diff.deletions = deletions;
        Ok(())
    }

    fn empty_file_diff(file_path: &str) -> FileDiff {
        FileDiff {
            old_path: None,
            new_path: Some(file_path.to_string()),
            is_binary: false,
            hunks: vec![],
            additions: 0,
            deletions: 0,
            old_blob_oid: None,
            new_blob_oid: None,
            old_file_mode: None,
            new_file_mode: None,
            encoding: "UTF-8".to_owned(),
        }
    }

    /// 如果 `file_path` 是冲突文件，用 stage 2（ours）blob 与工作区内容做 diff。
    /// 非冲突返回 Ok(None)，让调用方继续走原路径。
    fn try_conflict_diff(repo: &Repository, file_path: &str) -> GitResult<Option<FileDiff>> {
        let index = repo.index()?;
        let conflict = match index.conflicts() {
            Ok(iter) => {
                let mut found = None;
                for c in iter {
                    let c = c?;
                    let p = c
                        .ancestor
                        .as_ref()
                        .or(c.our.as_ref())
                        .or(c.their.as_ref())
                        .and_then(|e| std::str::from_utf8(&e.path).ok());
                    if p == Some(file_path) {
                        found = Some(c);
                        break;
                    }
                }
                found
            }
            Err(_) => None,
        };
        let conflict = match conflict {
            Some(c) => c,
            None => return Ok(None),
        };

        // "old" = ours（stage 2）、"new" = 工作区当前内容（含冲突标记）
        let ours_blob = conflict
            .our
            .as_ref()
            .and_then(|e| repo.find_blob(e.id).ok());
        let old_bytes: Vec<u8> = ours_blob
            .as_ref()
            .map(|b| b.content().to_vec())
            .unwrap_or_default();
        let old_blob_oid = conflict.our.as_ref().map(|e| e.id.to_string());

        let workdir = repo
            .workdir()
            .ok_or_else(|| GitError::OperationFailed("裸仓库不支持".to_string()))?;
        let new_bytes = std::fs::read(workdir.join(file_path)).unwrap_or_default();

        let is_binary = old_bytes.contains(&0) || new_bytes.contains(&0);

        let mut hunks: Vec<DiffHunk> = Vec::new();
        let mut additions = 0usize;
        let mut deletions = 0usize;

        // 先确定编码（二进制文件兜底 UTF-8，非二进制才真正用到）
        let attr_encoding: Option<String> = repo
            .get_attr(
                Path::new(file_path),
                "working-tree-encoding",
                AttrCheckFlags::default(),
            )
            .ok()
            .flatten()
            .map(|s| s.to_string());
        // 检测 BOM（new 优先，其次 old）
        let bom_enc = encoding_rs::Encoding::for_bom(&new_bytes)
            .map(|(e, _)| e)
            .or_else(|| encoding_rs::Encoding::for_bom(&old_bytes).map(|(e, _)| e));
        let enc = if is_binary {
            encoding_rs::UTF_8
        } else {
            detect_file_encoding(&new_bytes, attr_encoding.as_deref(), bom_enc)
        };
        // UTF-8 有 BOM 时显示 "UTF-8 BOM" 以示区分
        let encoding_name = if enc == encoding_rs::UTF_8 && bom_enc == Some(encoding_rs::UTF_8) {
            "UTF-8 BOM".to_owned()
        } else {
            enc.name().to_owned()
        };

        if !is_binary {
            let mut diff_opts = git2::DiffOptions::new();
            diff_opts.context_lines(3).interhunk_lines(0);
            let patch = git2::Patch::from_buffers(
                &old_bytes,
                Some(std::path::Path::new(file_path)),
                &new_bytes,
                Some(std::path::Path::new(file_path)),
                Some(&mut diff_opts),
            )?;
            let num_hunks = patch.num_hunks();
            for hi in 0..num_hunks {
                let (hunk, num_lines) = patch.hunk(hi)?;
                let mut cur = DiffHunk {
                    old_start: hunk.old_start(),
                    old_lines: hunk.old_lines(),
                    new_start: hunk.new_start(),
                    new_lines: hunk.new_lines(),
                    header: decode_with(enc, hunk.header()),
                    lines: vec![],
                };
                for li in 0..num_lines {
                    let line = patch.line_in_hunk(hi, li)?;
                    let origin = line.origin();
                    match origin {
                        '+' => additions += 1,
                        '-' => deletions += 1,
                        _ => {}
                    }
                    cur.lines.push(DiffLine {
                        origin,
                        content: decode_with(enc, line.content()),
                        old_lineno: line.old_lineno(),
                        new_lineno: line.new_lineno(),
                    });
                }
                hunks.push(cur);
            }
        }

        Ok(Some(FileDiff {
            old_path: Some(file_path.to_string()),
            new_path: Some(file_path.to_string()),
            is_binary,
            hunks,
            additions,
            deletions,
            old_blob_oid,
            new_blob_oid: None,
            old_file_mode: conflict.our.as_ref().map(|e| e.mode),
            new_file_mode: None,
            encoding: encoding_name,
        }))
    }

    /// 把 git2 diff 解析为 `FileDiff` 列表。
    ///
    /// 编码处理分两阶段，避免「跨文件检测」导致的 GBK / UTF-8 混合仓库乱码：
    ///
    /// 1. **walk 阶段**：只把每个 hunk header / line content 的原始字节拷进
    ///    内部 `Pending*` 结构，不立即转 String
    /// 2. **finalize 阶段**：对每个文件单独决定编码（`.gitattributes` 的
    ///    `working-tree-encoding` → UTF-8 试解 → chardetng on 全文件拼接），
    ///    再用该编码 decode 所有 header / line bytes
    ///
    /// 见 [`crate::git::encoding`] 模块的优先级链注释。
    fn parse_diff(repo: &Repository, diff: &git2::Diff) -> GitResult<Vec<FileDiff>> {
        struct PendingHunk {
            old_start: u32,
            old_lines: u32,
            new_start: u32,
            new_lines: u32,
            header_bytes: Vec<u8>,
            lines: Vec<PendingLine>,
        }
        struct PendingLine {
            origin: char,
            content_bytes: Vec<u8>,
            old_lineno: Option<u32>,
            new_lineno: Option<u32>,
        }
        struct PendingFile {
            old_path: Option<String>,
            new_path: Option<String>,
            is_binary: bool,
            old_blob_oid: Option<String>,
            new_blob_oid: Option<String>,
            old_file_mode: Option<u32>,
            new_file_mode: Option<u32>,
            hunks: Vec<PendingHunk>,
            current_hunk: Option<PendingHunk>,
            additions: usize,
            deletions: usize,
        }

        let mut files: Vec<PendingFile> = Vec::new();
        let mut current: Option<PendingFile> = None;

        diff.print(DiffFormat::Patch, |delta, hunk, line| {
            use git2::DiffLineType;

            match line.origin_value() {
                DiffLineType::FileHeader => {
                    if let Some(mut f) = current.take() {
                        if let Some(h) = f.current_hunk.take() {
                            f.hunks.push(h);
                        }
                        files.push(f);
                    }
                    let old_path = delta
                        .old_file()
                        .path()
                        .map(|p| p.to_string_lossy().to_string());
                    let new_path = delta
                        .new_file()
                        .path()
                        .map(|p| p.to_string_lossy().to_string());
                    let is_binary = delta.old_file().is_binary() || delta.new_file().is_binary();
                    let old_id = delta.old_file().id();
                    let new_id = delta.new_file().id();
                    let old_file_mode = diff_file_mode(&delta.old_file());
                    let new_file_mode = diff_file_mode(&delta.new_file());
                    let old_blob_oid = if old_id.is_zero() {
                        None
                    } else {
                        Some(old_id.to_string())
                    };
                    let new_blob_oid = if new_id.is_zero() {
                        None
                    } else {
                        Some(new_id.to_string())
                    };

                    if let Some(last) = files.last_mut() {
                        if last.new_path == new_path
                            && last.old_path == old_path
                            && last.new_path.is_some()
                        {
                            let mut merged = files.pop().unwrap();
                            if new_id.is_zero() {
                                merged.old_blob_oid = Some(old_id.to_string());
                                merged.old_file_mode = old_file_mode;
                            } else if old_id.is_zero() {
                                merged.new_blob_oid = Some(new_id.to_string());
                                merged.new_file_mode = new_file_mode;
                            }
                            merged.is_binary = merged.is_binary || is_binary;
                            current = Some(merged);
                            return true;
                        }
                    }

                    current = Some(PendingFile {
                        old_path,
                        new_path,
                        is_binary,
                        old_blob_oid,
                        new_blob_oid,
                        old_file_mode,
                        new_file_mode,
                        hunks: Vec::new(),
                        current_hunk: None,
                        additions: 0,
                        deletions: 0,
                    });
                }
                DiffLineType::HunkHeader => {
                    if let Some(f) = current.as_mut() {
                        if let Some(h) = f.current_hunk.take() {
                            f.hunks.push(h);
                        }
                        if let Some(hunk) = hunk {
                            f.current_hunk = Some(PendingHunk {
                                old_start: hunk.old_start(),
                                old_lines: hunk.old_lines(),
                                new_start: hunk.new_start(),
                                new_lines: hunk.new_lines(),
                                header_bytes: hunk.header().to_vec(),
                                lines: Vec::new(),
                            });
                        }
                    }
                }
                DiffLineType::Addition => {
                    if let Some(f) = current.as_mut() {
                        f.additions += 1;
                        if let Some(h) = f.current_hunk.as_mut() {
                            h.lines.push(PendingLine {
                                origin: '+',
                                content_bytes: line.content().to_vec(),
                                old_lineno: line.old_lineno(),
                                new_lineno: line.new_lineno(),
                            });
                        }
                    }
                }
                DiffLineType::Deletion => {
                    if let Some(f) = current.as_mut() {
                        f.deletions += 1;
                        if let Some(h) = f.current_hunk.as_mut() {
                            h.lines.push(PendingLine {
                                origin: '-',
                                content_bytes: line.content().to_vec(),
                                old_lineno: line.old_lineno(),
                                new_lineno: line.new_lineno(),
                            });
                        }
                    }
                }
                DiffLineType::Context => {
                    if let Some(f) = current.as_mut() {
                        if let Some(h) = f.current_hunk.as_mut() {
                            h.lines.push(PendingLine {
                                origin: ' ',
                                content_bytes: line.content().to_vec(),
                                old_lineno: line.old_lineno(),
                                new_lineno: line.new_lineno(),
                            });
                        }
                    }
                }
                _ => {}
            }
            true
        })?;

        if let Some(mut f) = current.take() {
            if let Some(h) = f.current_hunk.take() {
                f.hunks.push(h);
            }
            files.push(f);
        }

        // ── Phase 2: per-file encoding detection + decode ───────────────────
        const SAMPLE_LIMIT: usize = 64 * 1024;
        let mut out: Vec<FileDiff> = Vec::with_capacity(files.len());
        for pending in files {
            // .gitattributes 的 working-tree-encoding（libgit2 不自动转码，但能读到属性值）
            let attr_encoding: Option<String> = pending
                .new_path
                .as_deref()
                .or(pending.old_path.as_deref())
                .and_then(|p| {
                    repo.get_attr(
                        Path::new(p),
                        "working-tree-encoding",
                        AttrCheckFlags::default(),
                    )
                    .ok()
                    .flatten()
                    .map(|s| s.to_string())
                });

            // 拼最多 64KB 字节作为 chardetng 的样本（attr 已声明时其实用不上）
            let mut sample: Vec<u8> = Vec::new();
            'outer: for h in &pending.hunks {
                for l in &h.lines {
                    sample.extend_from_slice(&l.content_bytes);
                    if sample.len() >= SAMPLE_LIMIT {
                        break 'outer;
                    }
                }
            }

            let mut file_bom_enc: Option<&'static encoding_rs::Encoding> = None;
            for oid_str in [&pending.new_blob_oid, &pending.old_blob_oid] {
                if let Some(oid_str) = oid_str {
                    if let Ok(oid) = git2::Oid::from_str(oid_str) {
                        if let Ok(blob) = repo.find_blob(oid) {
                            if let Some((enc, _)) = encoding_rs::Encoding::for_bom(blob.content()) {
                                file_bom_enc = Some(enc);
                                break;
                            }
                        }
                    }
                }
            }

            if file_bom_enc.is_none() && pending.new_blob_oid.is_none() {
                if let (Some(workdir), Some(path)) = (repo.workdir(), pending.new_path.as_deref()) {
                    let full_path = workdir.join(path);
                    if let Ok(mut f) = std::fs::File::open(full_path) {
                        use std::io::Read;
                        let mut buf = [0u8; 3];
                        let read_len = f.read(&mut buf).unwrap_or(0);
                        if let Some((enc, _)) = encoding_rs::Encoding::for_bom(&buf[..read_len]) {
                            file_bom_enc = Some(enc);
                        }
                    }
                }
            }

            let enc = detect_file_encoding(&sample, attr_encoding.as_deref(), file_bom_enc);
            // UTF-8 有 BOM 时显示 "UTF-8 BOM" 以示区分
            let encoding_name =
                if enc == encoding_rs::UTF_8 && file_bom_enc == Some(encoding_rs::UTF_8) {
                    "UTF-8 BOM".to_owned()
                } else {
                    enc.name().to_owned()
                };

            let hunks: Vec<DiffHunk> = pending
                .hunks
                .into_iter()
                .map(|h| {
                    let mut old_line = h.old_start;
                    let mut new_line = h.new_start;
                    let lines = h
                        .lines
                        .into_iter()
                        .map(|l| {
                            let old_lineno = match l.origin {
                                '+' => None,
                                _ => l.old_lineno.or_else(|| line_number(old_line)),
                            };
                            let new_lineno = match l.origin {
                                '-' => None,
                                _ => l.new_lineno.or_else(|| line_number(new_line)),
                            };

                            match l.origin {
                                '+' => new_line = new_line.saturating_add(1),
                                '-' => old_line = old_line.saturating_add(1),
                                _ => {
                                    old_line = old_line.saturating_add(1);
                                    new_line = new_line.saturating_add(1);
                                }
                            }

                            DiffLine {
                                origin: l.origin,
                                content: decode_with(enc, &l.content_bytes),
                                old_lineno,
                                new_lineno,
                            }
                        })
                        .collect();

                    DiffHunk {
                        old_start: h.old_start,
                        old_lines: h.old_lines,
                        new_start: h.new_start,
                        new_lines: h.new_lines,
                        header: decode_with(enc, &h.header_bytes),
                        lines,
                    }
                })
                .collect();

            out.push(FileDiff {
                old_path: pending.old_path,
                new_path: pending.new_path,
                is_binary: pending.is_binary,
                hunks,
                additions: pending.additions,
                deletions: pending.deletions,
                old_blob_oid: pending.old_blob_oid,
                new_blob_oid: pending.new_blob_oid,
                old_file_mode: pending.old_file_mode,
                new_file_mode: pending.new_file_mode,
                encoding: encoding_name,
            });
        }

        Ok(out)
    }

    /// 仅解析 diff 概览（文件列表及增删行数），不加载具体 hunk/line 内容。
    fn parse_diff_summary(
        _repo: &Repository,
        diff: &git2::Diff,
        include_stats: bool,
    ) -> GitResult<Vec<FileDiff>> {
        let files = std::cell::RefCell::new(Vec::<FileDiff>::with_capacity(diff.deltas().len()));

        let mut file_cb = |delta: git2::DiffDelta<'_>, _: f32| {
            let old_id = delta.old_file().id();
            let new_id = delta.new_file().id();
            let old_file_mode = diff_file_mode(&delta.old_file());
            let new_file_mode = diff_file_mode(&delta.new_file());
            let old_path = delta
                .old_file()
                .path()
                .map(|p| p.to_string_lossy().to_string());
            let new_path = delta
                .new_file()
                .path()
                .map(|p| p.to_string_lossy().to_string());

            let mut files_ref = files.borrow_mut();
            if let Some(last) = files_ref.last_mut() {
                if last.new_path == new_path && last.old_path == old_path && last.new_path.is_some()
                {
                    if new_id.is_zero() {
                        last.old_blob_oid = Some(old_id.to_string());
                        last.old_file_mode = old_file_mode;
                    } else if old_id.is_zero() {
                        last.new_blob_oid = Some(new_id.to_string());
                        last.new_file_mode = new_file_mode;
                    }
                    last.is_binary = last.is_binary
                        || delta.old_file().is_binary()
                        || delta.new_file().is_binary();
                    return true;
                }
            }

            files_ref.push(FileDiff {
                old_path,
                new_path,
                is_binary: delta.old_file().is_binary() || delta.new_file().is_binary(),
                hunks: Vec::new(),
                additions: 0,
                deletions: 0,
                old_blob_oid: if old_id.is_zero() {
                    None
                } else {
                    Some(old_id.to_string())
                },
                new_blob_oid: if new_id.is_zero() {
                    None
                } else {
                    Some(new_id.to_string())
                },
                old_file_mode,
                new_file_mode,
                encoding: "UTF-8".to_string(),
            });
            true
        };

        if include_stats {
            let mut line_cb = |_: git2::DiffDelta<'_>,
                               _: Option<git2::DiffHunk<'_>>,
                               line: git2::DiffLine<'_>| {
                if let Some(f) = files.borrow_mut().last_mut() {
                    match line.origin() {
                        '+' => f.additions += 1,
                        '-' => f.deletions += 1,
                        _ => {}
                    }
                }
                true
            };

            diff.foreach(&mut file_cb, None, None, Some(&mut line_cb))
                .map_err(|e| GitError::OperationFailed(e.message().to_string()))?;
        } else {
            diff.foreach(&mut file_cb, None, None, None)
                .map_err(|e| GitError::OperationFailed(e.message().to_string()))?;
        }

        Ok(files.into_inner())
    }

    /// 按 blob oid 读取原始字节并 base64 编码（用于二进制文件预览）。
    /// 超过 `MAX_PREVIEW_BYTES` 时返回 `truncated=true`，不带字节。
    pub fn get_blob_bytes(path: &str, oid_str: &str) -> GitResult<BlobData> {
        let repo = Self::open(path)?;
        let oid = git2::Oid::from_str(oid_str)
            .map_err(|e| GitError::OperationFailed(e.message().to_string()))?;
        let blob = repo.find_blob(oid)?;
        let size = blob.size() as u64;
        if size > MAX_PREVIEW_BYTES {
            return Ok(BlobData {
                bytes_base64: String::new(),
                size,
                truncated: true,
            });
        }
        let encoded = BASE64_STANDARD.encode(blob.content());
        Ok(BlobData {
            bytes_base64: encoded,
            size,
            truncated: false,
        })
    }

    /// 读取工作区内相对路径的文件字节（用于预览 WIP 未暂存的新版）。
    /// 路径会规范化后校验仍位于仓库目录内，防止路径穿越。
    pub fn read_worktree_file(path: &str, rel_path: &str) -> GitResult<BlobData> {
        let repo_root = Path::new(path)
            .canonicalize()
            .map_err(|e| GitError::OperationFailed(format!("canonicalize repo: {}", e)))?;
        let full = repo_root.join(rel_path);
        let full_canon = full
            .canonicalize()
            .map_err(|e| GitError::OperationFailed(format!("file not found: {}", e)))?;
        if !full_canon.starts_with(&repo_root) {
            return Err(GitError::OperationFailed(
                "path escapes repository root".to_string(),
            ));
        }
        let meta = std::fs::metadata(&full_canon)
            .map_err(|e| GitError::OperationFailed(format!("stat file: {}", e)))?;
        let size = meta.len();
        if size > MAX_PREVIEW_BYTES {
            return Ok(BlobData {
                bytes_base64: String::new(),
                size,
                truncated: true,
            });
        }
        let bytes = std::fs::read(&full_canon)
            .map_err(|e| GitError::OperationFailed(format!("read file: {}", e)))?;
        Ok(BlobData {
            bytes_base64: BASE64_STANDARD.encode(&bytes),
            size,
            truncated: false,
        })
    }

    pub fn extract_document_text(
        path: &str,
        source: &DocumentTextSource,
    ) -> GitResult<DocumentText> {
        let (bytes, display_path, source_truncated) =
            Self::read_document_source_bytes(path, source)?;
        if source_truncated {
            return Ok(DocumentText {
                text: String::new(),
                truncated: true,
            });
        }

        let ext = Path::new(&display_path)
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();

        let text = match ext.as_str() {
            "pdf" => extract_pdf_text(&bytes)?,
            "docx" => extract_docx_text(&bytes)?,
            "pptx" => extract_pptx_text(&bytes)?,
            _ => {
                return Err(GitError::OperationFailed(format!(
                    "unsupported document type: {}",
                    display_path
                )))
            }
        };

        let (text, truncated) = truncate_document_text(text);
        Ok(DocumentText {
            text,
            truncated: truncated || source_truncated,
        })
    }

    fn read_document_source_bytes(
        path: &str,
        source: &DocumentTextSource,
    ) -> GitResult<(Vec<u8>, String, bool)> {
        match source {
            DocumentTextSource::Blob {
                oid,
                path: display_path,
            } => {
                let repo = Self::open(path)?;
                let oid = git2::Oid::from_str(oid)
                    .map_err(|e| GitError::OperationFailed(e.message().to_string()))?;
                let blob = repo.find_blob(oid)?;
                if blob.size() as u64 > MAX_PREVIEW_BYTES {
                    return Ok((Vec::new(), display_path.clone(), true));
                }
                Ok((blob.content().to_vec(), display_path.clone(), false))
            }
            DocumentTextSource::Worktree { rel_path } => {
                let repo_root = Path::new(path)
                    .canonicalize()
                    .map_err(|e| GitError::OperationFailed(format!("canonicalize repo: {}", e)))?;
                let full = repo_root.join(rel_path);
                let full_canon = full
                    .canonicalize()
                    .map_err(|e| GitError::OperationFailed(format!("file not found: {}", e)))?;
                if !full_canon.starts_with(&repo_root) {
                    return Err(GitError::OperationFailed(
                        "path escapes repository root".to_string(),
                    ));
                }
                let meta = std::fs::metadata(&full_canon)
                    .map_err(|e| GitError::OperationFailed(format!("stat file: {}", e)))?;
                if meta.len() > MAX_PREVIEW_BYTES {
                    return Ok((Vec::new(), rel_path.clone(), true));
                }
                let bytes = std::fs::read(&full_canon)
                    .map_err(|e| GitError::OperationFailed(format!("read file: {}", e)))?;
                Ok((bytes, rel_path.clone(), false))
            }
        }
    }

    pub fn get_file_diff_at_commit(
        path: &str,
        file_path: &str,
        oid_str: &str,
    ) -> GitResult<FileDiff> {
        let repo = Self::open(path)?;
        let oid = git2::Oid::from_str(oid_str)
            .map_err(|e| GitError::OperationFailed(e.message().to_string()))?;
        let commit = repo.find_commit(oid)?;
        let commit_tree = commit.tree()?;

        let mut diff_opts = DiffOptions::new();
        diff_opts.pathspec(file_path);

        let diff = if commit.parent_count() > 0 {
            let parent_tree = commit.parent(0)?.tree()?;
            repo.diff_tree_to_tree(Some(&parent_tree), Some(&commit_tree), Some(&mut diff_opts))?
        } else {
            repo.diff_tree_to_tree(None, Some(&commit_tree), Some(&mut diff_opts))?
        };

        let mut diffs = Self::parse_diff(&repo, &diff)?;

        // stash 未跟踪文件快照补全（同 get_commit_detail 逻辑，但加了 pathspec 过滤）
        if commit.parent_count() == 3 {
            if let Ok(untracked_commit) = commit.parent(2) {
                if untracked_commit.parent_count() == 0
                    && untracked_commit
                        .message()
                        .unwrap_or("")
                        .starts_with("untracked")
                {
                    if let Ok(untracked_tree) = untracked_commit.tree() {
                        let mut untracked_opts = DiffOptions::new();
                        untracked_opts.pathspec(file_path);
                        if let Ok(untracked_diff) = repo.diff_tree_to_tree(
                            None,
                            Some(&untracked_tree),
                            Some(&mut untracked_opts),
                        ) {
                            if let Ok(mut untracked_diffs) =
                                Self::parse_diff(&repo, &untracked_diff)
                            {
                                diffs.append(&mut untracked_diffs);
                            }
                        }
                    }
                }
            }
        }

        Ok(diffs.into_iter().next().unwrap_or(FileDiff {
            old_path: None,
            new_path: Some(file_path.to_string()),
            is_binary: false,
            hunks: vec![],
            additions: 0,
            deletions: 0,
            old_blob_oid: None,
            new_blob_oid: None,
            old_file_mode: None,
            new_file_mode: None,
            encoding: "UTF-8".to_owned(),
        }))
    }
}

fn diff_file_mode(file: &git2::DiffFile<'_>) -> Option<u32> {
    file.exists().then(|| u32::from(file.mode()))
}

fn file_type_bits(mode: u32) -> u32 {
    mode & 0o170000
}

fn line_number(value: u32) -> Option<u32> {
    if value == 0 {
        None
    } else {
        Some(value)
    }
}

fn extract_pdf_text(bytes: &[u8]) -> GitResult<String> {
    let document = lopdf::Document::load_mem(bytes)
        .map_err(|e| GitError::OperationFailed(format!("read pdf: {}", e)))?;
    let pages: Vec<u32> = document.get_pages().keys().copied().collect();
    document
        .extract_text(&pages)
        .map_err(|e| GitError::OperationFailed(format!("extract pdf text: {}", e)))
}

fn extract_docx_text(bytes: &[u8]) -> GitResult<String> {
    let cursor = Cursor::new(bytes);
    let mut archive = ZipArchive::new(cursor)
        .map_err(|e| GitError::OperationFailed(format!("read docx: {}", e)))?;
    let mut document_xml = String::new();
    archive
        .by_name("word/document.xml")
        .map_err(|e| GitError::OperationFailed(format!("read docx document: {}", e)))?
        .read_to_string(&mut document_xml)
        .map_err(|e| GitError::OperationFailed(format!("decode docx document: {}", e)))?;

    extract_office_xml_text(&document_xml, "docx")
}

fn extract_pptx_text(bytes: &[u8]) -> GitResult<String> {
    let cursor = Cursor::new(bytes);
    let mut archive = ZipArchive::new(cursor)
        .map_err(|e| GitError::OperationFailed(format!("read pptx: {}", e)))?;
    let mut slide_names = Vec::new();
    for i in 0..archive.len() {
        let name = archive
            .by_index(i)
            .map_err(|e| GitError::OperationFailed(format!("read pptx entry: {}", e)))?
            .name()
            .to_owned();
        if name.starts_with("ppt/slides/slide") && name.ends_with(".xml") {
            slide_names.push(name);
        }
    }
    slide_names.sort_by_key(|name| office_part_number(name));

    let mut slides = Vec::new();
    for name in slide_names {
        let mut slide_xml = String::new();
        archive
            .by_name(&name)
            .map_err(|e| GitError::OperationFailed(format!("read pptx slide: {}", e)))?
            .read_to_string(&mut slide_xml)
            .map_err(|e| GitError::OperationFailed(format!("decode pptx slide: {}", e)))?;
        let text = extract_office_xml_text(&slide_xml, "pptx")?;
        if !text.is_empty() {
            slides.push(text);
        }
    }

    Ok(slides.join("\n\n"))
}

fn office_part_number(name: &str) -> u32 {
    let file_name = name.rsplit('/').next().unwrap_or(name);
    let digits: String = file_name.chars().filter(|ch| ch.is_ascii_digit()).collect();
    digits.parse().unwrap_or(u32::MAX)
}

fn extract_office_xml_text(xml: &str, kind: &str) -> GitResult<String> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(false);
    let mut buf = Vec::new();
    let mut text = String::new();
    let mut in_text = false;

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                if xml_local_name(e.name().as_ref()) == b"t" {
                    in_text = true;
                }
            }
            Ok(Event::End(e)) => match xml_local_name(e.name().as_ref()) {
                b"t" => in_text = false,
                b"p" => push_newline_once(&mut text),
                _ => {}
            },
            Ok(Event::Empty(e)) => match xml_local_name(e.name().as_ref()) {
                b"tab" => text.push('\t'),
                b"br" | b"cr" => push_newline_once(&mut text),
                _ => {}
            },
            Ok(Event::Text(e)) if in_text => {
                let decoded = e.decode().map_err(|err| {
                    GitError::OperationFailed(format!("decode {} text: {}", kind, err))
                })?;
                text.push_str(&decoded);
            }
            Ok(Event::GeneralRef(e)) if in_text => {
                if let Some(ch) = e.resolve_char_ref().map_err(|err| {
                    GitError::OperationFailed(format!("resolve {} text entity: {}", kind, err))
                })? {
                    text.push(ch);
                } else {
                    let entity = e.decode().map_err(|err| {
                        GitError::OperationFailed(format!("decode {} text entity: {}", kind, err))
                    })?;
                    if let Some(value) = quick_xml::escape::resolve_predefined_entity(&entity) {
                        text.push_str(value);
                    } else {
                        text.push('&');
                        text.push_str(&entity);
                        text.push(';');
                    }
                }
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(e) => {
                return Err(GitError::OperationFailed(format!(
                    "parse {} document: {}",
                    kind, e
                )))
            }
        }
        buf.clear();
    }

    Ok(text.trim_end_matches('\n').to_string())
}

fn xml_local_name(name: &[u8]) -> &[u8] {
    name.rsplit(|b| *b == b':').next().unwrap_or(name)
}

fn push_newline_once(text: &mut String) {
    if !text.ends_with('\n') {
        text.push('\n');
    }
}

fn truncate_document_text(text: String) -> (String, bool) {
    if text.chars().count() <= MAX_DOCUMENT_TEXT_CHARS {
        return (text, false);
    }

    let truncated: String = text.chars().take(MAX_DOCUMENT_TEXT_CHARS).collect();
    (truncated, true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::test_utils::TestRepo;
    use std::{fs, io::Write};
    use zip::{write::SimpleFileOptions, ZipWriter};

    #[test]
    fn unstaged_untracked_file_diff_has_new_line_numbers() {
        let test_repo = TestRepo::new();
        fs::write(test_repo.dir.path().join("new.txt"), "one\ntwo\n").unwrap();

        let diff = GitEngine::get_file_diff(test_repo.path_str(), "new.txt", false).unwrap();
        let line_numbers = diff
            .hunks
            .iter()
            .flat_map(|hunk| hunk.lines.iter())
            .filter(|line| line.origin == '+')
            .map(|line| line.new_lineno)
            .collect::<Vec<_>>();

        assert_eq!(line_numbers, vec![Some(1), Some(2)]);
    }

    #[test]
    fn docx_text_extraction_reads_paragraphs_tabs_and_breaks() {
        let xml = r#"
            <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
              <w:body>
                <w:p><w:r><w:t>Hello</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>World</w:t></w:r></w:p>
                <w:p><w:r><w:t>Line</w:t></w:r><w:r><w:br/></w:r><w:r><w:t>Two &amp; Three</w:t></w:r></w:p>
              </w:body>
            </w:document>
        "#;
        let bytes = docx_bytes(xml);

        let text = extract_docx_text(&bytes).unwrap();

        assert_eq!(text, "Hello\tWorld\nLine\nTwo & Three");
    }

    #[test]
    fn pptx_text_extraction_reads_slides_in_number_order() {
        let slide_10 = r#"
            <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
                   xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
              <p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Slide 10</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
            </p:sld>
        "#;
        let slide_2 = r#"
            <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
                   xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
              <p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Slide 2</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
            </p:sld>
        "#;
        let bytes = office_zip_bytes(&[
            ("ppt/slides/slide10.xml", slide_10),
            ("ppt/slides/slide2.xml", slide_2),
        ]);

        let text = extract_pptx_text(&bytes).unwrap();

        assert_eq!(text, "Slide 2\n\nSlide 10");
    }

    fn docx_bytes(document_xml: &str) -> Vec<u8> {
        office_zip_bytes(&[("word/document.xml", document_xml)])
    }

    fn office_zip_bytes(entries: &[(&str, &str)]) -> Vec<u8> {
        let cursor = Cursor::new(Vec::new());
        let mut writer = ZipWriter::new(cursor);
        for (path, content) in entries {
            writer
                .start_file(*path, SimpleFileOptions::default())
                .unwrap();
            writer.write_all(content.as_bytes()).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }
}
