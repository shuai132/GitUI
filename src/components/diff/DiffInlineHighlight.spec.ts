// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { i18n } from '@/i18n'
import type { DiffHunk, FileDiff } from '@/types/git'
import InlineDiff from './InlineDiff.vue'
import SideBySideDiff from './SideBySideDiff.vue'

describe('diff inline change highlighting', () => {
  it('shows changed characters in side-by-side syntax-highlighted diffs', () => {
    const wrapper = mount(SideBySideDiff, {
      props: {
        diff: fileDiff(),
        groupByHunk: true,
        syntaxLang: 'dart',
      },
      global: { plugins: [i18n] },
    })

    expect(wrapper.find('mark.word-del').exists()).toBe(true)
    expect(wrapper.find('mark.word-add').exists()).toBe(true)
    expect(wrapper.html()).toContain('hljs')
  })

  it('shows changed characters in inline continuous mode', () => {
    const wrapper = mount(InlineDiff, {
      props: {
        diff: fileDiff(),
        groupByHunk: false,
        syntaxLang: 'dart',
      },
      global: { plugins: [i18n] },
    })

    expect(wrapper.find('mark.word-del').exists()).toBe(true)
    expect(wrapper.find('mark.word-add').exists()).toBe(true)
    expect(wrapper.html()).toContain('hljs')
  })

  it('shows changed characters in inline hunk-grouped mode', () => {
    const wrapper = mount(InlineDiff, {
      props: {
        diff: fileDiff(),
        groupByHunk: true,
        syntaxLang: 'dart',
      },
      global: { plugins: [i18n] },
    })

    expect(wrapper.find('.hunk-block mark.word-del').exists()).toBe(true)
    expect(wrapper.find('.hunk-block mark.word-add').exists()).toBe(true)
    expect(wrapper.html()).toContain('hljs')
  })
})

function fileDiff(): FileDiff {
  return {
    old_path: 'model.dart',
    new_path: 'model.dart',
    is_binary: false,
    hunks: [changedLineHunk()],
    additions: 1,
    deletions: 1,
    old_blob_oid: 'old',
    new_blob_oid: 'new',
    encoding: 'UTF-8',
  }
}

function changedLineHunk(): DiffHunk {
  return {
    old_start: 3,
    old_lines: 1,
    new_start: 3,
    new_lines: 1,
    header: '@@ -3 +3 @@',
    lines: [
      { origin: '-', content: 'class AiModelKeyword extends ConvertInterface{\n', old_lineno: 3 },
      { origin: '+', content: 'class AiModelKeyword extends JsonInterface {\n', new_lineno: 3 },
    ],
  }
}
