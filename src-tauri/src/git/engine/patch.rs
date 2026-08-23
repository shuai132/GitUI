use std::{
    collections::HashSet,
    path::{Component, Path, PathBuf},
};

use crate::git::error::{GitError, GitResult};

use super::GitEngine;

impl GitEngine {
    fn apply_diff(
        repo: &git2::Repository,
        diff: &git2::Diff<'_>,
        location: git2::ApplyLocation,
        check: bool,
    ) -> GitResult<()> {
        let mut opts = git2::ApplyOptions::new();
        opts.check(check);
        repo.apply(diff, location, Some(&mut opts))?;
        Ok(())
    }

    fn apply_workdir_diff(
        repo: &git2::Repository,
        diff: &git2::Diff<'_>,
        patch_text: &str,
        check: bool,
    ) -> GitResult<()> {
        match Self::apply_diff(repo, diff, git2::ApplyLocation::WorkDir, check) {
            Ok(()) => Ok(()),
            Err(_) => Self::apply_workdir_patch_text(repo, patch_text, check),
        }
    }

    fn apply_workdir_patch_text(
        repo: &git2::Repository,
        patch_text: &str,
        check: bool,
    ) -> GitResult<()> {
        let patches = parse_workdir_patches(patch_text)?;
        let workdir = repo
            .workdir()
            .ok_or_else(|| GitError::OperationFailed("仓库没有工作目录".to_string()))?;

        for patch in patches {
            let path = safe_workdir_path(workdir, &patch.path)?;
            let content = std::fs::read_to_string(&path)
                .map_err(|e| GitError::OperationFailed(format!("读取工作区文件失败：{}", e)))?;
            let mut lines = split_lines_preserved(&content);

            for hunk in patch.hunks {
                let source_lines = hunk
                    .lines
                    .iter()
                    .filter(|line| line.origin != '+')
                    .map(|line| line.content.clone())
                    .collect::<Vec<_>>();
                let target_lines = hunk
                    .lines
                    .iter()
                    .filter(|line| line.origin != '-')
                    .map(|line| line.content.clone())
                    .collect::<Vec<_>>();
                let expected = hunk.source_start.saturating_sub(1).min(lines.len());
                let start =
                    find_line_sequence(&lines, &source_lines, expected).ok_or_else(|| {
                        GitError::OperationFailed(format!("{}: hunk did not apply", patch.path))
                    })?;
                lines.splice(start..start + source_lines.len(), target_lines);
            }

            if !check {
                std::fs::write(&path, lines.concat())
                    .map_err(|e| GitError::OperationFailed(format!("写入工作区文件失败：{}", e)))?;
            }
        }

        Ok(())
    }

    // ── Amend ──────────────────────────────────────────────────────────

