import { describe, expect, it } from 'vitest'
import { marked } from 'marked'
import { renderMarkdown, safeExternalUrl } from './markdown'
import { detectPreviewKind } from './preview'

function render(source: string, remote = false) {
  const result = renderMarkdown(source, 'test', remote)
  const root = document.createElement('div')
  root.innerHTML = result.html
  return { ...result, root }
}

describe('Markdown rendering', () => {
  it('recognizes Markdown extensions case-insensitively without executing MDX', () => {
    for (const path of ['README.MD', 'doc.markdown', 'a.mdown', 'a.mkd', 'a.mkdn']) expect(detectPreviewKind(path)).toBe('markdown')
    expect(detectPreviewKind('a.mdx')).toBeNull()
    expect(detectPreviewKind('a.txt')).toBeNull()
  })
  it('renders GFM tables, task lists, deletion and nested Markdown', () => {
    const { root } = render('# Title\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n- [x] done\n- [ ] **pending**\n\n~~removed~~\n\n> quote\n\n<details><summary>More</summary>Details</details>')
    expect(root.querySelectorAll('td')).toHaveLength(2)
    expect(root.querySelectorAll('input:disabled')).toHaveLength(2)
    expect(root.querySelector('input:checked')).not.toBeNull()
    expect(root.querySelector('del')?.textContent).toBe('removed')
    expect(root.querySelector('strong')?.textContent).toBe('pending')
    expect(root.querySelector('details')).not.toBeNull()
  })
  it('preserves nested fenced blocks as typed code islands including Mermaid', () => {
    const result = render('> ```mermaid\n> graph LR\n> A-->B\n> ```\n\n```ts\nconst value = "<script>"\n```')
    expect(result.codes).toEqual([{ language: 'mermaid', text: 'graph LR\nA-->B' }, { language: 'ts', text: 'const value = "<script>"' }])
    expect(result.root.querySelector('blockquote [data-code-index="0"]')).not.toBeNull()
  })
  it('generates unique Unicode anchors and scopes IDs between panes', () => {
    const result = render('# 你好\n# 你好\n# 你好-1\n\n[go](#你好) [again](#你好-1)')
    expect(result.headings.map((h) => h.anchor)).toEqual(['你好', '你好-1', '你好-1-1'])
    expect(result.root.querySelector('a')?.getAttribute('href')).toBe('#test-heading-0')
    expect(renderMarkdown('# 你好', 'second', false).headings[0].id).toBe('second-heading-0')
  })
  it('strips executable HTML, CSS, application classes and spoofed code islands', () => {
    const { root, codes } = render('<script>alert(1)</script><style>body{display:none}</style><iframe src="x"></iframe><svg onload="alert(1)"></svg><div class="diff-view" data-code-index="0" style="position:fixed" onclick="alert(1)">safe</div><input type="text"><a href="javascript:alert(1)">bad</a>')
    expect(root.querySelector('script,style,iframe,svg,input')).toBeNull()
    expect(root.querySelector('[onclick],[style],.diff-view,[data-code-index]')).toBeNull()
    expect(root.querySelector('a')?.hasAttribute('href')).toBe(false)
    expect(codes).toHaveLength(0)
  })
  it('loads only opted-in HTTP images and never resolves relative paths against the app', () => {
    const source = '![remote](https://example.com/image.png) ![local](./image.png) ![file](file:///private/image.png)'
    const hidden = render(source)
    expect(hidden.root.querySelector('img')).toBeNull()
    expect(hidden.remoteImages).toBe(1)
    expect(hidden.relativeImages).toBe(2)
    const shown = render(source, true)
    expect(shown.root.querySelectorAll('img')).toHaveLength(1)
    expect(shown.root.querySelector('img')?.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(shown.root.querySelector('img')?.getAttribute('loading')).toBe('lazy')
  })
  it('isolates parser options from the release notes global Marked instance', () => {
    marked.use({ renderer: { heading: () => '<p>global renderer</p>' } })
    expect(render('# Local').root.querySelector('h1')?.textContent).toBe('Local')
  })
  it('rejects oversized and excessively dense documents', () => {
    expect(() => render('x'.repeat(600000))).toThrow('too-large')
    expect(() => render('<br>'.repeat(12001))).toThrow('too-large')
  })
  it('allows only explicit safe external protocols', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,hi', 'file:///etc/passwd', '//example.com', './README.md', '\nhttps://example.com']) expect(safeExternalUrl(url)).toBeNull()
    expect(safeExternalUrl('https://example.com/a')).toBe('https://example.com/a')
    expect(safeExternalUrl('mailto:user@example.com')).toBe('mailto:user@example.com')
  })
})
