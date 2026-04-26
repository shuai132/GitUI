# 单元测试基建实施方案

## Context
目前 GitUI 项目缺乏完善的单元测试。为了在未来的重构和功能迭代中能够快速发现代码修改引入的回归错误，我们需要搭建覆盖前端、后端以及 CI/CD 的自动化测试体系。

## 预期结果
1. 前端：引入 Vitest，支持对纯逻辑、Store 及 Vue 组件的单元测试。
2. 后端：基于现有的 `cargo test` 和 `tempfile` 库，建立通用的模拟仓库工具库（TestRepo），并编写基础的核心业务逻辑测试。
3. CI/CD：添加 GitHub Actions，确保每次 Push 和 PR 都会自动跑满所有类型检查和测试用例。

## 进度总览

| 阶段 | 状态 | 目标 |
| --- | --- | --- |
| 1 | 待进行 | 前端测试基建：配置 Vitest 及编写首批算法测试 |
| 2 | 待进行 | 后端测试基建：引入 `TestRepo` 并在 Rust 编写 Git 业务测试 |
| 3 | 待进行 | CI/CD 集成：编写 GitHub Actions Workflow |

## 子任务清单

- [ ] **阶段 1：前端测试基建**
  - [ ] `npm i -D vitest @vue/test-utils jsdom`
  - [ ] 在 `package.json` 添加 `test` 脚本
  - [ ] 编写 `src/utils/graph.spec.ts`，覆盖 `computeGraphLayout` 算法的核心逻辑。
  - [ ] 提交 Commit: `build: 增加前端单元测试框架 (Vitest) 及示例用例`

- [ ] **阶段 2：后端测试基建**
  - [ ] 在 `src/git/` 增加 `test_utils.rs` (包含 `TestRepo` 初始化逻辑，支持生成 mock commit 等)。
  - [ ] 在 `src/git/engine.rs` 增加基于 `TestRepo` 的 `get_status` 和 `get_log` 的单元测试。
  - [ ] 提交 Commit: `test: 增加 Rust 后端核心 Git 功能的测试基础设施与用例`

- [ ] **阶段 3：CI/CD 自动化**
  - [ ] 添加 `.github/workflows/test.yml`。
  - [ ] 配置前置的依赖安装、Lint、TypeScript Type Check、前端 Test 以及 后端 Cargo Test。
  - [ ] 提交 Commit: `ci: 添加 GitHub Actions 自动化测试工作流`

## 关键决策
- **前端为何选 Vitest**：与 Vite 工具链集成最深，开箱即用，执行速度快。
- **后端为何不 Mock libgit2**：Git 的行为模拟极其复杂，不如直接依赖底层文件系统配合 `tempfile` 和 `git2::Repository::init` 创建真实的临时空仓库进行端到端测试，更能保证逻辑的准确性，且 Rust 执行极快。

## 验证方式
执行 `npm run test` 应当全量通过。
执行 `cd src-tauri && cargo test` 应当全量通过。
推送到 GitHub 应当触发 CI 且全部变为绿灯。