    /// 保留原 signature 的 name / email / timezone offset，只替换 Unix 秒数。
    /// 返回 `'static` lifetime 的 Signature（无借用 repo 生命期）。
    pub(crate) fn sig_with_time(
        orig: &git2::Signature<'_>,
        unix_secs: i64,
    ) -> GitResult<git2::Signature<'static>> {
        let t = git2::Time::new(unix_secs, orig.when().offset_minutes());
        Ok(git2::Signature::new(
            orig.name().unwrap_or(""),
            orig.email().unwrap_or(""),
            &t,
        )?)
    }

    /// 同 `sig_with_time`，但可额外覆盖 name / email。
    /// `name_override` / `email_override` 为 None 时保留 orig 中的原值。
    pub(crate) fn sig_with_overrides(
        orig: &git2::Signature<'_>,
        unix_secs: i64,
        name_override: Option<&str>,
        email_override: Option<&str>,
    ) -> GitResult<git2::Signature<'static>> {
        let t = git2::Time::new(unix_secs, orig.when().offset_minutes());
        Ok(git2::Signature::new(
            name_override.unwrap_or_else(|| orig.name().unwrap_or("")),
            email_override.unwrap_or_else(|| orig.email().unwrap_or("")),
            &t,
        )?)
    }

    /// 在当前 HEAD 上 amend 一次提交：用 index 里的 tree + 新 message 替换
    /// HEAD commit。返回新 commit OID。
    pub fn amend_commit(path: &str, message: &str) -> GitResult<String> {
        let repo = Self::open(path)?;
        if message.trim().is_empty() {
            return Err(GitError::OperationFailed("提交信息不能为空".to_string()));
        }
        let head = repo.head()?.peel_to_commit()?;
        let committer = repo.signature()?;
        let mut index = repo.index()?;
        index.write()?;
        let tree_oid = index.write_tree()?;
        let tree = repo.find_tree(tree_oid)?;
        // 保留原 author date，仅更新 committer 为当前时间
        let orig_author = head.author();
        let author = Self::sig_with_time(&orig_author, orig_author.when().seconds())?;
        let new_oid = head.amend(
            Some("HEAD"),
            Some(&author),
            Some(&committer),
            None,
            Some(message),
            Some(&tree),
        )?;
        Ok(new_oid.to_string())
    }

    /// 仅修改 HEAD commit 的 message（以及可选的时间戳 / author 信息），不改变 tree。
    /// - `author_time`：None = 保留原 author date；Some(t) = 覆盖为指定 Unix 秒
    /// - `committer_time`：None = 当前时间；Some(t) = 覆盖为指定 Unix 秒
    /// - `author_name` / `author_email`：None = 保留原值；Some(s) = 覆盖
    /// 返回新 commit OID。
    pub fn amend_commit_message(
        path: &str,
        message: &str,
        author_time: Option<i64>,
        committer_time: Option<i64>,
        author_name: Option<&str>,
        author_email: Option<&str>,
    ) -> GitResult<String> {
        let repo = Self::open(path)?;
        if message.trim().is_empty() {
            return Err(GitError::OperationFailed("提交信息不能为空".to_string()));
        }
        let head = repo.head()?.peel_to_commit()?;
        // committer：有指定时间则覆盖，否则用当前时间（repo.signature()）
        let committer_base = repo.signature()?;
        let committer = match committer_time {
            Some(t) => Self::sig_with_time(&committer_base, t)?,
            None => committer_base,
        };
        // author：name/email/time 任一有覆盖则用 sig_with_overrides；否则保留原值
        let orig_author = head.author();
        let author = Self::sig_with_overrides(
            &orig_author,
            author_time.unwrap_or_else(|| orig_author.when().seconds()),
            author_name,
            author_email,
        )?;
        let tree = head.tree()?;
        let new_oid = head.amend(
            Some("HEAD"),
            Some(&author),
            Some(&committer),
            None,
            Some(message),
            Some(&tree),
        )?;
        Ok(new_oid.to_string())
    }

    // ── Discard ────────────────────────────────────────────────────────

    /// 丢弃所有工作区变更 + untracked 文件。保持 HEAD 不动，且不处理 ignored 文件。
    /// 当前工作区原件会先移入系统废纸篓；失败时不会降级为永久删除。
    pub fn discard_all_changes(path: &str) -> GitResult<()> {
        Self::discard_all_changes_with(path, move_to_system_trash)
    }

    pub(crate) fn discard_all_changes_with<F>(path: &str, mut move_to_trash: F) -> GitResult<()>
    where
        F: FnMut(&Path) -> GitResult<()>,
    {
        let repo = Self::open(path)?;
        let head_oid = match repo.head() {
            Ok(reference) => Some(reference.peel_to_commit()?.id()),
            Err(error)
                if matches!(
                    error.code(),
                    git2::ErrorCode::UnbornBranch | git2::ErrorCode::NotFound
                ) =>
            {
                None
            }
            Err(error) => return Err(error.into()),
        };
        let mut opts = git2::StatusOptions::new();
        opts.include_untracked(true)
            .recurse_untracked_dirs(true)
            .include_ignored(false);
        let file_paths = repo
            .statuses(Some(&mut opts))?
            .iter()
            .filter_map(|entry| entry.path().map(ToOwned::to_owned))
            .collect::<Vec<_>>();
        let mut index = repo.index()?;
        move_worktree_originals(&repo, &index, &file_paths, &mut move_to_trash)?;

        if let Some(head_oid) = head_oid {
            let head = repo.find_object(head_oid, Some(git2::ObjectType::Commit))?;
            let mut cb = git2::build::CheckoutBuilder::new();
            cb.force();
            repo.reset(&head, git2::ResetType::Hard, Some(&mut cb))?;
        } else {
            index.clear()?;
            index.write()?;
        }
        Ok(())
    }

    /// 丢弃单个文件的未暂存变更（恢复工作区到 index）
    /// 当前工作区原件会先移入系统废纸篓。
    pub fn discard_file(path: &str, file_path: &str) -> GitResult<()> {
        Self::discard_files(path, &[file_path.to_string()])
    }

    /// 批量丢弃文件的未暂存变更，只打开一次仓库并执行一次 checkout。
    pub fn discard_files(path: &str, file_paths: &[String]) -> GitResult<()> {
        Self::discard_files_with(path, file_paths, move_to_system_trash)
    }

    pub(crate) fn discard_files_with<F>(
        path: &str,
        file_paths: &[String],
        mut move_to_trash: F,
    ) -> GitResult<()>
    where
        F: FnMut(&Path) -> GitResult<()>,
    {
        let repo = Self::open(path)?;
        let mut index = repo.index()?;
        let tracked_paths = move_worktree_originals(&repo, &index, file_paths, &mut move_to_trash)?;
        if tracked_paths.is_empty() {
            return Ok(());
        }

        let mut cb = git2::build::CheckoutBuilder::new();
        cb.force();
        for file_path in tracked_paths {
            cb.path(file_path);
        }
        repo.checkout_index(Some(&mut index), Some(&mut cb))?;
        Ok(())
    }

    /// 还原一个 patch 到工作区（用于回滚 hunk）
    pub fn apply_patch(path: &str, patch_text: &str) -> GitResult<()> {
        let repo = Self::open(path)?;
        let diff = git2::Diff::from_buffer(patch_text.as_bytes())?;
        let mut opts = git2::ApplyOptions::new();
        repo.apply(&diff, git2::ApplyLocation::WorkDir, Some(&mut opts))?;
        Ok(())
    }

    /// 将 patch 应用到 index（用于暂存 / 取消暂存 hunk）
    pub fn apply_patch_to_index(path: &str, patch_text: &str) -> GitResult<()> {
        let repo = Self::open(path)?;
        let diff = git2::Diff::from_buffer(patch_text.as_bytes())?;
        let mut opts = git2::ApplyOptions::new();
        repo.apply(&diff, git2::ApplyLocation::Index, Some(&mut opts))?;
        Ok(())
    }

    /// 将 patch 同时应用到工作区和 index（用于放弃已暂存 hunk）
    pub fn apply_patch_to_workdir_and_index(path: &str, patch_text: &str) -> GitResult<()> {
        let repo = Self::open(path)?;
        let diff = git2::Diff::from_buffer(patch_text.as_bytes())?;
        Self::apply_diff(&repo, &diff, git2::ApplyLocation::Index, true)?;
        Self::apply_workdir_diff(&repo, &diff, patch_text, true)?;
        Self::apply_diff(&repo, &diff, git2::ApplyLocation::Index, false)?;
        Self::apply_workdir_diff(&repo, &diff, patch_text, false)?;
        Ok(())
    }
}

