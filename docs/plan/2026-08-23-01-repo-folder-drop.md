# 仓库目录拖入

## Context

GitUI 当前添加本地仓库必须点击“添加仓库”再经过系统目录选择器，频繁切换多仓库时路径偏长。GitHub Desktop 的官方文档把“将一个或多个 Git 文件夹拖入窗口”作为标准添加方式，用户反馈也表明拖入文件夹是桌面 Git 客户端中符合预期的入口：

- [GitHub Desktop：从本地计算机添加仓库](https://docs.github.com/en/desktop/adding-and-cloning-repositories/adding-a-repository-from-your-local-computer-to-github-desktop)
- [GitHub Desktop #2883：用户依赖拖入普通目录后的初始化提示](https://github.com/desktop/desktop/issues/2883)

本阶段让用户可把一个或多个 Git 仓库目录拖到侧边栏“所有仓库”区域，直接加入名册并激活最后一个成功打开的仓库。拖入期间提供明确目标反馈；无仓库或只有一个仓库时也保留这个入口。

Tauri 原生文件拖入与 HTML5 内部拖拽在 Windows / macOS 上互斥。GitUI 的提交行目前使用 HTML5 `draggable`，因此需要同步迁移为 pointer events，避免新增目录拖入时破坏既有 Merge / Rebase 手势。参考 [Tauri Webview `onDragDropEvent`](https://v2.tauri.app/reference/javascript/api/namespacewebview/#ondragdropevent) 与 [Tauri #14373](https://github.com/tauri-apps/tauri/issues/14373)。

## 进度总览

| 阶段 | 状态 |
|------|------|
| 交互与兼容方案 | 已完成 |
| 实现与测试 | 已完成 |
| 构建与回归验证 | 已完成 |

## 子任务清单

- [x] 对比同类产品并确认目录拖入的明确收益
- [x] 将提交行拖拽迁移到 pointer events，保留 Merge / Rebase 语义
- [x] 启用 Tauri 原生文件拖入并按 DPI 换算命中区域
- [x] 支持一次拖入多个仓库，批量注册后只激活一次
- [x] 为命中计算、批量打开和提交拖拽补充单元测试
- [x] 更新仓库管理文档与 README
- [x] 完成前后端全量检查并启动开发版检查入口呈现与监听注册

## 关键决策

- 只在“所有仓库”区域接收目录，不把整个窗口设为无差别目标，避免用户把文件拖向 Diff / 终端等区域时误打开仓库。
- 支持一次拖入多个路径，与 GitHub Desktop 的成熟行为对齐；逐个校验，单个无效路径不阻断其他有效仓库。
- 批量注册期间不逐仓库切换 active repo，全部处理完后只激活最后一个成功项，避免触发多轮历史、分支和工作区加载。
- 不新增 IPC。复用现有 `open_repo` 契约；拖入只是新的前端入口。
- 启用 Tauri 原生文件拖入以取得可靠的绝对路径；既有提交拖拽改用 pointer events，仓库排序本来就使用 pointer events，交互模型保持一致。

## 验证方式

1. 把一个 Git 仓库目录拖到“所有仓库”区域，确认区域高亮、仓库加入列表并激活。
2. 同时拖入两个有效仓库，确认顺序加入、只激活最后一个；混入无效目录时有效仓库仍成功，错误通过现有 toast 呈现。
3. 在 0、1、多个仓库三种状态下确认目标区域始终可见；拖到目标外不触发打开。
4. 在普通与高 DPI 屏幕确认悬停命中位置和视觉反馈一致。
5. 拖动提交到另一提交，确认 Merge / Rebase 选择对话框与源 / 目标高亮保持原语义；普通点击、右键与滚轮不回归。
6. 运行 `npx vue-tsc --noEmit`、`npm run test`、`cd src-tauri && cargo check`、`cd src-tauri && cargo test`。

本次实现已通过全部四项检查；前端 183 个、后端 76 个测试通过。开发版成功启动并确认“所有仓库”入口正常呈现、原生监听无注册错误。自动化 Finder 跨窗口拖动无法提供稳定坐标，因此不把该手势结果作为通过依据，仍保留步骤 1～5 作为人工验收路径。
