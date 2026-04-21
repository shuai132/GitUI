# 内置终端 (Terminal)

内置终端模块允许用户在不离开 GitUI 的情况下直接执行命令行操作。它支持跨仓库的会话管理、多标签页切换，并保持极致紧凑的 UI 风格。

## 1. 架构设计

终端模块由 Rust 后端 PTY 进程管理、Pinia 全局状态和 Vue 组件视图三部分组成。

### 1.1 后端管理 (`src-tauri/src/terminal.rs`)
- **PTY 桥接**: 基于 `portable-pty` 实现。每个终端会话对应一个独立的操作系统子进程（Shell）。
- **异步流推送**: 后端启动独立线程轮询 PTY Master 端的输出，并通过 Tauri Events (`terminal://data`) 实时推送到前端。
- **IPC 指令**: 见 `terminal_spawn`, `terminal_write`, `terminal_resize`, `terminal_close`。

### 1.2 前端状态 (`src/stores/terminal.ts`)
- **多会话管理**: `useTerminalStore` 维护一个以 `repoId` 为键的 Map，存储每个仓库对应的多个 `TerminalTab`。
- **持久化**: 终端会话目前仅在应用运行期间保留在内存中。切换仓库或隐藏终端面板不会中断 PTY 进程，确保任务执行的连续性。

## 2. 关键设计决策

### 2.1 性能与渲染隔离
- **隐藏容器保护**: 为了避免 `xterm.js` 在不可见容器中因无法计算几何尺寸而进入无效重绘死循环（可能导致 WebKit CPU 100%），模块强制执行“尺寸探测”策略。只有当宿主元素可见且尺寸大于 0 时，才允许初始化终端或执行自适应 (`fit`) 操作。
- **DOM 驻留策略**: 采用 `v-show` 模式维护多个终端实例。非活动标签页保留 DOM 节点但不参与布局重算，确保切换时零延迟且不丢失终端缓冲区状态。

### 2.2 视觉风格
- **极简紧凑**: 终端界面遵循项目的极致紧凑原则，采用极低高度的页眉和 IDE 风格的标签栏设计。
- **激活态标识**: 仅通过顶边高亮色和细微背景差异标识活动标签，避免冗余的边框线干扰视觉。

## 3. 数据流契约

### 3.1 PTY 写入
前端字符输入 -> `terminal_write` -> Base64 编码 -> 后端解码并写入 PTY stdin。

### 3.2 PTY 读取
PTY stdout -> 后端 Base64 编码 -> 发送 `terminal://data` 事件 -> `terminalStore` 监听并分发至对应标签页的 `xterm.js` 实例。

## 4. 后续规划
- **WebGL 加速**: 在处理超大吞吐量输出时，考虑引入硬件加速渲染插件。
- **Shell 选择**: 支持用户自定义默认 Shell 路径。
