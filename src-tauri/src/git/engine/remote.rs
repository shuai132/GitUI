use git2::Repository;
use std::path::Path;

use crate::git::{
    credentials::make_credentials_callback,
    encoding::decode_ref_name,
    error::{GitError, GitResult},
    shellout::{get_remote_url, is_ssh_url, new_git_command, run_git},
    types::*,
};

use super::GitEngine;

impl GitEngine {
    pub fn fetch(path: &str, remote_name: &str) -> GitResult<()> {
        let url = get_remote_url(path, remote_name)?;
        if is_ssh_url(&url) {
            run_git(path, &["fetch", remote_name])?;
            return Ok(());
        }
        let repo = Self::open(path)?;
        let mut remote = repo.find_remote(remote_name)?;
        let mut callbacks = git2::RemoteCallbacks::new();
        callbacks.credentials(make_credentials_callback());
        let mut fetch_opts = git2::FetchOptions::new();
        fetch_opts.remote_callbacks(callbacks);
        remote.fetch(&[] as &[&str], Some(&mut fetch_opts), None)?;
        Ok(())
    }

    pub fn fetch_tags(path: &str, remote_name: &str) -> GitResult<()> {
        let url = get_remote_url(path, remote_name)?;
        if is_ssh_url(&url) {
            run_git(path, &["fetch", remote_name, "--tags"])?;
            return Ok(());
        }
        let repo = Self::open(path)?;
        let mut remote = repo.find_remote(remote_name)?;
        let mut callbacks = git2::RemoteCallbacks::new();
        callbacks.credentials(make_credentials_callback());
        let mut fetch_opts = git2::FetchOptions::new();
        fetch_opts.remote_callbacks(callbacks);
        fetch_opts.download_tags(git2::AutotagOption::All);
        remote.fetch(&[] as &[&str], Some(&mut fetch_opts), None)?;
        Ok(())
    }

    /// mode: "normal" | "force" | "force_with_lease"
    pub fn push(path: &str, remote_name: &str, branch_name: &str, mode: &str) -> GitResult<()> {
        log::debug!("[engine::push] mode={mode} remote={remote_name} branch={branch_name}");

        if mode == "force_with_lease" {
            run_git(
                path,
                &["push", "--force-with-lease", remote_name, branch_name],
            )?;
            Self::set_upstream_after_push(path, remote_name, branch_name)?;
            return Ok(());
        }

        let refspec = if mode == "force" {
            format!("+refs/heads/{branch_name}:refs/heads/{branch_name}")
        } else {
            format!("refs/heads/{branch_name}:refs/heads/{branch_name}")
        };

        let url = get_remote_url(path, remote_name)?;
        if is_ssh_url(&url) {
            run_git(path, &["push", remote_name, &refspec])?;
            Self::set_upstream_after_push(path, remote_name, branch_name)?;
            log::debug!("[engine::push] done (ssh cli)");
            return Ok(());
        }

        let repo = Self::open(path)?;
        let mut remote = repo.find_remote(remote_name)?;
        let mut callbacks = git2::RemoteCallbacks::new();
        callbacks.credentials(make_credentials_callback());
        let mut push_opts = git2::PushOptions::new();
        push_opts.remote_callbacks(callbacks);
        log::debug!("[engine::push] pushing refspec={refspec}");
        remote.push(&[&refspec], Some(&mut push_opts))?;
        drop(remote);
        Self::set_upstream_after_push(path, remote_name, branch_name)?;
        log::debug!("[engine::push] done");
        Ok(())
    }

    /// 首次成功 Push 同名远端分支后建立 tracking；已有 upstream 代表用户配置，绝不覆盖。
    pub(super) fn set_upstream_after_push(
        path: &str,
        remote_name: &str,
        branch_name: &str,
    ) -> GitResult<bool> {
        let repo = Self::open(path)?;
        let mut branch = repo.find_branch(branch_name, git2::BranchType::Local)?;
        if Self::configured_upstream(&repo, branch_name).is_some() {
            return Ok(false);
        }

        let upstream = format!("{remote_name}/{branch_name}");
        branch.set_upstream(Some(&upstream))?;
        log::debug!("[engine::push] upstream established: {branch_name} -> {upstream}");
        Ok(true)
    }

