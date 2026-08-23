# 键盘快速切换仓库

## Context

GitUI 的“所有仓库”已经支持按名称和绝对路径过滤，但入口仅在标题区悬停后显示，过滤结果仍需鼠标点击。多仓库用户无法从当前工作位置直接完成“唤起、输入、选择、切换”的全键盘闭环。

成熟 Git 客户端把仓库快速打开作为高频键盘入口：

- [Tower Quick Open](https://www.git-tower.com/help/guides/faq-and-tips/tips-and-tricks/open-quickly/windows)：快捷键唤起、按仓库名称过滤并直接打开。
- [GitKraken 键盘快捷键](https://help.gitkraken.com/gitkraken-desktop/keyboard-shortcuts/)：`Cmd/Ctrl + Shift + O` 打开仓库，并提供左侧过滤栏聚焦快捷键。
- [GitKraken Command Palette](https://help.gitkraken.com/gitkraken-desktop/command-palette/)：结果随输入即时过滤，Enter 执行当前选择。

本阶段复用现有“所有仓库”搜索框：增加可配置的快速切换快捷键，唤起时自动展开侧边栏和仓库搜索；支持上下方向键移动候选、Enter 激活、Escape 清空关闭。

## 进度总览

| 阶段 | 状态 |
|------|------|
| 交互与兼容方案 | 已完成 |
| 实现与测试 | 已完成 |
| 构建与回归验证 | 已完成 |

## 子任务清单

- [x] 对比同类产品的仓库快速打开入口
- [x] 增加可配置的 `Cmd/Ctrl + Shift + O` 仓库切换快捷键
- [x] 通过 UI signal 展开侧边栏并聚焦现有仓库搜索
- [x] 支持方向键、Enter、Escape 完成键盘选择
- [x] 确保 Submodule 父级上下文不抢占真实搜索匹配项
- [x] 补充快捷键派发、搜索控件和候选算法测试
- [x] 同步仓库管理、设置文档与 README
- [x] 完成前后端全量检查

## 关键决策

- 复用侧边栏现有搜索，不另建命令面板，避免同一仓库过滤规则和状态出现两套实现。
- 快捷键默认与 GitKraken 的直接打开仓库入口一致；继续纳入 GitUI 已有快捷键设置，用户可改绑或清除。
- 本阶段只切换已经加入“所有仓库”的项目，不扫描磁盘，也不替代添加 / 拖入仓库入口。
- 搜索 Submodule 子仓库时仍显示父仓库作为视觉上下文，但键盘候选只包含真正匹配名称或路径的行，避免 Enter 误切到父仓库。
- 空查询时从当前活跃仓库开始选择；输入查询后回到第一个真实匹配项。激活后清空并关闭搜索，恢复完整名册。
- 不新增 IPC，不增加后台查询；候选计算只遍历已打开仓库，规模很小。

## 验证方式

1. 在有多个仓库时按 `Cmd/Ctrl + Shift + O`，确认隐藏的侧边栏自动展开，仓库搜索获得焦点。
2. 空查询时确认当前仓库被选中；按上下方向键循环移动，Enter 后切换并关闭搜索。
3. 输入仓库名称或路径片段，确认选中第一条真实匹配；Submodule 匹配保留父级展示但不把未匹配父级作为键盘候选。
4. Escape 清空并关闭；鼠标点击搜索、仓库排序和现有列表搜索行为不回归。
5. 在设置中改绑 / 清除“快速切换仓库”，确认新绑定生效。
6. 运行 `npx vue-tsc --noEmit`、`npm run test`、`cd src-tauri && cargo check`、`cd src-tauri && cargo test`。

本次实现通过全部四项检查；前端 187 个、后端 76 个测试通过，开发版可正常启动。由于开发版裸进程与已安装版本使用同一 bundle identifier，Computer Use 只能稳定定位已安装版本，因此未把该 UI 自动化结果作为通过依据，保留步骤 1～5 作为人工验收路径。
