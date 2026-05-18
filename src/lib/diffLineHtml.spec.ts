import { describe, expect, it } from 'vitest'
import { diffLinePairHtml } from './diffLineHtml'

describe('diffLineHtml', () => {
  it('combines syntax highlighting with changed character marks', () => {
    const { leftHtml, rightHtml } = diffLinePairHtml(
      'const value = oldName',
      'const value = newName',
      'typescript',
      'typescript',
    )

    expect(leftHtml).toContain('hljs-keyword')
    expect(rightHtml).toContain('hljs-keyword')
    expect(leftHtml).toContain('word-del')
    expect(rightHtml).toContain('word-add')
    expect(textContent(leftHtml)).toBe('const value = oldName')
    expect(textContent(rightHtml)).toBe('const value = newName')
  })

  it('keeps escaped code text safe when marking syntax-highlighted changes', () => {
    const { leftHtml, rightHtml } = diffLinePairHtml(
      'return value < oldLimit && ok',
      'return value < newLimit && ok',
      'typescript',
      'typescript',
    )

    expect(leftHtml).toContain('&lt;')
    expect(rightHtml).toContain('&lt;')
    expect(leftHtml).not.toContain('< oldLimit')
    expect(rightHtml).not.toContain('< newLimit')
    expect(textContent(leftHtml)).toBe('return value < oldLimit && ok')
    expect(textContent(rightHtml)).toBe('return value < newLimit && ok')
  })

  it('marks tiny spacing changes at character precision', () => {
    const { rightHtml } = diffLinePairHtml(
      'class A extends B{',
      'class A extends B {',
      'dart',
      'dart',
    )

    expect(rightHtml).toContain('word-add')
    expect(textContent(rightHtml)).toBe('class A extends B {')
  })

  it('skips inline marks when paired lines are not similar enough', () => {
    const { leftHtml, rightHtml } = diffLinePairHtml(
      'a31bf88a19a4ef3f97628db70457b4d286382789',
      'eb162973c80afc474e1440b0b42ea533b7adbcf3',
      null,
      null,
    )

    expect(leftHtml).not.toContain('word-del')
    expect(rightHtml).not.toContain('word-add')
    expect(textContent(leftHtml)).toBe('a31bf88a19a4ef3f97628db70457b4d286382789')
    expect(textContent(rightHtml)).toBe('eb162973c80afc474e1440b0b42ea533b7adbcf3')
  })

  it('marks deleted suffixes and inserted name parts in similar callback declarations', () => {
    const { leftHtml, rightHtml } = diffLinePairHtml(
      'typedef void (*claw_stream_callback_v2)(const char *run_id, const char *chunk, bool done);',
      'typedef void (*claw_message_stream_callback)(const char *run_id, const char *chunk, bool done);',
      'cpp',
      'cpp',
    )

    expect(markTexts(leftHtml, 'word-del')).toContain('_v2')
    expect(markTexts(rightHtml, 'word-add')).toContain('_message')
    expect(textContent(leftHtml)).toBe(
      'typedef void (*claw_stream_callback_v2)(const char *run_id, const char *chunk, bool done);',
    )
    expect(textContent(rightHtml)).toBe(
      'typedef void (*claw_message_stream_callback)(const char *run_id, const char *chunk, bool done);',
    )
  })

  it('prefers whole word-like tokens over scattered character matches', () => {
    const { leftHtml, rightHtml } = diffLinePairHtml(
      'private var _globalOnChunk: ((String, Bool) -> Void)?',
      'private var _streamCallbacks: [String: (String, Bool) -> Void] = [:]',
      'swift',
      'swift',
    )

    expect(markTexts(leftHtml, 'word-del')).toContain('_globalOnChunk')
    expect(markTexts(rightHtml, 'word-add')).toContain('_streamCallbacks')
    expect(markTexts(rightHtml, 'word-add')).toContain('[')
    expect(markTexts(rightHtml, 'word-add').join('')).toContain('] = [:]')
    expect(textContent(leftHtml)).toBe('private var _globalOnChunk: ((String, Bool) -> Void)?')
    expect(textContent(rightHtml)).toBe('private var _streamCallbacks: [String: (String, Bool) -> Void] = [:]')
  })

  it('matches Chinese text by individual Han characters instead of whole words', () => {
    const { leftHtml, rightHtml } = diffLinePairHtml(
      '提交失败，请稍后重试',
      '提交成功，请稍后重试',
      null,
      null,
    )

    expect(textContent(leftHtml)).toBe('提交失败，请稍后重试')
    expect(textContent(rightHtml)).toBe('提交成功，请稍后重试')
    expect(markTexts(leftHtml, 'word-del')).toEqual(['失败'])
    expect(markTexts(rightHtml, 'word-add')).toEqual(['成功'])
  })

  it('shows a placeholder only on the new side when old content was removed', () => {
    const { leftHtml, rightHtml } = diffLinePairHtml(
      'const rawText = code.textContent || ""',
      'const rawText = code || ""',
      'typescript',
      'typescript',
    )

    expect(markTexts(leftHtml, 'word-del').join('')).toContain('.textContent')
    expect(leftHtml).not.toContain('word-placeholder')
    expect(rightHtml).toContain('word-del word-placeholder')
    expect(textContent(leftHtml)).toBe('const rawText = code.textContent || ""')
    expect(textContent(rightHtml)).toBe('const rawText = code || ""')
  })

  it('shows one placeholder only on the old side when new content was inserted', () => {
    const { leftHtml, rightHtml } = diffLinePairHtml(
      '<div class="canvas-preview"></div>',
      '<div ref="previewContainer" class="canvas-preview"></div>',
      'html',
      'html',
    )

    expect(leftHtml).toContain('word-add')
    expect(leftHtml.match(/word-add word-placeholder/g) ?? []).toHaveLength(1)
    expect(rightHtml).not.toContain('word-placeholder')
    expect(textContent(leftHtml)).toBe('<div class="canvas-preview"></div>')
    expect(textContent(rightHtml)).toBe('<div ref="previewContainer" class="canvas-preview"></div>')
  })

  it('marks only the inserted lambda capture name inside empty captures', () => {
    const { leftHtml, rightHtml } = diffLinePairHtml(
      '        [](std::shared_ptr<int> task) {',
      '        [iterations](std::shared_ptr<int> task) {',
      'cpp',
      'cpp',
    )

    expect(markTexts(leftHtml, 'word-del')).toEqual([])
    expect(markTexts(rightHtml, 'word-add')).toEqual(['iterations'])
    expect(textContent(leftHtml)).toBe('        [](std::shared_ptr<int> task) {')
    expect(textContent(rightHtml)).toBe('        [iterations](std::shared_ptr<int> task) {')
  })

  it('does not add empty markers when both sides have changed content', () => {
    const { leftHtml, rightHtml } = diffLinePairHtml(
      'rightToken',
      'leftToken',
      null,
      null,
    )

    expect(leftHtml).toContain('word-del')
    expect(rightHtml).toContain('word-add')
    expect(leftHtml).not.toContain('word-placeholder')
    expect(rightHtml).not.toContain('word-placeholder')
    expect(textContent(leftHtml)).toBe('rightToken')
    expect(textContent(rightHtml)).toBe('leftToken')
  })

  it('does not add empty markers for replacement runs with different token counts', () => {
    const { leftHtml, rightHtml } = diffLinePairHtml(
      "import { diffChars, tokensToHtml } from '@/lib/wordDiff'",
      "import { diffLinePairHtml } from '@/lib/diffLineHtml'",
      'typescript',
      'typescript',
    )

    expect(leftHtml).toContain('word-del')
    expect(rightHtml).toContain('word-add')
    expect(leftHtml).not.toContain('word-placeholder')
    expect(rightHtml).not.toContain('word-placeholder')
    expect(textContent(leftHtml)).toBe("import { diffChars, tokensToHtml } from '@/lib/wordDiff'")
    expect(textContent(rightHtml)).toBe("import { diffLinePairHtml } from '@/lib/diffLineHtml'")
  })

  it('keeps whole-line fallback markers for long paired lines', () => {
    const left = `const data = "${'a'.repeat(520)}x";`
    const right = `const data = "${'a'.repeat(520)}y";`

    const { leftHtml, rightHtml } = diffLinePairHtml(left, right, 'typescript', 'typescript')

    expect(leftHtml).toContain('word-del')
    expect(rightHtml).toContain('word-add')
    expect(textContent(leftHtml)).toBe(left)
    expect(textContent(rightHtml)).toBe(right)
  })
})

function textContent(html: string): string {
  const div = document.createElement('div')
  div.innerHTML = html
  return div.textContent ?? ''
}

function markTexts(html: string, className: string): string[] {
  const div = document.createElement('div')
  div.innerHTML = html
  return Array.from(div.querySelectorAll(`mark.${className}`)).map((mark) => mark.textContent ?? '')
}