    /// 从 branch 配置读取 upstream，不要求对应 remote-tracking ref 仍存在。
    /// `Branch::upstream()` 在引用已 gone 时会失败，不能据此判断用户是否配置过 tracking。
    pub(super) fn configured_upstream(repo: &Repository, branch_name: &str) -> Option<String> {
        let config = repo.config().ok()?;
        let remote = config
            .get_string(&format!("branch.{branch_name}.remote"))
            .ok()?;
        let merge = config
            .get_string(&format!("branch.{branch_name}.merge"))
            .ok()?;
        let merge_name = merge.strip_prefix("refs/heads/").unwrap_or(&merge);
        Some(if remote == "." {
            merge_name.to_string()
        } else {
            format!("{remote}/{merge_name}")
        })
    }

    /// 推送一个本地 tag 到远端。refspec `refs/tags/<name>:refs/tags/<name>`。
    /// 不带 force：已存在同名远端 tag 时 git2 会返回 non-fast-forward 错误，
    /// 由前端错误映射（`errors.push.nonFastForward`）给出中文提示。
    pub fn push_tag(
        path: &str,
        remote_name: &str,
        tag_name: &str,
        force: bool,
        expected_local_oid: Option<&str>,
        expected_remote_oid: Option<&str>,
        verify_remote_target: bool,
    ) -> GitResult<()> {
        log::debug!("[engine::push_tag] remote={remote_name} tag={tag_name} force={force}");
        if let Some(expected) = expected_local_oid {
            let repo = Self::open(path)?;
            let reference = repo.find_reference(&format!("refs/tags/{tag_name}"))?;
            let current = reference.target().ok_or_else(|| {
                GitError::OperationFailed(format!(
                    "Tag target changed: refs/tags/{tag_name} is not a direct reference"
                ))
            })?;
            if current.to_string() != expected {
                return Err(GitError::OperationFailed(format!(
                    "Tag target changed: expected {expected}, current {current}"
                )));
            }
        }
        if verify_remote_target {
            let current = Self::list_remote_tags(path, remote_name)?
                .into_iter()
                .find(|tag| tag.name == tag_name)
                .map(|tag| tag.ref_oid);
            if current.as_deref() != expected_remote_oid {
                return Err(GitError::OperationFailed(format!(
                    "Remote tag target changed: expected {}, current {}",
                    expected_remote_oid.unwrap_or("missing"),
                    current.as_deref().unwrap_or("missing")
                )));
            }
        }
        let refspec = if force {
            format!("+refs/tags/{name}:refs/tags/{name}", name = tag_name)
        } else {
            format!("refs/tags/{name}:refs/tags/{name}", name = tag_name)
        };

        let url = get_remote_url(path, remote_name)?;
        if is_ssh_url(&url) {
            run_git(path, &["push", remote_name, &refspec])?;
            return Ok(());
        }

        let repo = Self::open(path)?;
        let mut remote = repo.find_remote(remote_name)?;
        let mut callbacks = git2::RemoteCallbacks::new();
        callbacks.credentials(make_credentials_callback());
        let mut push_opts = git2::PushOptions::new();
        push_opts.remote_callbacks(callbacks);
        remote.push(&[&refspec], Some(&mut push_opts))?;
        Ok(())
    }

    /// 删除远程 tag。使用系统 git 以简化 auth 和 ssh 处理。
    pub fn delete_remote_tag(path: &str, remote_name: &str, tag_name: &str) -> GitResult<()> {
        log::debug!("[engine::delete_remote_tag] remote={remote_name} tag={tag_name}");
        run_git(path, &["push", remote_name, "--delete", tag_name])?;
        Ok(())
    }

    /// 删除远程分支。使用系统 git。
    pub fn delete_remote_branch(path: &str, remote_name: &str, branch_name: &str) -> GitResult<()> {
        log::debug!("[engine::delete_remote_branch] remote={remote_name} branch={branch_name}");
        run_git(path, &["push", remote_name, "--delete", branch_name])?;
        Ok(())
    }

