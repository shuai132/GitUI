# 提交摘要长度引导

## Context

GitUI 的提交表单支持多行消息，但目前只有一个无反馈文本框。用户很难知道历史列表实际使用首行作为摘要，也不知道过长首行会降低提交图和日志的可读性。

[GitKraken 官方提交指南](https://gitkraken.com/learn/git/best-practices/git-commit-message)明确区分 Summary 与 Description，并建议摘要不超过 50 个字符、避免超过 72；[GitHub Desktop 功能反馈](https://github.com/desktop/desktop/issues/2055)也集中讨论了恢复 50 字符提示的需求。

本阶段保留 GitUI 现有单一多行输入框和完整草稿格式，只在操作栏提供首行字符计数与分级颜色：50 以内中性，51–72 提醒，超过 72 明确警示。

## 进度总览

| 阶段 | 状态 |
|------|------|
| 交互设计 | 已完成 |
| 实现与测试 | 已完成 |
| 构建与回归验证 | 已完成 |

## 子任务清单

- [x] 核对类似客户端的摘要 / 正文与长度提示
- [x] 只统计提交消息首行的 Unicode 字符数
- [x] 在现有提交操作栏显示紧凑计数器
- [x] 对建议区间和截断风险使用不同视觉状态
- [x] 补充计数边界、多行和 Unicode 测试
- [x] 同步工作区文档与 README
- [x] 完成前后端全量检查

## 关键决策

- 不把现有 textarea 拆成两个字段，避免改写已有多行草稿、commit template 风格文本或快捷提交流程。
- 50 是建议线、72 是风险线，不阻止提交；团队规范可以合法使用更长摘要。
- 只统计第一行，正文长度不影响计数器。
- 按 Unicode code point 计数，常见 emoji 和非 BMP 字符不会被 JavaScript UTF-16 长度重复计算。
- 提示复用现有主题颜色，不增加设置项或 IPC。

## 验证方式

1. 输入 50、51、72、73 个字符，确认计数与中性 / 提醒 / 警示状态边界。
2. 输入多行消息，确认只统计首行。
3. 输入中文和 emoji，确认按可见 code point 计数。
4. 确认 Cmd/Ctrl+Enter、Amend、自动增高和草稿恢复行为不变。
5. 运行 `npx vue-tsc --noEmit`、`npm run test`、`cd src-tauri && cargo check`、`cd src-tauri && cargo test`。

验证结果：前端 222 个、后端 82 个测试通过，TypeScript 类型检查和 Rust 编译检查通过。
