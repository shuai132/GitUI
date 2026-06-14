import { describe, expect, it } from 'vitest'
import { buildBranchTree, buildLocalBranchTree, type BranchTreeNode } from './branchTree'
import type { BranchInfo } from '@/types/git'

function branch(name: string, overrides: Partial<BranchInfo> = {}): BranchInfo {
  return {
    name,
    is_remote: false,
    is_head: false,
    ...overrides,
  }
}

function folder(node: BranchTreeNode) {
  expect(node.kind).toBe('folder')
  if (node.kind !== 'folder') throw new Error('expected folder node')
  return node
}

function branchNode(node: BranchTreeNode) {
  expect(node.kind).toBe('branch')
  if (node.kind !== 'branch') throw new Error('expected branch node')
  return node
}

function labels(nodes: BranchTreeNode[]) {
  return nodes.map((node) =>
    node.kind === 'folder'
      ? `folder:${node.name}:${node.path}`
      : `branch:${node.name}:${node.fullName}`,
  )
}

describe('branchTree', () => {
  it('keeps remote roots grouped by the first path segment', () => {
    const tree = buildBranchTree(
      [
        branch('origin/main', { is_remote: true }),
        branch('origin/feature/login', { is_remote: true }),
      ],
      ['upstream'],
    )

    expect(tree.map((node) => `${node.name}:${node.path}`)).toEqual([
      'origin:origin',
      'upstream:upstream',
    ])

    const origin = tree[0]
    expect(labels(origin.children)).toEqual([
      'folder:feature:origin/feature',
      'branch:main:origin/main',
    ])
  })

  it('builds local branch folders without wrapping single-segment branches', () => {
    const tree = buildLocalBranchTree([
      branch('main'),
      branch('feature/login'),
      branch('feature/payments/refund'),
      branch('release/v1'),
    ])

    expect(labels(tree)).toEqual([
      'folder:feature:local:feature',
      'folder:release:local:release',
      'branch:main:main',
    ])

    const feature = folder(tree[0])
    expect(labels(feature.children)).toEqual([
      'folder:payments:local:feature/payments',
      'branch:login:feature/login',
    ])

    const payments = folder(feature.children[0])
    expect(labels(payments.children)).toEqual(['branch:refund:feature/payments/refund'])
  })

  it('keeps detached HEAD as the first local root node', () => {
    const tree = buildLocalBranchTree([
      branch('main'),
      branch('HEAD', { is_head: true }),
      branch('feature/work'),
    ])

    const head = branchNode(tree[0])
    expect(head.fullName).toBe('HEAD')
    expect(labels(tree.slice(1))).toEqual([
      'folder:feature:local:feature',
      'branch:main:main',
    ])
  })
})