    pub fn pull(path: &str, remote_name: &str, branch_name: &str, mode: &str) -> GitResult<()> {
        log::debug!("[engine::pull] mode={mode} remote={remote_name} branch={branch_name}");

        // Pull 的所有路径都可能更新引用并 checkout。统一在 fetch 前拒绝脏工作区，
        // 避免 fast-forward 的 force checkout 覆盖本地修改，也避免无意义的网络请求。
        let repo = Self::open(path)?;
        Self::ensure_pull_ready(&repo)?;
        drop(repo);

        let url = get_remote_url(path, remote_name)?;
        if is_ssh_url(&url) {
            log::debug!("[engine::pull] ssh fetch via system git");
            run_git(path, &["fetch", remote_name, branch_name])?;
        } else {
            let repo_fetch = Self::open(path)?;
            let mut remote = repo_fetch.find_remote(remote_name)?;
            let mut callbacks = git2::RemoteCallbacks::new();
            callbacks.credentials(make_credentials_callback());
            let mut fetch_opts = git2::FetchOptions::new();
            fetch_opts.remote_callbacks(callbacks);
            log::debug!("[engine::pull] fetching via libgit2...");
            remote.fetch(&[branch_name], Some(&mut fetch_opts), None)?;
        }

        let repo = Self::open(path)?;
        log::debug!("[engine::pull] fetch done, proceeding with mode={mode}");

        if mode == "rebase" {
            return Self::pull_rebase(&repo, branch_name);
        }

        // ff / ff_only: merge analysis
        let fetch_head = repo.find_reference("FETCH_HEAD")?;
        let fetch_commit = repo.reference_to_annotated_commit(&fetch_head)?;
        let (merge_analysis, _) = repo.merge_analysis(&[&fetch_commit])?;

        if merge_analysis.is_up_to_date() {
            return Ok(());
        }

        if merge_analysis.is_fast_forward() {
            let refname = format!("refs/heads/{}", branch_name);
            let mut reference = repo.find_reference(&refname)?;
            reference.set_target(fetch_commit.id(), "Fast-forward")?;
            repo.set_head(&refname)?;
            repo.checkout_head(Some(git2::build::CheckoutBuilder::default().force()))?;
        } else if mode == "ff_only" {
            return Err(GitError::OperationFailed(
                "Cannot fast-forward: remote branch has diverged".to_string(),
            ));
        } else {
            // mode == "ff": 允许 merge commit（非快进时创建合并提交）
            return Self::pull_merge(&repo, branch_name, &fetch_commit);
        }

        Ok(())
    }

    pub(super) fn ensure_pull_ready(repo: &Repository) -> GitResult<()> {
        if repo.state() != git2::RepositoryState::Clean {
            return Err(GitError::OperationFailed(
                "Cannot pull: repository has an unfinished Git operation. Resolve or abort it first."
                    .to_string(),
            ));
        }

        let statuses = repo.statuses(Some(
            git2::StatusOptions::new()
                .include_untracked(true)
                .recurse_untracked_dirs(true)
                .include_ignored(false),
        ))?;
        if statuses.is_empty() {
            return Ok(());
        }

        Err(GitError::OperationFailed(
            "Cannot pull: working tree has uncommitted changes. Commit or stash first.".to_string(),
        ))
    }

    /// Pull with rebase: fetch has already been done, now rebase HEAD onto FETCH_HEAD.
    fn pull_rebase(repo: &git2::Repository, branch_name: &str) -> GitResult<()> {
        let fetch_head = repo.find_reference("FETCH_HEAD")?;
        let fetch_commit = repo.reference_to_annotated_commit(&fetch_head)?;

        let head_ref = repo.head()?;
        let head_commit = repo.reference_to_annotated_commit(&head_ref)?;

        // Check if already up-to-date
        let (merge_analysis, _) = repo.merge_analysis(&[&fetch_commit])?;
        if merge_analysis.is_up_to_date() {
            return Ok(());
        }

        // If fast-forwardable, just do ff (no rebase needed)
        if merge_analysis.is_fast_forward() {
            let refname = format!("refs/heads/{}", branch_name);
            let mut reference = repo.find_reference(&refname)?;
            reference.set_target(fetch_commit.id(), "Fast-forward")?;
            repo.set_head(&refname)?;
            repo.checkout_head(Some(git2::build::CheckoutBuilder::default().force()))?;
            return Ok(());
        }

        // Perform rebase
        let mut rebase = repo.rebase(Some(&head_commit), Some(&fetch_commit), None, None)?;

        let sig = repo.signature()?;

        while let Some(op) = rebase.next() {
            let _op = op?;
            let index = repo.index()?;
            if index.has_conflicts() {
                rebase.abort()?;
                return Err(GitError::OperationFailed(
                    "Rebase conflict: please resolve conflicts manually in the terminal"
                        .to_string(),
                ));
            }
            rebase.commit(None, &sig, None)?;
        }

        rebase.finish(None)?;

        Ok(())
    }

