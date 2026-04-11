# 08. 远程操作

Fetch / Push / Pull 是三个独立命令，统一走 git2 的 `RemoteCallbacks` + 自定义凭据回调链。

## 涉及模块

- 后端：`commands/remote.rs`、`GitEngine::fetch / push / pull / list_remotes`、`git/credentials.rs`
- 前端：
  - `components/layout/AppToolbar.vue`（Pull / Push / Fetch 按钮）
  - `stores/history.ts`（远程操作后刷新日志）

## 入口

顶部工具栏有三个按钮：

| 按钮 | 触发 | 后续 |
|------|------|------|
| Pull | `git.pullBranch(repoId, remote, branch)` | 成功后 `loadLog() + loadBranches()` |
| Push | `git.pushBranch(repoId, remote, branch)` | 成功后 `loadBranches()` |
| Actions → 抓取 | `git.fetchRemote(repoId, remote)` | 成功后 `loadBranches()` |

每个按钮都有独立 `busy` 标志（`busy.pull / busy.push / busy.fetch`），按钮文本会显示 `Pulling... / Pushing...`。失败时通过 `toastError` 在工具栏下方显示 4 秒自动消失的浮层。

## 远端选择

目前的策略简单粗暴（`pickRemote` in `AppToolbar.vue`）：

1. `git.listRemotes(repoId)` 取所有 remote
2. 若有 `origin` → 用 `origin`
3. 否则用第一个
4. 一个都没有 → 返回 null，提示 "当前仓库没有配置 remote"

没有交互式 "选择 remote" 弹窗。多 remote 场景需要 Pull 下拉菜单（README 里的 TODO）。

## Pull 实现

`GitEngine::pull(path, remote_name, branch_name)`：

```rust
1. remote.fetch(&[branch_name], opts)
2. 取 FETCH_HEAD → annotated_commit
3. merge_analysis(&[&fetch_commit])
4. is_fast_forward → 把 refs/heads/<branch> 指到 fetch_commit.id
    + set_head + checkout_head(force)
5. is_normal → Err("Merge required - not yet supported")
```

**只支持 fast-forward**。需要真正 merge 的情况直接报错，让用户去终端处理。这是目前的最大限制。

## Push 实现

简单的同分支 push：

```rust
let refspec = format!("refs/heads/{}:refs/heads/{}", branch, branch);
remote.push(&[&refspec], Some(&mut push_opts))?;
```

没有 `--force`、没有 `--set-upstream`，也没有推送 tags。上游未设置时首次 push 必须先手动 set upstream（或在终端 push）。

## 凭据回调链

`git/credentials.rs` 的 `credential_callback` 按以下顺序尝试：

```rust
pub fn credential_callback(url, username, allowed_types) -> Result<Cred, Error> {
    if allowed_types.contains(SSH_KEY) {
        1. Cred::ssh_key_from_agent(user)       // ssh-agent
        2. Cred::ssh_key(user, ~/.ssh/id_ed25519)
        3. Cred::ssh_key(user, ~/.ssh/id_rsa)
    }
    if allowed_types.contains(DEFAULT) {
        4. Cred::default()                        // git credential helper
    }
    Err("No credentials available")
}
```

`user` 默认 `"git"`，如果 URL 里带了用户名会用那个。

这意味着：

- **SSH 仓库**：需要启动 ssh-agent 或放默认路径的 key，无密码保护的 key 优先
- **HTTPS 仓库**：依赖 OS 的 git credential helper（macOS Keychain / Windows Credential Manager / Linux libsecret）
- **带密码保护的 key**：目前不支持交互输入——会直接失败

所有 fetch/push/pull 都复用同一个 `RemoteCallbacks::credentials(|url, user, allowed| credential_callback(...))`。

## 列出 remote

`list_remotes(path)` 返回 `Vec<String>`，内部就是 `repo.remotes()?.iter().flatten().collect()`。前端主要用来做 `pickRemote`。

## 未来改进

- 交互式凭据输入（密码 / SSH passphrase prompt）
- Merge / rebase pull（不止 fast-forward）
- `git push -u` 首次设置 upstream
- Remote 选择下拉菜单（Pull 按钮上挂 chevron）
- Force push with lease
- Tag 推送
