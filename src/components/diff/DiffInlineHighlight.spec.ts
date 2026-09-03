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

  it('pairs every deleted and added line within an inline change run', () => {
    const wrapper = mount(InlineDiff, {
      props: {
        diff: cmakeFlagsDiff(),
        groupByHunk: true,
        syntaxLang: null,
      },
      global: { plugins: [i18n] },
    })

    const changedLines = wrapper.findAll('.hunk-block .inline-line .code')
    expect(changedLines).toHaveLength(4)
    expect(markTexts(changedLines[0].element, 'word-add')).toEqual([''])
    expect(markTexts(changedLines[1].element, 'word-del')).toEqual(['_C'])
    expect(markTexts(changedLines[2].element, 'word-add')).toEqual([',undefined'])
    expect(markTexts(changedLines[3].element, 'word-add')).toEqual(['_CXX', ',undefined'])
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

function cmakeFlagsDiff(): FileDiff {
  return {
    old_path: 'CMakeLists.txt',
    new_path: 'CMakeLists.txt',
    is_binary: false,
    hunks: [{
      old_start: 10,
      old_lines: 2,
      new_start: 10,
      new_lines: 2,
      header: '@@ -10,2 +10,2 @@',
      lines: [
        {
          origin: '-',
          content: '    set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -fsanitize=address")\n',
          old_lineno: 10,
        },
        {
          origin: '-',
          content: '    set(CMAKE_CXX_FLAGS "${CMAKE_C_FLAGS} -fsanitize=address")\n',
          old_lineno: 11,
        },
        {
          origin: '+',
          content: '    set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -fsanitize=address,undefined")\n',
          new_lineno: 10,
        },
        {
          origin: '+',
          content: '    set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -fsanitize=address,undefined")\n',
          new_lineno: 11,
        },
      ],
    }],
    additions: 2,
    deletions: 2,
    old_blob_oid: 'old',
    new_blob_oid: 'new',
    encoding: 'UTF-8',
  }
}

function markTexts(element: Element, className: string): string[] {
  return Array.from(element.querySelectorAll(`mark.${className}`)).map(
    (mark) => mark.textContent ?? '',
  )
}
