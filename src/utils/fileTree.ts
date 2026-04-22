import type { FileEntry } from '@/types/git'

export interface TreeNode<T = any> {
  isDir: boolean
  path: string
  name: string
  depth: number
  file?: T
  children: TreeNode<T>[]
}

export function buildFileTree<T>(files: T[], getPath: (f: T) => string): TreeNode<T>[] {
  const root: TreeNode<T> = {
    isDir: true,
    path: '',
    name: '',
    depth: -1,
    children: [],
  }

  for (const file of files) {
    const pathStr = getPath(file)
    const parts = pathStr.split('/')
    let current = root
    let currentPath = ''

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const isLast = i === parts.length - 1
      currentPath = currentPath ? `${currentPath}/${part}` : part

      let child = current.children.find((c) => c.name === part)
      if (!child) {
        child = {
          isDir: !isLast,
          path: currentPath,
          name: part,
          depth: current.depth + 1,
          children: [],
        }
        if (isLast) {
          child.file = file
        }
        current.children.push(child)
      }
      current = child
    }
  }

  // Optional: compress empty directories (like a/b/c if a and b only have 1 child)
  // Let's implement a simple version without compression first for reliability.
  
  function sortTree(node: TreeNode<T>) {
    node.children.sort((a, b) => {
      if (a.isDir && !b.isDir) return -1
      if (!a.isDir && b.isDir) return 1
      return a.name.localeCompare(b.name)
    })
    for (const child of node.children) {
      if (child.isDir) sortTree(child)
    }
  }
  sortTree(root)

  return root.children
}

export function flattenTree<T>(nodes: TreeNode<T>[], expandedDirs: Set<string>): TreeNode<T>[] {
  const result: TreeNode<T>[] = []

  function traverse(nodeList: TreeNode<T>[]) {
    for (const node of nodeList) {
      result.push(node)
      if (node.isDir && expandedDirs.has(node.path)) {
        traverse(node.children)
      }
    }
  }

  traverse(nodes)
  return result
}
