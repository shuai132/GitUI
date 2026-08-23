# 记住 Clone 父目录

## Context

GitUI 的 Clone 对话框每次打开都会清空父目录。用户连续克隆多个仓库到同一工作区时，必须反复打开系统目录选择器并导航到相同位置；URL、目标仓库名等一次性字段重置是合理的，但常用根目录属于稳定偏好。

[GitHub Desktop 官方入门文档](https://docs.github.com/en/desktop/overview/creating-your-first-repository-using-github-desktop)明确说明应用会记住用户选择的本地位置，供下次创建或克隆仓库使用；[相关历史反馈](https://github.com/desktop/desktop/issues/1663)也把首次克隆后记住目录描述为既有预期。

本阶段让 Clone 对话框记住最近使用的父目录，同时继续重置 URL、自定义目录名、深度和递归 Submodule 选项。

## 进度总览

| 阶段 | 状态 |
|------|------|
| 交互方案 | 已完成 |
| 实现与测试 | 已完成 |
| 构建与回归验证 | 已完成 |

## 子任务清单

- [x] 核对 Clone 表单重置行为
- [x] 对比同类产品目录记忆行为
- [x] 读取并预填最近父目录
- [x] 目录选择、手动修改和清空时同步偏好
- [x] 补充持久化与重新打开测试
- [x] 同步仓库管理文档与 README
- [x] 完成前后端全量检查

## 关键决策

- 使用前端本地偏好保存父目录，不进入仓库名册，也不新增 IPC。
- 目录选择完成或文本框 change 时写入；清空则删除偏好，用户仍可回到空白状态。
- 只复用父目录，不复用 URL、自定义名称、深度和递归选项，避免一次性 Clone 参数误带到下一个仓库。
- 不主动探测保存目录是否存在；对话框仍允许用户编辑，实际 Clone 继续由现有后端校验。

## 验证方式

1. 选择或手动填写父目录，关闭并重新打开 Clone 对话框，确认目录预填。
2. 清空父目录并触发 change，重新打开后确认保持空白。
3. Clone 成功 / 失败、URL 推导目录名、浅克隆和递归 Submodule 行为不回归。
4. 运行 `npx vue-tsc --noEmit`、`npm run test`、`cd src-tauri && cargo check`、`cd src-tauri && cargo test`。

本次实现通过全部四项检查；前端 201 个、后端 76 个测试通过。
