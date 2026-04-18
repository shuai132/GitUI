# 混合编码自适应（commit message 与文件内容分别解码）

## Context

Windows 老仓库长期存在「commit message 与源码文件编码不一致」的痛点：commit message 可能是 UTF-8、源码是 GB2312/GBK，反之亦然。这种仓库在主流 Git GUI（SourceTree / Fork 等）里几乎必乱码——**根因是它们假设全仓单一编码**。

GitUI 现状：

- `engine.rs` 中所有 `commit.message()` / `commit.author().name()` 类调用都假设 UTF-8（git2-rs 内部不做转码，非 UTF-8 直接返回空或乱码）；
- `parse_diff` / `try_conflict_diff` 用 `String::from_utf8_lossy` 处理 diff 字节流，非 UTF-8 字节会变成 U+FFFD（�）丢失原文；
- 完全没读 commit object 头部的 `encoding` 字段，也没读 `.gitattributes` 的 `working-tree-encoding`；
- 唯一处理过编码的是 `list_stashes`（已切换到 `message_bytes()` + lossy，避开 git2 在 stash_foreach 上的 panic，见 `engine.rs:2076-2096`）。

**目标**：在 Windows 中文混合编码仓库下，history / diff 视图的 commit message、author 名、diff 内容均能正常显示；纯 UTF-8 仓库零回归（UTF-8 试解 O(n) 极快）；全自动，不暴露 UI 切换器。

## 进度总览

| 范围 | 状态 | 依赖项 |
| --- | --- | --- |
| 加 `encoding_rs` + `chardetng` 依赖 | 已完成 | — |
| 新增 `git/encoding.rs` 工具模块 | 已完成 | 依赖 |
| 改造 commit / author / committer 文本读取 | 已完成 | encoding.rs |
| 改造 `parse_diff` 按文件检测并解码 | 已完成 | encoding.rs |
| 改造 `try_conflict_diff` 同上 | 已完成 | encoding.rs |
| 加固 ref 名（branch / tag / remote / submodule） | 已完成 | encoding.rs |
| `cargo check` + `cargo test` 通过 | 已完成 | 全部 |

## 子任务清单

- [x] `Cargo.toml` 新增 `encoding_rs` 与 `chardetng`
- [x] 创建 `src-tauri/src/git/encoding.rs`：`decode_commit_text` / `decode_ref_name` / `detect_file_encoding` / `decode_with`
- [x] 在 `git/mod.rs` 导出新模块
- [x] `engine.rs::get_log` 中 commit message / summary / author 改走 `decode_commit_text`
- [x] `engine.rs::get_commit_detail` 同上
- [x] `engine.rs::get_file_log` 同上
- [x] `engine.rs::get_file_blame`（blame hunk 的 author / summary）同上
- [x] `engine.rs::get_reflog`（reflog message + committer name）同上
- [x] `engine.rs::cherry_pick_commit` / `revert_commit`（写新 commit 时复用原 message）改走 `message_bytes` 解码
- [x] `engine.rs::parse_diff` 改成「walk 收集字节 → 按文件检测编码 → 解码」两阶段
- [x] `engine.rs::try_conflict_diff` 同上（基于 workdir bytes 检测）
- [x] `engine.rs::list_branches` / `list_tags` / `list_remotes` / `list_submodules` 等 ref 名改走 `decode_ref_name`
- [x] `engine.rs::get_status` 中 head_commit_message 同 commit 路径
- [x] 跑 `cargo check` 通过
- [x] 跑 `cargo test` 通过

## 关键决策

**为什么要分两条独立路径**：commit object 头部有 `encoding` header（如 `encoding GB2312`），libgit2 暴露 `Commit::message_encoding()`。文件内容编码则跟 `.gitattributes` 的 `working-tree-encoding` 或文件本身字节有关，两者**没有任何关系**。统一假设一个编码（不论是 UTF-8 还是用户配置）就是 SourceTree 长期翻车的根因。

**优先级链（commit）**：
1. `Commit::message_encoding()` 显式声明（git 标准）→ 用 encoding_rs 解
2. UTF-8 试解（`std::str::from_utf8`，~5GB/s 极快，纯 UTF-8 仓库直接通过）
3. `chardetng` 检测 → encoding_rs 解
4. `from_utf8_lossy` 兜底

**优先级链（diff 文件内容，按 `DiffDelta` 边界）**：
1. `.gitattributes` 的 `working-tree-encoding`（用 `Repository::get_attr` 读，libgit2 不自动转码但能读到这个属性）
2. UTF-8 试解
3. `chardetng` 在该文件**全部行字节拼接后**做检测（不是按 line 检测）
4. `from_utf8_lossy` 兜底

**为什么不暴露 UI 切换器**：跟用户讨论过，全自动方案在 99% 情况下能正常，且符合「轻量易用」目标；保留之后按需扩展的余地。

**为什么 ref 名只 lossy 不检测**：git ref 规范要求 UTF-8，违规情况罕见；chardetng 对极短字符串（<6 中文字符）准确率约 88%，反而可能把正常 ref 误判。lossy 至少保证不丢字节、不 panic、能搜索。

**实现重构方式**：`parse_diff` 原本在 `print()` 回调里直接做 `from_utf8_lossy`。改造方案是引入内部 `PendingFile/PendingHunk/PendingLine` 结构在 walk 阶段只存原始字节；walk 完成后按文件 detect_file_encoding + 统一 decode。代价是临时多一份 Vec<u8>，对常见 diff 量级（几百 KB）无感知。

**不做的事**：
- 不引入 `working-tree-encoding` 的回写转码（libgit2 不支持，且超出本次范围）
- 不引入 per-repo / 全局 fallback 编码配置（自动检测足够；保留后续扩展）
- 不引入 attr_encoding 的持久化缓存（先看实际响应；如果发现 `get_attr` 在大仓库 diff 里成为热点再加）
- 不改前端：`FileDiff.content` / `CommitInfo.message` 仍是 string，IPC 契约零变化

## 验证

1. `cd src-tauri && cargo check` 通过
2. `cd src-tauri && cargo test` 全部 PASS
3. **手动构造混合编码 commit 验证**：
   ```bash
   # 在临时仓库里：
   git init test-encoding && cd test-encoding
   echo "GBK 源码内容" | iconv -f utf-8 -t gbk > main.c
   git add main.c
   GIT_AUTHOR_NAME=作者 GIT_AUTHOR_EMAIL=a@b.c \
     git -c i18n.commitEncoding=GBK commit -m "$(echo '初始提交：GBK message' | iconv -f utf-8 -t gbk)"
   ```
   - 在 GitUI 打开该仓库 → history 视图：commit summary、author、message body 应显示为 `初始提交：GBK message` / `作者`，无 `?` 或 �
   - 选中 commit → 右侧 diff：main.c 内容显示 `GBK 源码内容`
4. **纯 UTF-8 大仓库回归**：在已有 vue 仓库（数千 commit）上对比改造前后 `loadLog` 时长，要求 < 5% 退化
5. **`.gitattributes` 路径**：在测试仓库加 `.gitattributes` 设 `*.txt working-tree-encoding=GBK`，验证 attr 路径生效
