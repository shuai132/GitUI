# Diff 标题栏新增文件编码标注

在 diff 面板标题栏的 `+N -N` 行数右侧，增加一个编码 badge，方便用户直观判断文件编码。

## Context

Rust 后端已用 `encoding_rs + chardetng` 对每个 diff 文件做了编码检测（`detect_file_encoding`），
结果仅用于内部字节转 String，但从未暴露给前端。
将编码名随 `FileDiff` 一起传回，成本极低（已有数据），对多编码仓库（含 GBK / Shift_JIS / UTF-16 文件）价值明显。

**预期结果**：diff 标题栏 `+N -N` 右侧出现编码标注，UTF-8 低调灰色文字，非 UTF-8 橙色 badge。

## 进度总览

| 阶段 | 状态 |
|------|------|
| Rust 后端 `FileDiff` 新增 `encoding` 字段 | ✅ 完成 |
| 前端类型 + UI 渲染 | ✅ 完成 |
| IPC 文档同步 | ✅ 完成 |

## 子任务清单

- [x] `types.rs`：`FileDiff` 新增 `pub encoding: String`（`#[serde(default = "default_encoding")]`）
- [x] `engine.rs`：`parse_diff` Phase 2 填 `encoding: enc.name().to_owned()`
- [x] `engine.rs`：`try_conflict_diff` 重构——编码检测提到 `if !is_binary` 之外，二进制兜底 `UTF_8`
- [x] `engine.rs`：两处 `unwrap_or(FileDiff {...})` 填 `encoding: "UTF-8".to_owned()`
- [x] `git.ts`：`FileDiff` 接口新增 `encoding: string`
- [x] `DiffView.vue`：`+/-` 右侧插入 `.diff-encoding` span；非 UTF-8 追加 `.diff-encoding--non-utf8`（橙色 badge）
- [x] `docs/11-ipc.md`：类型映射表 `FileDiff` 行补充 `encoding` 说明
- [x] `cargo check` + `vue-tsc --noEmit` 验证通过

## 关键决策

| 决策 | 选择 | 理由 |
|------|------|------|
| UTF-8 是否显示 | 始终显示 | 明确告知用户文件编码正常，减少疑惑 |
| 字段名 | `encoding: String` | 简洁，前后端 snake_case 统一 |
| 不显示时机 | 仅 `isImageView` 时隐藏（与 `+/-` 同步） | 图片没有文本编码概念 |
| 编码名来源 | `encoding_rs::Encoding::name()` | 返回规范名称（如 "UTF-8", "GBK", "Shift_JIS"） |
| 二进制文件编码 | 兜底 `UTF_8`，但 `isImageView` 隐藏故不展示 | 二进制文件无文本编码意义，`is_binary` 时用 UTF-8 字面值无害 |

## 验证方式

1. `cargo check` 确认 Rust 编译通过 ✅
2. `vue-tsc --noEmit` 确认前端 TypeScript 通过 ✅
3. 手动：打开含 GBK 文件的仓库 → diff 标题栏显示橙色 `GBK` badge
4. 手动：普通 UTF-8 文件 → 显示低调灰色 `UTF-8`
5. 手动：图片文件 → 编码标注不显示
