# 2026-05-10-01-submodule-history-followups

## Context
历史详情已经支持从 direct submodule 的 gitlink 变更右键打开子仓库，但相关判断分散在历史和工作区菜单里，且缺少单元测试。未初始化或未克隆的 submodule 只能看到禁用的打开动作，用户需要切到侧边栏再执行 init / update。历史提交中的旧 submodule 还依赖当前 `list_submodules` 结果识别，若该 submodule 已从当前工作区移除，就不会被标记为 submodule。

## 预期结果
1. Submodule 路径匹配、可打开状态和 gitlink 判断集中到共享工具，并有单元测试覆盖。
2. 工作区和历史详情的 submodule 菜单在无法直接打开时，提供 init / update 动作。
3. 历史 diff 能通过文件 mode 识别 gitlink，即使当前工作区已不再列出该 submodule，也能显示 submodule 特殊项。

## 进度总览

| 阶段 | 状态 | 说明 |
| ---- | ---- | ---- |
| 1. 共享工具与测试 | 进行中 | 抽取前端 submodule 判断逻辑，补 Vitest。 |
| 2. Init / Update 菜单动作 | 待开始 | 历史详情和工作区菜单都复用同一动作判断。 |
| 3. 历史 gitlink mode 识别 | 待开始 | 扩展 `FileDiff` IPC 数据并同步文档。 |
| 4. 验证与分步提交 | 进行中 | 每个阶段独立提交，提交前运行要求的检查。 |

## 子任务清单

- [x] 新增 `src/utils/submodules.ts`，集中 `findSubmoduleByPath`、`canOpenSubmodule`、菜单动作判断和 gitlink mode 判断。
- [x] 补 `src/utils/submodules.spec.ts` 覆盖状态与路径匹配。
- [x] 工作区和历史菜单改为使用共享工具。
- [ ] 在未 init / 未 clone / not found 时提供 init / update 菜单动作，并刷新 submodule / workspace 状态。
- [ ] Rust `FileDiff` 增加文件 mode 信息，前端类型同步。
- [ ] 后端 diff 构建处填充 mode，前端用 gitlink mode 标记历史 submodule 项。
- [ ] 更新 `docs/04-history.md`、`docs/09-submodules.md`、`docs/11-ipc.md` 和 README。
- [ ] 分阶段运行 `npx vue-tsc --noEmit`、`npm run test`、`cd src-tauri && cargo fmt`、`cd src-tauri && cargo check`、`cd src-tauri && cargo test`。

## 关键决策
- **不新增 IPC command**：init / update / open 继续复用现有 submodule 命令，避免扩大命令面。
- **模式识别只做类型标记**：历史上的旧 submodule 若当前工作区没有对应 `SubmoduleInfo`，可以显示为 submodule gitlink，但不能执行 init / update / open，因为缺少当前 `.gitmodules` 中的 name / url 契约。
- **保留 direct submodule 边界**：能执行动作的对象仍来自当前仓库 direct submodule 列表，不递归扫描深层子模块。
- **测试覆盖纯逻辑**：菜单组合本身依赖 Vue 组件和 Tauri 命令，抽出的共享判断用纯函数测试，降低测试脆弱性。

## 验证方式
1. 右键当前已克隆 direct submodule 的 WIP 和历史变更，确认仍可打开子仓库。
2. 对未 init 的 direct submodule，确认菜单提供 init；执行后刷新列表并可继续 update / open。
3. 对已 init 但未 clone / 工作区缺失的 direct submodule，确认菜单提供 update；执行后可打开。
4. 浏览历史中已删除的 submodule gitlink 变更，确认文件列表仍显示 submodule 标识，但不提供当前工作区动作。
5. 提交前运行前后端类型检查、单元测试和 Rust 编译检查。