    /// Pull 的 merge 路径：远端分叉时创建 merge commit（`mode == "ff"`）。
    ///
    /// 流程：
    /// 1. `repo.merge()` 执行三方合并并写入 index
    /// 2. 若 index 有冲突 → 保留 MERGE_HEAD 供用户手动解决，返回 conflict 错误
    /// 3. 无冲突 → 从 index 生成 tree → 创建 merge commit（两个 parent）→ 更新 HEAD
    fn pull_merge(
        repo: &git2::Repository,
        branch_name: &str,
        fetch_commit: &git2::AnnotatedCommit<'_>,
    ) -> GitResult<()> {
        // 1. 执行三方合并（工作区已由 pull 入口统一检查）
        let mut merge_opts = git2::MergeOptions::new();
        merge_opts.fail_on_conflict(false);
        repo.merge(
            &[fetch_commit],
            Some(&mut merge_opts),
            Some(git2::build::CheckoutBuilder::default().allow_conflicts(true)),
        )?;

        // 2. 冲突检查
        let mut index = repo.index()?;
        if index.has_conflicts() {
            // 保留 MERGE_HEAD（用户需要在工作区手动解决冲突）
            return Err(GitError::OperationFailed(
                "Merge 出现冲突，请在工作区解决后继续".to_string(),
            ));
        }

        // 3. 生成 merge commit
        let sig = repo.signature()?;
        let tree_oid = index.write_tree_to(repo)?;
        let tree = repo.find_tree(tree_oid)?;

        let head_commit = repo.head()?.peel_to_commit()?;
        let fetch_commit_obj = repo.find_commit(fetch_commit.id())?;

        let message = format!("Merge remote-tracking branch 'origin/{}'", branch_name);

        repo.commit(
            Some("HEAD"),
            &sig,
            &sig,
            &message,
            &tree,
            &[&head_commit, &fetch_commit_obj],
        )?;

        // 4. 清理合并状态（删除 MERGE_HEAD / MERGE_MSG 等）
        repo.cleanup_state()?;

        // 5. 确保工作目录与 HEAD 一致
        repo.checkout_head(Some(git2::build::CheckoutBuilder::default().force()))?;

        log::debug!("[engine::pull_merge] merge commit created for branch={branch_name}");
        Ok(())
    }

    // ── Clone / Init ────────────────────────────────────────────────────
    ///
    /// - 凭据回调复用 `make_credentials_callback`（SSH agent / ed25519 / rsa / git helper）
    /// - `depth` 传 `Some(n>0)` 走浅克隆（libgit2 0.19+ 支持）
    /// - `recurse_submodules=true` 则在主仓库克隆完成后遍历 submodule 逐个 init+update
    /// - `on_progress(stage, percent, sideband_msg)`：
    ///     - stage = "receiving" / "indexing" / "checkout" / "sideband"
    ///     - "sideband" 的 percent 恒为 0，message 是服务器端原始文本
    ///
    /// 注意 transfer_progress 在大仓库里一秒会调几百次，节流应由调用方做（见
    /// `commands/repo.rs::clone_repo`），这里不节流以保持通用性。
    pub fn clone_repo(
        url: &str,
        target_path: &str,
        depth: Option<i32>,
        recurse_submodules: bool,
        on_progress: impl Fn(&str, u32, Option<String>) + Send + Sync + 'static,
    ) -> GitResult<String> {
        use std::sync::Arc;

        if is_ssh_url(url) {
            return Self::clone_repo_ssh(url, target_path, depth, recurse_submodules, on_progress);
        }

        let on_progress: Arc<dyn Fn(&str, u32, Option<String>) + Send + Sync> =
            Arc::new(on_progress);

        let mut callbacks = git2::RemoteCallbacks::new();
        callbacks.credentials(make_credentials_callback());

        {
            let op = on_progress.clone();
            callbacks.transfer_progress(move |stats: git2::Progress<'_>| -> bool {
                let total = stats.total_objects();
                if total == 0 {
                    return true;
                }
                let received = stats.received_objects();
                if received < total {
                    let pct = ((received as u64) * 100 / (total as u64).max(1)) as u32;
                    op("receiving", pct, None);
                } else {
                    let indexed = stats.indexed_objects();
                    let pct = ((indexed as u64) * 100 / (total as u64).max(1)) as u32;
                    op("indexing", pct, None);
                }
                true
            });
        }