fn move_to_system_trash(path: &Path) -> GitResult<()> {
    trash::delete(path).map_err(|error| {
        GitError::OperationFailed(format!(
            "无法将 {} 移入系统废纸篓：{}",
            path.display(),
            error
        ))
    })
}

fn move_worktree_originals<F>(
    repo: &git2::Repository,
    index: &git2::Index,
    file_paths: &[String],
    move_to_trash: &mut F,
) -> GitResult<Vec<String>>
where
    F: FnMut(&Path) -> GitResult<()>,
{
    let workdir = repo
        .workdir()
        .ok_or_else(|| GitError::OperationFailed("仓库没有工作目录".to_string()))?;
    let mut seen = HashSet::new();
    let mut tracked_paths = Vec::new();

    for file_path in file_paths {
        if !seen.insert(file_path.clone()) {
            continue;
        }
        let target = safe_workdir_path(workdir, file_path)?;
        let index_entry = index.get_path(Path::new(file_path), 0);
        let is_gitlink = index_entry
            .as_ref()
            .is_some_and(|entry| entry.mode == u32::from(git2::FileMode::Commit));

        if path_present(&target) && !is_gitlink {
            move_to_trash(&target)?;
        }
        if index_entry.is_some() {
            tracked_paths.push(file_path.clone());
        }
    }

    Ok(tracked_paths)
}

fn path_present(path: &Path) -> bool {
    std::fs::symlink_metadata(path).is_ok()
}

struct ParsedPatch {
    path: String,
    hunks: Vec<ParsedHunk>,
}

