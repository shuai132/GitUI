# 10. Stash / Reflog / GC

三个围绕"临时状态管理 + 仓库维护"的小功能，放在一起。

## Stash

### 涉及模块

- 后端：`commands/stash.rs`、`GitEngine::stash_push / stash_pop / stash_list`
- 前端：
  - `stores/stash.ts`
  - `components/layout/AppToolbar.vue`（Stash / Pop 按钮）
  - `components/layout/AppSidebar.vue`（STASH section）
- 可选显示在历史图里：`uiStore.showStashCommits`

### 数据结构

```rust
pub struct StashEntry {
    pub index: usize,
    pub message: String,
    pub commit_oid: String,
}
```

### 后端

```rust
pub fn stash_push(path, message: Option<&str>) -> GitResult<()> {
    let mut repo = Self::open(path)?;
    let sig = repo.signature()?;
    let flags = StashFlags::INCLUDE_UNTRACKED;  // 连同 untracked 一起 stash
    repo.stash_save2(&sig, message, Some(flags))?;
    Ok(())
}

pub fn stash_pop(path) -> GitResult<()> {
    // 先 stash_foreach 判断是否有条目，避免 git2 的错误信息太原始
    repo.stash_pop(0, None)?;  // 只 pop 最新那条
}

pub fn stash_list(path) -> GitResult<Vec<StashEntry>> {
    // stash_foreach 遍历
}
```

**特性**：

- `INCLUDE_UNTRACKED` 默认打开，新文件也会被 stash
- `stash_pop` 只对最新的（`index 0`）生效，UI 不暴露按索引 pop（会错乱 hash）
- 没有 drop / apply / branch 等操作

### UI

**工具栏**：

- `Stash` 按钮：不带 message（使用时间戳 / 默认 message），只要仓库存在就可用
- `Pop` 按钮：有至少一条 stash 才启用

**侧边栏 STASH section**：

- 总数显示在 section title 上
- 每条显示 `{index}` + message
- 点击 stash 行 → `historyStore.selectCommit(stash.commit_oid)` 把该 stash commit 当普通 commit 展开到详情面板
- 右键菜单：
  - `Pop stash@{n}（最新）` —— 只对 `index === 0` 启用
  - 复制 commit hash

### 历史图里的 stash

`uiStore.showStashCommits`（默认 **开**）控制是否把 stash 推入 `get_log` 的 revwalk。当开启时：

- stash 的根 commit 会出现在提交图里
- 标记为 `is_stash = true`，message 用斜体 + 次要色
- 选中后显示详情和 diff，支持查看 stash 的内容

## Reflog

### 涉及模块

- 后端：`commands/system.rs::get_reflog`、`GitEngine::get_reflog`
- 前端：
  - `components/common/ReflogDialog.vue`
  - `components/layout/AppToolbar.vue` 的 Actions 菜单 → "显示 Reflog..."
- 数据结构：`ReflogEntry { oid, short_oid, message, committer_name, time }`

### 后端

```rust
pub fn get_reflog(path, limit) -> GitResult<Vec<ReflogEntry>> {
    let reflog = repo.reflog("HEAD")?;
    let count = reflog.len().min(limit);
    // 按 i 顺序（最新在前）逐条取出
}
```

调用点：`get_reflog(repo_id)` 固定 `limit = 500`（后端 command 里写死）。

### 作用

- 展示 HEAD 最近的操作记录：commit、reset、checkout、merge、pull 等
- 每条带动作描述（"commit: fix bug" / "reset: moving to HEAD~1"）和 committer + 时间
- 点击条目可以复制 oid 或跳转到该提交（具体交互参考 `ReflogDialog.vue`）

### 与 "显示丢失引用" 的关系

`uiStore.showUnreachableCommits` 开启时，`get_log` 会额外把 HEAD reflog 里那些既不在任何 ref 也不在 stash 集合里的 oid 推进 revwalk 展示。Reflog 对话框是纯查看工具，不改变历史图；丢失引用开关则是把 reflog 里的"孤儿 commit"画到图上。两者互补。

## git gc

### 入口

Actions 菜单 → "清理仓库 (git gc)"，按钮变成 `清理中...`。成功/失败通过工具栏 toast 提示。

### 实现

GitUI 不用 git2 做 gc（libgit2 的 gc 支持有限），而是直接 **fork 系统的 git CLI**：

```rust
pub fn run_gc(path: &str) -> GitResult<String> {
    let output = Command::new("git")
        .args(["-C", path, "gc", "--quiet"])
        .output()?;
    if output.status.success() {
        Ok("git gc 完成".to_string())
    } else {
        Err(...)
    }
}
```

这是整个后端唯一一个 fork 外部 git 的地方。原因：

- 真实 gc 需要跑 pack / prune / repack，libgit2 不是为此优化
- gc 属于"偶尔手动触发"的维护操作，依赖系统 git 是合理代价
- 输出直接返回给前端当成功消息展示

### 副作用注意

`git gc` 可能会清理 unreachable objects（包括 stash 和 reflog 的一部分）。若用户开了"显示丢失引用"正在依赖这些 commit，gc 后它们会从 reflog 里消失。**目前没有专门的警告**——仅依赖 git gc 的默认行为（默认保留 30 天 reflog）。