        {
            let op = on_progress.clone();
            callbacks.sideband_progress(move |data: &[u8]| -> bool {
                if let Ok(msg) = std::str::from_utf8(data) {
                    let trimmed = msg.trim();
                    if !trimmed.is_empty() {
                        op("sideband", 0, Some(trimmed.to_string()));
                    }
                }
                true
            });
        }

        let mut fetch_opts = git2::FetchOptions::new();
        fetch_opts.remote_callbacks(callbacks);
        if let Some(d) = depth {
            if d > 0 {
                fetch_opts.depth(d);
            }
        }

        let mut checkout = git2::build::CheckoutBuilder::new();
        {
            let op = on_progress.clone();
            checkout.progress(move |_path, completed, total| {
                if total == 0 {
                    return;
                }
                let pct = ((completed as u64) * 100 / (total as u64).max(1)) as u32;
                op("checkout", pct, None);
            });
        }

        let mut builder = git2::build::RepoBuilder::new();
        builder.fetch_options(fetch_opts);
        builder.with_checkout(checkout);

        let target = Path::new(target_path);
        let repo = builder.clone(url, target)?;

        let workdir = repo
            .workdir()
            .ok_or_else(|| GitError::OperationFailed("cloned repo has no workdir".to_string()))?
            .to_path_buf();

        if recurse_submodules {
            // 先收集 name 列表，避免持有 submodule iterator 再调 Self::... 时的借用冲突
            let names: Vec<String> = repo
                .submodules()?
                .iter()
                .map(|s| decode_ref_name(s.name_bytes()))
                .filter(|n| !n.is_empty())
                .collect();
            drop(repo);
            for name in names {
                Self::init_submodule(target_path, &name)?;
                Self::update_submodule(target_path, &name)?;
            }
        }

