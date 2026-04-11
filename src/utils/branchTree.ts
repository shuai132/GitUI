import type { BranchInfo } from '@/types/git'

/**
 * 分支树节点。
 * - `folder`：按 `/` 分层出来的目录节点（如 `origin` / `origin/copilot`）
 * - `branch`：叶子节点，对应一个真实的 BranchInfo
 */
export type BranchTreeNode = FolderNode | BranchNode

export interface FolderNode {
  kind: 'folder'
  /** 当前层的目录名（最后一段），如 `copilot` */
  name: string
  /** 从根到本节点的完整路径，如 `origin/copilot`，作为折叠状态的稳定 key */
  path: string
  children: BranchTreeNode[]
}

export interface BranchNode {
  kind: 'branch'
  /** 叶子层的显示文本（最后一段），如 `debug-aot-on-jit` */
  name: string
  /** 完整分支名，如 `origin/copilot/debug-aot-on-jit` */
  fullName: string
  branch: BranchInfo
}

interface MutableFolder {
  kind: 'folder'
  name: string
  path: string
  /** 用 Map 方便同名 folder 查找 */
  childFolders: Map<string, MutableFolder>
  childBranches: BranchNode[]
}

function newFolder(name: string, path: string): MutableFolder {
  return {
    kind: 'folder',
    name,
    path,
    childFolders: new Map(),
    childBranches: [],
  }
}

function freezeFolder(f: MutableFolder): FolderNode {
  // folder 按名字排序在前，branch 按名字排序在后
  const folders = Array.from(f.childFolders.values())
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(freezeFolder)
  const branches = [...f.childBranches].sort((a, b) => a.name.localeCompare(b.name))
  return {
    kind: 'folder',
    name: f.name,
    path: f.path,
    children: [...folders, ...branches],
  }
}

/**
 * 把扁平的 `BranchInfo[]` 构造为按 `/` 分层的树。
 *
 * - 只处理传入的分支列表（调用方负责先按 is_remote 过滤）
 * - 返回的根节点数组 = 按第一段命名分组得到的若干 folder（通常就是 `origin`）
 * - 若某条分支只有一段（如本地分支 `main`），会归到一个隐式的根 folder，
 *   但典型用法只传远程分支进来，所以至少会有两段
 */
export function buildBranchTree(branches: BranchInfo[]): FolderNode[] {
  const roots = new Map<string, MutableFolder>()

  for (const b of branches) {
    const parts = b.name.split('/')
    if (parts.length === 0) continue

    // 第一段作为根 folder 名
    const rootName = parts[0]
    let root = roots.get(rootName)
    if (!root) {
      root = newFolder(rootName, rootName)
      roots.set(rootName, root)
    }

    // 中间段创建子 folder
    let cursor = root
    for (let i = 1; i < parts.length - 1; i++) {
      const segment = parts[i]
      const childPath = `${cursor.path}/${segment}`
      let next = cursor.childFolders.get(segment)
      if (!next) {
        next = newFolder(segment, childPath)
        cursor.childFolders.set(segment, next)
      }
      cursor = next
    }

    // 最后一段：如果只有一段（parts.length === 1），那这个分支就是 root 的叶子
    // 否则 cursor 是倒数第二层
    const leafName = parts[parts.length - 1]
    if (parts.length === 1) {
      // 特殊情况：没有斜杠，直接作为根 folder 下的 branch（很少见）
      root.childBranches.push({
        kind: 'branch',
        name: leafName,
        fullName: b.name,
        branch: b,
      })
    } else {
      cursor.childBranches.push({
        kind: 'branch',
        name: leafName,
        fullName: b.name,
        branch: b,
      })
    }
  }

  return Array.from(roots.values())
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(freezeFolder)
}
