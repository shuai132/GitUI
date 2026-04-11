# 05. 提交图绘制

提交图是一条条纵向"泳道"（lane），每条泳道代表一条 DAG 分支。GitUI 的 lane 算法实现在 `src/utils/graph.ts`，视觉渲染在 `components/history/CommitGraphRow.vue`。

## 目标

- 展示主线 / 分支 / merge / cherry-pick 的拓扑结构
- 与虚拟滚动兼容：每一行的绘制只依赖自身的 `GraphRow` 结构，不需要看上下文
- 丢失引用的提交（`is_unreachable`）和贮藏（`is_stash`）要显眼但不破坏主图
- 颜色循环稳定，新分支开出时换色

## 数据结构

```ts
export interface GraphRow {
  oid: string
  column: number            // 本 commit 所在的 lane 列号
  color: string             // 本 commit 的圆点色
  segments: GraphSegment[]  // 本行要画的所有线段
  totalColumns: number      // 本行实际占据的列数（决定行宽）
  isUnreachable: boolean
  isStash: boolean
}

export interface GraphSegment {
  fromCol: number
  toCol: number
  color: string
  upper: boolean            // 是否占上半行（圆点上方）
  lower: boolean            // 是否占下半行（圆点下方）
}
```

常量：

```ts
LANE_W = 14   // px per lane
ROW_H = 28    // px per row
CIRCLE_R = 5  // commit 圆点半径
GRAPH_COLORS = [blue, orange, green, yellow, purple, red, sky, pink]
```

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

`HistoryView.vue` 里用 computed `graphColWidth` 根据所有行里出现的最大 `totalColumns` 决定图形列宽，上限 180px。

## 搜索与 WIP 行的处理

- **搜索中**：`filteredCommits !== commits`，`CommitGraphRow` 不渲染（搜索结果不连续，图会不正确）。只显示文本行
- **WIP 行**：虚拟行 index 0 是一条 `WipRow`，不走 graph 算法；它自己有迷你徽章（绿/蓝/橙三段）表示 staged/unstaged/untracked 数量

## 丢失引用与贮藏

`is_unreachable` / `is_stash` 由后端 `get_log` 在构造 `CommitInfo` 时标记，前端透传到 `GraphRow`：

- Unreachable：`.commit-row.commit-dim` 整行文本变灰 + 斜体；图形部分颜色不变
- Stash：`.commit-row.commit-stash` 的 message 变斜体 + 次要色；图形保留

切换 toggle 会触发 `historyStore.loadLog` 重新走 revwalk，graph 也会重算。

## 关键决策

- **不保存全局图状态**：每个 `GraphRow` 是独立的，支持虚拟滚动直接按索引绘制
- **lane 颜色随 "首次出现" 递增**：同一条 lane 的颜色在它生命周期内保持不变
- **merge 来源线走斜线**：非首 parent 直接画一段 `myCol → newCol` 的斜线，视觉上类似 Sourcetree / GitKraken
- **不做 graph 压缩**：不把空 lane 合并，保持结构稳定（调试 / 对比更友好）
