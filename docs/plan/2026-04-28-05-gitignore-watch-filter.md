# Git Ignore Watch Filter

## Context

当前工作区状态由 libgit2 按 Git ignore 规则计算，但文件监听器只读取仓库根 `.gitignore` 做前置过滤。结果是嵌套 `.gitignore`、`.git/info/exclude` 和 `core.excludesFile` 不参与监听过滤，会产生额外刷新；同时若直接按 ignore 规则丢弃事件，又可能漏掉已跟踪文件的修改。

预期结果：监听过滤与 Git ignore 来源保持一致，并保留已跟踪文件和 `.git/` 内部事件的刷新能力。

## 进度总览

| 阶段 | 状态 | 内容 |
| --- | --- | --- |
| 方案记录 | 已完成 | 写明 watcher ignore 行为与边界 |
| 实现 | 已完成 | 改造 `IgnoreFilter` 使用 libgit2 判断 |
| 验证 | 已完成 | 覆盖 ignore 来源和已跟踪文件例外 |

## 子任务清单

- [x] 新增 plan 文档
- [x] 改造 watcher ignore 过滤逻辑
- [x] 更新仓库管理文档中的 watcher 描述
- [x] 增加 Rust 单元测试
- [x] 运行格式化与测试检查

## 关键决策

- watcher 仍监听整个工作目录，避免漏掉 tracked 文件的外部编辑。
- `.git/` 内部事件永远放行，这是状态刷新最关键的信号来源之一。
- 对已跟踪路径先放行，再对未跟踪路径调用 `Repository::status_should_ignore()`；这样匹配 ignore 规则的 tracked 文件仍可触发刷新。
- 任何仓库打开、路径转换、index 读取或 ignore 判断错误都 fail open，优先避免漏刷新。

## 验证方式

- `cd src-tauri && cargo test watcher`
- `cd src-tauri && cargo fmt`
- `npx vue-tsc --noEmit`
- `npm run test`
- `cd src-tauri && cargo check`
- `cd src-tauri && cargo test`
