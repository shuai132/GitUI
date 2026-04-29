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
        hunkActionLabel: 'Rollback hunk',
      },
      global: { plugins: [i18n] },
    })

    expect(wrapper.find('.hunk-action-btn').exists()).toBe(false)
  })

  it('shows inline rollback controls when hunk grouping is on', () => {
    const wrapper = mount(InlineDiff, {
      props: {
        diff: fileDiff(),
        groupByHunk: true,
        hunkActionLabel: 'Rollback hunk',
      },
      global: { plugins: [i18n] },
    })

    expect(wrapper.find('.hunk-action-btn').exists()).toBe(true)
  })

  it('hides side-by-side rollback controls when hunk grouping is off', () => {
    const wrapper = mount(SideBySideDiff, {
      props: {
        diff: fileDiff(),
        groupByHunk: false,
        hunkActionLabel: 'Rollback hunk',
        fullFileContent: {
          oldText: 'one\ntwo\n',
          newText: 'one\nTWO\n',
        },
      },
      global: { plugins: [i18n] },
    })

    expect(wrapper.find('.hunk-action-btn').exists()).toBe(false)
  })

  it('shows side-by-side rollback controls when hunk grouping is on', () => {
    const wrapper = mount(SideBySideDiff, {
      props: {
        diff: fileDiff(),
        groupByHunk: true,
        hunkActionLabel: 'Rollback hunk',
      },
      global: { plugins: [i18n] },
    })

    expect(wrapper.find('.hunk-action-btn').exists()).toBe(true)
  })

  it('uses the provided hunk action label', () => {
    const wrapper = mount(InlineDiff, {
      props: {
        diff: fileDiff(),
        groupByHunk: true,
        hunkActionLabel: 'Stage hunk',
      },
      global: { plugins: [i18n] },
    })

    expect(wrapper.find('.hunk-action-btn').text()).toBe('Stage hunk')
  })

  it('shows a separate inline discard hunk control', () => {
    const wrapper = mount(InlineDiff, {
      props: {
        diff: fileDiff(),
        groupByHunk: true,
        hunkActionLabel: 'Unstage hunk',
        hunkDiscardLabel: 'Discard hunk',
      },
      global: { plugins: [i18n] },
    })

    const buttons = wrapper.findAll('.hunk-action-btn')
    expect(buttons).toHaveLength(2)
    expect(buttons[0].text()).toBe('Unstage hunk')
    expect(buttons[1].text()).toBe('Discard hunk')
  })

  it('emits a separate discard event from inline diff', async () => {
    const wrapper = mount(InlineDiff, {
      props: {
        diff: fileDiff(),
        groupByHunk: true,
        hunkDiscardLabel: 'Discard hunk',
      },
      global: { plugins: [i18n] },
    })

    await wrapper.find('.hunk-action-btn--danger').trigger('click')

    expect(wrapper.emitted('hunk-discard')).toEqual([[0]])
    expect(wrapper.emitted('hunk-action')).toBeUndefined()
  })

  it('shows a separate side-by-side discard hunk control', () => {
    const wrapper = mount(SideBySideDiff, {
      props: {
        diff: fileDiff(),
        groupByHunk: true,
        hunkActionLabel: 'Unstage hunk',
        hunkDiscardLabel: 'Discard hunk',
      },
      global: { plugins: [i18n] },
    })

    const buttons = wrapper.findAll('.hunk-action-btn')
    expect(buttons).toHaveLength(2)
    expect(buttons[0].text()).toBe('Unstage hunk')
    expect(buttons[1].text()).toBe('Discard hunk')
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
