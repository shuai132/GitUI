# 05. 提交图绘制

提交图是一条条纵向"泳道"（lane），每条泳道代表一条 DAG 分支。GitUI 的 lane 算法实现在 `src/utils/graph.ts`，视觉渲染在 `components/history/CommitGraphRow.vue`。

## 目标

- 展示主线 / 分支 / merge / cherry-pick 的拓扑结构
- 与虚拟滚动兼容：每一行的绘制只依赖自身的 `GraphRow` 结构，不需要看上下文
- 丢失引用的提交（`is_unreachable`）和贮藏（`is_stash`）要显眼但不破坏主图
- 颜色循环稳定，新分支开出时换色

## 数据结构

真身在 `src/utils/graph.ts`，这里只列下文算法描述会引用的字段：

- **`GraphRow`**：`column`（本 commit 所在 lane 列号）、`color`（圆点色）、`segments`（要画的线段）、`totalColumns`（行宽）、`isUnreachable` / `isStash` 标记
- **`GraphSegment`**：`fromCol` / `toCol`（起止列）、`color`、`upper` / `lower`（是否占上半行 / 下半行）

布局常量（lane 宽度、行高、圆点半径）和 `GRAPH_COLORS`（8 色轮换配色表）集中在 `src/utils/graph.ts` 顶部，下文描述中出现的 `LANE_W` / `ROW_H` / `CIRCLE_R` 都指那里的值，需要调整时只改那一处。

## 算法（pvigier 变体）

输入：按拓扑 + 时间降序排好的 `CommitInfo[]`。扫描一次，维护一个 `lanes: Array<string | null>`，每个元素存该 lane 下一步期望出现的 oid。

对每条 commit：

1. **找到本 commit 的 lane**
   - 若在 `lanes` 中已被预留 → 直接用
   - 否则选第一个 `null` 空位；没有就 `push` 新列。新列分配一个轮换色
2. **快照 `prevLanes`**（"进入本行"时的泳道状态）
3. **释放本 lane**（`lanes[myCol] = null`）
4. **给每个 parent 分配 lane**
   - 已预留 → 复用
   - 首个 parent → 继承本 commit 的 lane（lane 贯通往下走）
   - 其他 parent → 找空位或新增列（merge 产生新泳道，换色）
5. **快照 `nextLanes`**（"离开本行"时的状态）
6. **生成 segments**：遍历 `max(prevLanes.length, nextLanes.length)` 列：
   - 本列：
     - 上半段：若 `prevOid === commit.oid` 表示有线进入本 commit
     - 下半段：首个 parent 若仍在本列，继续往下
     - 非首 parent → 画一段斜线到 parent 的 lane
   - 其他列：
     - 直通：`prevOid === nextOid && both` → 竖直线
     - 汇入：`upper` 存在但 `lower` 不在 → 斜向本 commit 的 myCol
     - 分叉：`lower` 存在但 `upper` 不在 → 从 myCol 斜出
     - 换乘：`prev != next && both` → 上下两段独立着色

`totalColumns` 取 `max(myCol, prevLanes 占用, nextLanes 占用, parentCols)` + 1，用于设定行宽。

## 渲染

`CommitGraphRow.vue`（没详细贴）从 `GraphRow` 取 segments，用 SVG `<line>` / `<path>` 绘制。

- 上半段线从 `(laneX(fromCol), 0)` 到 `(laneX(toCol), ROW_H/2)`
- 下半段线从 `(laneX(fromCol), ROW_H/2)` 到 `(laneX(toCol), ROW_H)`
- 圆点在 `(laneX(column), ROW_H/2)`，半径 `CIRCLE_R`

斜向 segment 的形状由设置里的 `graphStyle` 控制（见 `src/stores/settings.ts::GraphStyle`）：

- **`rounded`（默认）**：控制点拉到行内对角，两端紧贴各自 lane 的竖直段更长，中段近似水平 — 视觉上是「沿父 lane 竖直走 → 水平横移 → 沿子 lane 竖直走」的圆润 Z
- **`step`**：orthogonal 直角布线 — 竖直 → 圆角 → 水平 → 圆角 → 竖直，横段贴本行半段最下沿（紧贴目标节点上方），圆角用 quadratic Bezier 模拟四分之一圆弧
- **`angular`**：控制点退化（C1=P0、C2=P3）即直线，分叉处呈锐角折线

三种风格共用相同的 segment 端点坐标，只是 `segmentPath` 输出不同的 path。同列直通的竖直线不受开关影响（始终走 `M…L`）。

`HistoryView.vue` 里用 computed `graphColWidth` 根据所有行里出现的最大 `totalColumns` 决定图形列宽，上限 180px。

## 搜索与 WIP 行的处理

- **搜索中**：`filteredCommits !== commits`，`CommitGraphRow` 不渲染（搜索结果不连续，图会不正确）。只显示文本行
- **WIP 行**：虚拟行 index 0 是一条 `WipRow`，不走 graph 算法；它自己有迷你徽章（绿/蓝/橙三段）表示 staged/unstaged/untracked 数量

## 丢失引用与贮藏

`is_unreachable` / `is_stash` 由后端 `get_log` 在构造 `CommitInfo` 时标记，前端透传到 `GraphRow`：

- Unreachable：`.commit-row.commit-dim` 整行文本变灰 + 斜体；圆点改为空心虚线灰框。所有 unreachable 共享一档 dim，不再按 `is_reflog_tip` 做视觉分级——用户视角下它们都是"丢失引用"，应当同色。`is_reflog_tip` 字段仍由后端计算（见 [10-stash-reflog.md](./10-stash-reflog.md#从-reflog-中移除单个丢失引用)），但当前前端未消费
- Stash：message 变斜体 + 次要色；圆点改为"空心 + 分支色描边"的图标，和普通实心圆区分

**Stash 在 lane 算法里被视作普通 1-parent commit**。git 原生 stash 对象是 3-parent（HEAD + index 快照 + untracked 快照），但后端 `get_log` 会把 `parent[1]`/`parent[2]` 对应的辅助 commit 从输出里剔除，并把 stash 的 `parent_oids` 裁成只剩 HEAD——详见 [10-stash-reflog.md](./10-stash-reflog.md#历史图里的-stash)。所以对 `computeGraphLayout` 来说，stash 和普通 commit 没有结构差异，只有渲染时圆点样式不同。

切换 toggle（`showUnreachableCommits` / `showStashCommits`）会触发 `historyStore.loadLog` 重新走 revwalk，graph 也会重算。

## 关键决策

- **不保存全局图状态**：每个 `GraphRow` 是独立的，支持虚拟滚动直接按索引绘制
- **lane 颜色随 "首次出现" 递增**：同一条 lane 的颜色在它生命周期内保持不变
- **merge 来源线走斜线**：非首 parent 直接画一段 `myCol → newCol` 的斜线，视觉上类似 Sourcetree / GitKraken
- **不做 graph 压缩**：不把空 lane 合并，保持结构稳定（调试 / 对比更友好）
