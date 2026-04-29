# 放弃工作区区块

## Context

工作区文件列表已有丢弃入口，WIP diff 也已有暂存 / 取消暂存单个 hunk 的能力，但用户无法直接在 diff 中放弃某个 hunk；未暂存文件右键的丢弃语义也需要明确为只丢弃未暂存部分，避免误伤同文件已暂存内容。

目标是在未暂存文件右键菜单提供“丢弃此文件未暂存的变更”，并在 WIP diff 的按 Hunk 分组视图中提供“放弃区块”。未暂存侧放弃区块只改工作区；已暂存侧放弃区块同时改 index 和工作区。

## 进度总览

| 阶段 | 状态 | 内容 |
| --- | --- | --- |
| 1 | 完成 | 后端补齐 workdir/index patch 与文件级未暂存丢弃语义 |
| 2 | 完成 | 前端接入 hunk 放弃按钮与确认弹窗 |
| 3 | 完成 | 文档、README 与测试同步 |

## 子任务清单

- [x] 调整 `discard_file` 为只丢弃未暂存部分，保留 index。
- [x] 新增同时应用 patch 到 workdir 和 index 的 IPC。
- [x] WIP diff 按 Hunk 分组时展示“放弃区块”按钮。
- [x] “放弃区块”执行前弹窗确认，并刷新工作区和当前 diff。
- [x] 更新工作区 / diff / IPC 文档和 README。
- [x] 增加前后端测试并运行检查。

## 关键决策

- **两侧都支持放弃区块**：未暂存侧回滚工作区 hunk；已暂存侧同时回滚 index 和工作区 hunk，符合用户在“取消暂存区块”旁直接放弃的预期。
- **只支持文本 modified hunk**：新增、删除、未跟踪、重命名、冲突和二进制文件不显示 hunk 放弃按钮，避免区块按钮实际执行整文件破坏操作。
- **文件级丢弃不动 index**：右键“丢弃此文件未暂存的变更”恢复工作区到 index；全部丢弃仍保持现有恢复 HEAD 并删除 untracked 的全局语义。

## 验证方式

- 前端：`npm run test` 覆盖按钮显示与 hunk patch 构造。
- 后端：`cd src-tauri && cargo test` 覆盖文件级丢弃保留 index，以及已暂存 hunk 同时从 index/workdir 放弃。
- 类型与编译：`npx vue-tsc --noEmit`、`cd src-tauri && cargo check`。
- 手动验证：同一文件制造两个相隔较远的修改，分别测试未暂存侧和已暂存侧“放弃区块”；同一路径同时存在 staged/unstaged 时，右键文件丢弃只移除 unstaged。