        Ok(workdir.to_string_lossy().to_string())
    }

    /// SSH URL 时走系统 `git clone`，stderr 流式解析驱动 `on_progress`。
    ///
    /// git clone 的 stderr 用 `\r` 刷新进度（`Receiving objects: 50% ...\r`），
    /// 用 `\n` 表示换行，所以逐字节读取、遇 `\r` 或 `\n` 冲缓冲一次。
    fn clone_repo_ssh(
        url: &str,
        target_path: &str,
        depth: Option<i32>,
        recurse_submodules: bool,
        on_progress: impl Fn(&str, u32, Option<String>),
    ) -> GitResult<String> {
        use std::io::Read;
        use std::process::Stdio;

        let depth_str;
        let mut args: Vec<&str> = vec!["clone", "--progress"];
        if let Some(d) = depth {
            if d > 0 {
                depth_str = d.to_string();
                args.push("--depth");
                args.push(&depth_str);
            }
        }
        if recurse_submodules {
            args.push("--recurse-submodules");
        }
        args.push("--");
        args.push(url);
        args.push(target_path);

        let mut child_cmd = new_git_command(None);
        child_cmd
            .args(&args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped());
        let mut child = child_cmd.spawn().map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                GitError::OperationFailed(
                    "git binary not found in PATH. SSH remotes require a system git install."
                        .to_string(),
                )
            } else {
                GitError::OperationFailed(format!("failed to spawn git clone: {e}"))
            }
        })?;

        let mut stderr = child.stderr.take().expect("stderr piped");
        let mut buf: Vec<u8> = Vec::with_capacity(256);
        let mut all_stderr: Vec<u8> = Vec::with_capacity(4096);
        let mut byte = [0u8; 1];

        loop {
            match stderr.read(&mut byte) {
                Ok(0) => break,
                Ok(_) => {
                    let c = byte[0];
                    all_stderr.push(c);
                    if c == b'\r' || c == b'\n' {
                        if !buf.is_empty() {
                            let line = String::from_utf8_lossy(&buf);
                            Self::parse_clone_progress(&line, &on_progress);
                            buf.clear();
                        }
                    } else {
                        buf.push(c);
                    }
                }
                Err(_) => break,
            }
        }
        if !buf.is_empty() {
            let line = String::from_utf8_lossy(&buf);
            Self::parse_clone_progress(&line, &on_progress);
        }

        let status = child
            .wait()
            .map_err(|e| GitError::OperationFailed(format!("waiting for git clone failed: {e}")))?;

        if !status.success() {
            let err_text = String::from_utf8_lossy(&all_stderr).trim().to_string();
            let msg = if err_text.is_empty() {
                format!("git clone failed (exit code {:?})", status.code())
            } else {
                err_text
            };
            return Err(GitError::OperationFailed(msg));
        }

        // 小/空仓库 git 可能不输出 "Updating files"，前端进度条需要一个收尾 100%
        on_progress("checkout", 100, None);

        // target_path 可能是相对路径，返回实际 workdir 让前端打开准确位置
        let target = Path::new(target_path);
        let abs = target
            .canonicalize()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| target_path.to_string());
        Ok(abs)
    }

    fn parse_clone_progress(line: &str, on_progress: &impl Fn(&str, u32, Option<String>)) {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            return;
        }
        if let Some(rest) = trimmed.strip_prefix("remote: ") {
            on_progress("sideband", 0, Some(rest.to_string()));
            return;
        }
        let (stage, rest) = if let Some(r) = trimmed.strip_prefix("Receiving objects:") {
            ("receiving", r)
        } else if let Some(r) = trimmed.strip_prefix("Resolving deltas:") {
            ("indexing", r)
        } else if let Some(r) = trimmed.strip_prefix("Updating files:") {
            ("checkout", r)
        } else {
            return;
        };
        if let Some(pct_end) = rest.find('%') {
            let digits_start = rest[..pct_end]
                .rfind(|c: char| !c.is_ascii_digit())
                .map(|i| i + 1)
                .unwrap_or(0);
            if let Ok(pct) = rest[digits_start..pct_end].trim().parse::<u32>() {
                on_progress(stage, pct, None);
            }
        }
    }

    /// 在 `path` 上执行 `git init`（非 bare）。
    ///
    /// - 若路径不存在则先 `create_dir_all`
    /// - 若已经是 git 仓库则报错（避免静默覆盖用户现有仓库）
    /// - 不暴露 bare 选项：`open_repo` 当前不支持 bare，保持一致
    pub fn init_repo(path: &str) -> GitResult<()> {
        let p = Path::new(path);
        if p.exists() {
            if Repository::open(p).is_ok() {
                return Err(GitError::OperationFailed(
                    "already a git repository".to_string(),
                ));
            }
        } else {
            std::fs::create_dir_all(p)?;
        }
        Repository::init(p)?;
        Ok(())
    }

    pub fn list_remotes(path: &str) -> GitResult<Vec<RemoteInfo>> {
        let repo = Self::open(path)?;
        let remotes_list = repo.remotes()?;
        let mut result = Vec::new();
        for name_bytes in remotes_list.iter_bytes() {
            let name = decode_ref_name(name_bytes);
            if name.is_empty() {
                continue;
            }
            let url = repo
                .find_remote(&name)
                .ok()
                .and_then(|r| r.url().map(|s| s.to_string()));
            result.push(RemoteInfo { name, url });
        }
        Ok(result)
    }

    /// 添加一个新的 remote（等价于 `git remote add <name> <url>`）。
    /// 若 name 已存在则返回 OperationFailed。
    pub fn add_remote(path: &str, name: &str, url: &str) -> GitResult<()> {
        let repo = Self::open(path)?;
        repo.remote(name, url)?;
        Ok(())
    }

    /// 删除一个 remote，同时移除所有 remote-tracking refs（等价于 `git remote remove <name>`）。
    pub fn remove_remote(path: &str, name: &str) -> GitResult<()> {
        let repo = Self::open(path)?;
        repo.remote_delete(name)?;
        Ok(())
    }

    /// 修改 remote 的名称和/或 URL。
    pub fn edit_remote(path: &str, old_name: &str, new_name: &str, new_url: &str) -> GitResult<()> {
        let repo = Self::open(path)?;
        if old_name != new_name {
            repo.remote_rename(old_name, new_name)?;
        }
        repo.remote_set_url(new_name, new_url)?;
        Ok(())
    }
}
