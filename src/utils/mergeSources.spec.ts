import { describe, expect, it } from 'vitest'
import {
  buildDragActionState,
  mergeSourceNames,
  mergeSourceNamesAtCommit,
} from './mergeSources'
import type { BranchInfo } from '@/types/git'

function branch(overrides: Partial<BranchInfo>): BranchInfo {
  return {
    name: 'main',
    is_remote: false,
    is_head: false,
    ...overrides,
  }
}

describe('mergeSources', () => {
  it('keeps remote-only branches selectable as merge sources', () => {
    const branches = [
      branch({ name: 'main', is_head: true, commit_oid: 'head' }),
      branch({ name: 'origin/dev', is_remote: true, commit_oid: 'remote' }),
    ]

    expect(mergeSourceNames(branches)).toEqual(['origin/dev'])
    expect(mergeSourceNamesAtCommit(branches, 'remote')).toEqual(['origin/dev'])
  })

  it('prefers pointed candidates while excluding the current branch', () => {
    const branches = [
      branch({ name: 'main', is_head: true, commit_oid: 'same' }),
      branch({ name: 'feature', commit_oid: 'same' }),
      branch({ name: 'origin/feature', is_remote: true, commit_oid: 'same' }),
    ]

    expect(mergeSourceNames(branches, ['origin/feature'])).toEqual([
      'origin/feature',
      'feature',
    ])
    expect(mergeSourceNamesAtCommit(branches, 'same')).toEqual([
      'feature',
      'origin/feature',
    ])
  })

  it('models dragged merge and rebase as actions on the current branch', () => {
    const branches = [
      branch({ name: 'c', is_head: true, commit_oid: 'c-tip' }),
      branch({ name: 'a', commit_oid: 'a-tip' }),
      branch({ name: 'b', commit_oid: 'b-tip' }),
    ]

    expect(buildDragActionState(branches, 'a-tip', 'b-tip', 'c-tip', false)).toMatchObject({
      currentBranchName: 'c',
      sourceBranchNames: ['a'],
      targetBranchNames: ['b'],
      mergeSourceNames: ['a'],
      canMerge: true,
      canRebase: true,
      mergeDisabledReason: null,
      rebaseDisabledReason: null,
    })
  })

  it('allows dragged remote branch tips as merge sources', () => {
    const branches = [
      branch({ name: 'main', is_head: true, commit_oid: 'head' }),
      branch({ name: 'origin/dev', is_remote: true, commit_oid: 'remote' }),
    ]

    const state = buildDragActionState(branches, 'remote', 'base', 'head', false)

    expect(state.canMerge).toBe(true)
    expect(state.mergeSourceNames).toEqual(['origin/dev'])
  })

  it('disables merge when the dragged commit is not a branch tip', () => {
    const branches = [
      branch({ name: 'main', is_head: true, commit_oid: 'head' }),
      branch({ name: 'feature', commit_oid: 'feature' }),
    ]

    const state = buildDragActionState(branches, 'middle', 'feature', 'head', false)

    expect(state.canMerge).toBe(false)
    expect(state.mergeDisabledReason).toBe('no_source_branch')
  })

  it('disables merge when the dragged commit is the current branch tip', () => {
    const branches = [
      branch({ name: 'main', is_head: true, commit_oid: 'head' }),
      branch({ name: 'feature', commit_oid: 'feature' }),
    ]

    const state = buildDragActionState(branches, 'head', 'feature', 'head', false)

    expect(state.canMerge).toBe(false)
    expect(state.mergeDisabledReason).toBe('source_is_current_branch')
  })

  it('disables dragged actions while detached', () => {
    const branches = [
      branch({ name: 'origin/dev', is_remote: true, commit_oid: 'remote' }),
    ]

    const state = buildDragActionState(branches, 'remote', 'target', null, false)

    expect(state.currentBranchName).toBeNull()
    expect(state.canMerge).toBe(false)
    expect(state.canRebase).toBe(false)
    expect(state.mergeDisabledReason).toBe('detached')
    expect(state.rebaseDisabledReason).toBe('detached')
  })

  it('disables rebase when the dropped commit is HEAD', () => {
    const branches = [
      branch({ name: 'main', is_head: true, commit_oid: 'head' }),
      branch({ name: 'feature', commit_oid: 'feature' }),
    ]

    const state = buildDragActionState(branches, 'feature', 'head', 'head', false)

    expect(state.canRebase).toBe(false)
    expect(state.rebaseDisabledReason).toBe('target_is_head')
  })

  it('disables dragged actions during an ongoing operation', () => {
    const branches = [
      branch({ name: 'main', is_head: true, commit_oid: 'head' }),
      branch({ name: 'feature', commit_oid: 'feature' }),
    ]

    const state = buildDragActionState(branches, 'feature', 'base', 'head', true)

    expect(state.canMerge).toBe(false)
    expect(state.canRebase).toBe(false)
    expect(state.mergeDisabledReason).toBe('ongoing')
    expect(state.rebaseDisabledReason).toBe('ongoing')
  })
})
