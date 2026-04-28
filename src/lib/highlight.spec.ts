import { describe, expect, it } from 'vitest'
import { detectLangByPath, highlightLine } from './highlight'
import { createVueSfcLineLangMap } from './vueSfcHighlight'

describe('highlight', () => {
  it('detects Vue single-file components as a mixed language', () => {
    expect(detectLangByPath('src/App.vue')).toBe('vue')
  })

  it('maps Vue single-file component blocks by line number', () => {
    const map = createVueSfcLineLangMap([
      '<template>',
      '  <div>{{ count }}</div>',
      '</template>',
      '',
      '<script setup lang="ts">',
      'const count = ref<number>(0)',
      '</script>',
      '',
      '<style scoped>',
      '.count {',
      '  color: var(--text-primary);',
      '}',
      '</style>',
    ].join('\n'))

    expect(map?.langForLine(2)).toBe('html')
    expect(map?.langForLine(6)).toBe('typescript')
    expect(map?.langForLine(11)).toBe('css')
  })

  it('maps plain Vue script blocks to JavaScript', () => {
    const map = createVueSfcLineLangMap([
      '<script>',
      'const message = "hello"',
      '</script>',
    ].join('\n'))

    expect(map?.langForLine(2)).toBe('javascript')
  })

  it('highlights Vue block lines with the mapped language', () => {
    const scriptHtml = highlightLine('const count = ref<number>(0)', 'typescript')
    const styleHtml = highlightLine('color: var(--text-primary);', 'css')

    expect(scriptHtml).toContain('hljs-keyword')
    expect(scriptHtml).toContain('hljs-built_in')
    expect(styleHtml).toContain('hljs-attribute')
  })
})