struct ParsedHunk {
    source_start: usize,
    lines: Vec<ParsedPatchLine>,
}

struct ParsedPatchLine {
    origin: char,
    content: String,
}

fn parse_workdir_patches(patch_text: &str) -> GitResult<Vec<ParsedPatch>> {
    let mut patches = Vec::new();
    let mut current_patch: Option<ParsedPatch> = None;
    let mut current_hunk: Option<ParsedHunk> = None;
    let mut old_path: Option<String> = None;

    let finish_hunk =
        |patch: &mut Option<ParsedPatch>, hunk: &mut Option<ParsedHunk>| -> GitResult<()> {
            if let Some(hunk) = hunk.take() {
                let patch = patch.as_mut().ok_or_else(|| {
                    GitError::OperationFailed("patch hunk missing file header".to_string())
                })?;
                patch.hunks.push(hunk);
            }
            Ok(())
        };

    for raw_line in patch_text.split_inclusive('\n') {
        if let Some(hunk) = current_hunk.as_mut() {
            if let Some(origin) = raw_line.chars().next() {
                if matches!(origin, ' ' | '+' | '-') {
                    hunk.lines.push(ParsedPatchLine {
                        origin,
                        content: raw_line[origin.len_utf8()..].to_string(),
                    });
                    continue;
                }
            }
        }

        let line = raw_line.trim_end_matches(['\r', '\n']);
        if line.starts_with("diff --git ") {
            finish_hunk(&mut current_patch, &mut current_hunk)?;
            if let Some(patch) = current_patch.take() {
                patches.push(patch);
            }
            current_patch = Some(ParsedPatch {
                path: String::new(),
                hunks: Vec::new(),
            });
            old_path = None;
        } else if let Some(path) = line.strip_prefix("--- ") {
            old_path = parse_patch_path(path);
        } else if let Some(path) = line.strip_prefix("+++ ") {
            if let Some(patch) = current_patch.as_mut() {
                patch.path = parse_patch_path(path)
                    .or_else(|| old_path.clone())
                    .ok_or_else(|| {
                        GitError::OperationFailed("patch file path missing".to_string())
                    })?;
            }
        } else if line.starts_with("@@ ") {
            finish_hunk(&mut current_patch, &mut current_hunk)?;
            current_hunk = Some(ParsedHunk {
                source_start: parse_hunk_source_start(line)?,
                lines: Vec::new(),
            });
        }
    }

    finish_hunk(&mut current_patch, &mut current_hunk)?;
    if let Some(patch) = current_patch {
        patches.push(patch);
    }

    Ok(patches)
}

fn parse_patch_path(path: &str) -> Option<String> {
    let path = path.trim();
    if path == "/dev/null" {
        return None;
    }
    Some(
        path.strip_prefix("a/")
            .or_else(|| path.strip_prefix("b/"))
            .unwrap_or(path)
            .to_string(),
    )
}

fn parse_hunk_source_start(header: &str) -> GitResult<usize> {
    let source = header
        .strip_prefix("@@ -")
        .and_then(|rest| rest.split_once(' ').map(|(source, _)| source))
        .ok_or_else(|| GitError::OperationFailed("invalid patch hunk header".to_string()))?;
    let start = source
        .split_once(',')
        .map(|(start, _)| start)
        .unwrap_or(source);
    start
        .parse::<usize>()
        .map_err(|e| GitError::OperationFailed(format!("invalid patch hunk line: {}", e)))
}

fn safe_workdir_path(workdir: &Path, rel_path: &str) -> GitResult<PathBuf> {
    let rel = Path::new(rel_path);
    if rel.is_absolute()
        || rel
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(GitError::OperationFailed(
            "path escapes repository root".to_string(),
        ));
    }
    Ok(workdir.join(rel))
}

fn split_lines_preserved(content: &str) -> Vec<String> {
    content
        .split_inclusive('\n')
        .map(ToOwned::to_owned)
        .collect()
}

fn find_line_sequence(lines: &[String], needle: &[String], expected: usize) -> Option<usize> {
    if needle.is_empty() {
        return Some(expected.min(lines.len()));
    }
    if needle.len() > lines.len() {
        return None;
    }
    (0..=lines.len() - needle.len())
        .filter(|start| lines[*start..*start + needle.len()] == *needle)
        .min_by_key(|start| start.abs_diff(expected))
}
