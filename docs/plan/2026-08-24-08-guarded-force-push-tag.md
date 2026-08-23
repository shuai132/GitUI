# 精确预览并保护 Tag 强推

## Context

GitUI 的“强推 Tag”目前只在选择 remote 后显示系统确认，文案只包含标签名。用户无法看到该 remote 上同名 Tag 当前指向什么、将被哪个本地对象覆盖；确认期间本地标签或远端标签变化时，旧请求仍会按名字强制写入。

Git 官方明确说明 `refs/tags/*` 的任何更新默认都会被拒绝，只有 force 才能覆盖，并强调已发布 Tag 名称是使用者信任的一部分；GitLab 的 Protected Tags 也以防止意外更新和删除为目标。预期结果：只在远端确有不同对象时显示危险确认，明确展示 remote、本地 / 远端精确对象 OID，并在执行前复核捕获的目标。

## 进度总览

| 阶段 | 状态 | 内容 |
| --- | --- | --- |
| 语义与竞品核对 | 已完成 | 确认 Tag 更新默认拒绝及已发布 Tag 的信任风险 |
| 数据契约 | 已完成 | 为 TagInfo 增加精确 ref 对象 OID |
| 强推流程 | 已完成 | 预览差异、应用内确认与执行前复核 |
| 测试与交付 | 已完成 | 已覆盖目标变化并完成全量检查、提交与推送 |

## 子任务清单

- [x] 核对普通 / 强制 Tag push、remote picker 与远端 Tag 列表流程
- [x] 核对轻量 / 附注 Tag 的 ref OID 与 peeled commit OID 差异
- [x] 为 Rust / TypeScript `TagInfo` 增加 `ref_oid`
- [x] 远端无同名 Tag 或对象完全一致时避免无意义的危险确认
- [x] 远端对象不同时展示 remote、本地对象与远端对象
- [x] `push_tag` 接收预期本地 / 远端对象并在推送前复核
- [x] 确认期间仓库、Tag 或 remote 目标变化时拒绝旧请求
- [x] 移除 Tag 强推的系统 `confirm()`，失败改为非阻塞提示
- [x] 覆盖 TagInfo 精确 OID 与强推目标保护测试
- [x] 更新分支 / Tag 与 IPC 文档、中英文文案
- [x] 执行格式化、类型检查、前后端全量测试与 Rust 编译检查
- [x] 核对 staged diff，提交并推送 `dev`

## 关键决策

- `TagInfo.commit_oid` 继续表示 peel 后的 commit，供历史跳转；新增 `ref_oid` 表示 `refs/tags/<name>` 直接指向的对象。附注 Tag 即使落在同一 commit，只要 Tag 对象不同也视为覆盖。
- 强推入口先针对用户选定的 remote 调用已有远端 Tag 列表命令。远端不存在同名 Tag 时改用普通 push；对象完全一致时也按普通 push 处理，不制造无意义的危险确认。
- 确认框展示 Tag 名、remote 和两侧短 OID；完整 OID 保存在请求状态中用于执行校验，不要求用户人工比对 40 位值。
- 后端先校验本地 ref OID，再在 force 操作临执行前重新读取远端 ref OID。该复核消除陈旧确认窗口，但不宣称具备 Git 协议层原子 `force-with-lease` 保证。
- 普通 Tag push 同样携带预期本地 ref OID，避免菜单数据陈旧后推送同名新对象；不额外读取远端。
- 不改变 remote 的保护规则；服务端拒绝 force 时照常返回错误。

## 验证方式

1. 对远端不存在的 Tag 选择强推，确认不弹危险框且按普通 push 创建。
2. 本地与远端 ref OID 相同，确认不弹危险框且保持幂等。
3. 两侧 ref OID 不同，确认框显示 Tag、remote 与两侧短 OID；取消时不推送。
4. 确认后本地 Tag 被重建或远端 Tag 被他人移动，确认后端拒绝旧请求且不覆盖新目标。
5. 验证附注 Tag 的 `ref_oid` 为 Tag 对象、`commit_oid` 为 peeled commit。
6. 运行 `npx vue-tsc --noEmit`、`npm run test`、`cd src-tauri && cargo check`、`cd src-tauri && cargo test`。
