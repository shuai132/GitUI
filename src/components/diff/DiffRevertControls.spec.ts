// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { i18n } from '@/i18n'
import type { DiffHunk, FileDiff } from '@/types/git'
import InlineDiff from './InlineDiff.vue'
import SideBySideDiff from './SideBySideDiff.vue'

describe('diff hunk rollback controls', () => {
  it('hides inline rollback controls when hunk grouping is off', () => {
    const wrapper = mount(InlineDiff, {
      props: {
        diff: fileDiff(),
        groupByHunk: false,
        allowRevert: true,
      },
      global: { plugins: [i18n] },
    })

    expect(wrapper.find('.hunk-revert-btn').exists()).toBe(false)
  })

  it('shows inline rollback controls when hunk grouping is on', () => {
    const wrapper = mount(InlineDiff, {
      props: {
        diff: fileDiff(),
        groupByHunk: true,
        allowRevert: true,
      },
      global: { plugins: [i18n] },
    })

    expect(wrapper.find('.hunk-revert-btn').exists()).toBe(true)
  })

  it('hides side-by-side rollback controls when hunk grouping is off', () => {
    const wrapper = mount(SideBySideDiff, {
      props: {
        diff: fileDiff(),
        groupByHunk: false,
        allowRevert: true,
        fullFileContent: {
          oldText: 'one\ntwo\n',
          newText: 'one\nTWO\n',
        },
      },
      global: { plugins: [i18n] },
    })

    expect(wrapper.find('.hunk-revert-btn').exists()).toBe(false)
  })

  it('shows side-by-side rollback controls when hunk grouping is on', () => {
    const wrapper = mount(SideBySideDiff, {
      props: {
        diff: fileDiff(),
        groupByHunk: true,
        allowRevert: true,
      },
      global: { plugins: [i18n] },
    })

    expect(wrapper.find('.hunk-revert-btn').exists()).toBe(true)
  })
})

function fileDiff(hunks: DiffHunk[] = [changedLineHunk()]): FileDiff {
  return {
    old_path: 'file.txt',
    new_path: 'file.txt',
    is_binary: false,
    hunks,
    additions: 1,
    deletions: 1,
    old_blob_oid: 'old',
    new_blob_oid: 'new',
    encoding: 'UTF-8',
  }
}

function changedLineHunk(): DiffHunk {
  return {
    old_start: 2,
    old_lines: 1,
    new_start: 2,
    new_lines: 1,
    header: '@@ -2 +2 @@',
    lines: [
      { origin: '-', content: 'two\n', old_lineno: 2 },
      { origin: '+', content: 'TWO\n', new_lineno: 2 },
    ],
  }
}
