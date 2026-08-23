# 更新弹窗内容与异步状态加固

## Context

`UpdateDialog` 把 GitHub Release Markdown 转成 HTML 后直接交给 `v-html`，远端正文中的危险属性或 URI 没有消毒边界。Release Notes 请求也未绑定版本：快速切换 update prop 时，较晚返回的旧版本正文会覆盖当前版本；下载完成与错误状态同样可能沿用到后续版本。

预期结果：用成熟 HTML sanitizer 约束 Release Notes，按 visible + version 隔离正文请求，并在版本变化时重置非活动下载状态。外部 Releases 链接和重启失败通过既有非阻塞提示反馈。

## 进度总览

| 阶段 | 状态 | 内容 |
| --- | --- | --- |
| 现状审计 | 已完成 | 定位远端 HTML 信任边界与版本竞态 |
| 内容安全 | 已完成 | 引入 DOMPurify 并消毒 Markdown HTML |
| 状态隔离 | 已完成 | 绑定正文与下载状态到 update version |
| 测试与交付 | 已完成 | 恶意正文、旧响应、版本重置与本地失败路径已覆盖，完整门禁通过 |

## 子任务清单

- [x] 核对更新弹窗、设置文档与依赖现状
- [x] 引入 DOMPurify 并限制 Release Notes HTML
- [x] 为 Release Notes 增加 visible + version 请求序列
- [x] 版本变化时重置完成、错误和进度状态
- [x] 为打开 Releases / 重启失败补充非阻塞提示
- [x] 覆盖消毒、旧响应丢弃与版本重置测试
- [x] 更新设置模块行为文档
- [x] 执行格式化、类型检查、前后端全量测试与 Rust 编译检查
- [x] 核对 staged diff，提交并推送 `dev`

## 关键决策

- 使用 DOMPurify 作为 Markdown HTML 的专用消毒边界，不自建不完整的标签 / 属性解析器。
- 保留 `marked` 的排版能力和外链新标签页行为；消毒发生在最终 HTML 写入响应式状态之前。
- 只接受当前可见版本的正文响应；关闭或切换版本会使旧响应失效。
- 下载操作本身不能由前端取消；版本变化只在没有活动下载时重置展示状态，避免误导为取消了仍在执行的安装。

## 验证方式

1. 注入带事件属性与 `javascript:` URI 的 Release 正文，确认危险内容被移除、普通 Markdown 保留。
2. 让旧版本请求晚于新版本返回，确认界面始终显示新版本正文。
3. 完成一个版本下载后切换到新版本，确认重新显示下载动作而非旧的重启状态。
4. 运行 `npx vue-tsc --noEmit`、`npm run test`、`cd src-tauri && cargo check`、`cd src-tauri && cargo test`。
