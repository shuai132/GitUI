import DOMPurify from 'dompurify'
import { Marked, type MarkedExtension, type Tokens } from 'marked'
import { detectLangByPath, highlightLine } from '@/lib/highlight'

export function isSafeExternalMarkdownUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:'
  } catch {
    return false
  }
}

export function renderMarkdownPreview(source: string, highlightEnabled: boolean): string {
  const parser = new Marked(markdownExtension(highlightEnabled))
  const rawHtml = parser.parse(source, { async: false })
  return DOMPurify.sanitize(rawHtml, {
    ALLOW_DATA_ATTR: true,
    FORBID_ATTR: ['style'],
    FORBID_TAGS: [
      'button',
      'embed',
      'form',
      'iframe',
      'img',
      'input',
      'object',
      'script',
      'select',
      'style',
      'textarea',
    ],
  })
}

function markdownExtension(highlightEnabled: boolean): MarkedExtension<string, string> {
  return {
    async: false,
    gfm: true,
    renderer: {
      code(token: Tokens.Code): string {
        const lang = normalizeMarkdownLang(token.lang)
        const html = highlightEnabled && lang
          ? highlightCodeBlock(token.text, lang)
          : escapeHtml(token.text)
        const langClass = lang ? ` language-${escapeAttr(lang)}` : ''
        return `<pre><code class="hljs${langClass}">${html}</code></pre>`
      },
      link(token: Tokens.Link): string {
        const label = token.text ? escapeHtml(token.text) : escapeHtml(token.href)
        if (!isSafeExternalMarkdownUrl(token.href)) {
          return `<span class="markdown-link markdown-link--disabled">${label}</span>`
        }

        const title = token.title ? ` title="${escapeAttr(token.title)}"` : ''
        return [
          `<a href="${escapeAttr(token.href)}"`,
          title,
          ' target="_blank" rel="noopener noreferrer"',
          ' data-markdown-link="external"',
          `>${label}</a>`,
        ].join('')
      },
      image(token: Tokens.Image): string {
        const label = token.text || token.href || 'image'
        return `<span class="markdown-image-placeholder">[image: ${escapeHtml(label)}]</span>`
      },
    },
  }
}

function normalizeMarkdownLang(lang: string | undefined): string | null {
  if (!lang) return null
  const firstLang = lang.trim().split(/\s+/)[0]?.toLowerCase()
  if (!firstLang) return null
  return detectLangByPath(`file.${firstLang}`) ?? firstLang
}

function highlightCodeBlock(content: string, lang: string): string {
  return content
    .split(/\r\n|\n|\r/)
    .map((line) => highlightLine(line, lang))
    .join('\n')
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, '&quot;')
}
