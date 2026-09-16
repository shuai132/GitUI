import { Marked } from 'marked'
import DOMPurify from 'dompurify'
import { MAX_MARKDOWN_BYTES } from './markdownContent'

const parser = new Marked({ gfm: true, breaks: false })
const MAX_MARKDOWN_NODES = 12000

export interface MarkdownHeading { id: string; anchor: string; text: string; level: number }
export interface MarkdownCode { text: string; language: string }
export interface RenderedMarkdown {
  html: string
  headings: MarkdownHeading[]
  codes: MarkdownCode[]
  remoteImages: number
  relativeImages: number
}

export function safeExternalUrl(value: string): string | null {
  if (!/^(https?:|mailto:)/i.test(value)) return null
  try {
    const url = new URL(value)
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : null
  } catch {
    return null
  }
}

export function renderMarkdown(source: string, prefix: string, remoteImages: boolean): RenderedMarkdown {
  if (source.length > MAX_MARKDOWN_BYTES) throw new Error('too-large')
  const parsed = parser.parse(source, { async: false })
  const html = DOMPurify.sanitize(parsed, {
    ALLOWED_TAGS: ['p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'ul', 'ol', 'li', 'strong', 'em', 'del', 's', 'a', 'img', 'pre', 'code', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'input', 'details', 'summary', 'div', 'span', 'kbd', 'sup', 'sub', 'dl', 'dt', 'dd'],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'type', 'checked', 'disabled', 'start', 'align', 'open'],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  })
  const template = document.createElement('template')
  template.innerHTML = html
  const root = template.content
  if (root.querySelectorAll('*').length > MAX_MARKDOWN_NODES) throw new Error('too-large')
  // Source classes must not inherit application styles.
  root.querySelectorAll<HTMLElement>('[class]').forEach((node) => {
    const language = node.tagName === 'CODE' ? node.className.match(/(?:^|\s)language-([\w+-]+)/)?.[1] : null
    node.removeAttribute('class')
    if (language) node.className = `language-${language.toLowerCase()}`
  })
  const headings: MarkdownHeading[] = []
  const anchors = new Map<string, string>()
  const nextSuffix = new Map<string, number>()
  root.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6').forEach((node, index) => {
    const text = node.textContent ?? ''
    const base = text.toLowerCase().replace(/[^\p{L}\p{N}_\s-]/gu, '').replace(/\s/g, '-') || 'section'
    let anchor = base
    let suffix = nextSuffix.get(base) ?? 1
    while (anchors.has(anchor)) anchor = `${base}-${suffix++}`
    nextSuffix.set(base, suffix)
    node.id = `${prefix}-heading-${index}`
    anchors.set(anchor, node.id)
    headings.push({ id: node.id, anchor, text, level: Number(node.tagName[1]) })
  })
  root.querySelectorAll('input').forEach((node) => {
    if (node.type !== 'checkbox') { node.remove(); return }
    node.disabled = true
  })
  root.querySelectorAll('a').forEach((node) => {
    const href = node.getAttribute('href') ?? ''
    if (href.startsWith('#')) {
      try {
        const anchor = decodeURIComponent(href.slice(1))
        const target = anchors.get(anchor)
        if (target) node.setAttribute('href', `#${target}`)
        else node.dataset.unresolved = 'true'
      } catch { node.dataset.unresolved = 'true' }
    } else if (safeExternalUrl(href)) {
      node.setAttribute('href', safeExternalUrl(href)!)
      node.setAttribute('rel', 'noopener noreferrer')
    } else {
      node.removeAttribute('href')
      node.dataset.unresolved = 'true'
      node.setAttribute('role', 'link')
      node.tabIndex = 0
    }
  })
  let remoteCount = 0
  let relativeCount = 0
  root.querySelectorAll('img').forEach((node) => {
    const src = node.getAttribute('src') ?? ''
    const safe = /^https?:/i.test(src) && safeExternalUrl(src)
    if (safe && remoteImages) {
      node.src = safe
      node.setAttribute('loading', 'lazy')
      node.setAttribute('decoding', 'async')
      node.setAttribute('referrerpolicy', 'no-referrer')
    } else {
      if (safe) remoteCount++
      else relativeCount++
      const placeholder = document.createElement('span')
      placeholder.className = 'markdown-image-placeholder'
      placeholder.textContent = `[${node.alt || src}]`
      node.replaceWith(placeholder)
    }
  })
  const codes: MarkdownCode[] = []
  root.querySelectorAll('pre').forEach((node) => {
    const code = node.querySelector('code')
    const index = codes.length
    codes.push({ text: (code ?? node).textContent?.replace(/\n$/, '') ?? '', language: code?.className.replace('language-', '') ?? '' })
    const slot = document.createElement('div')
    slot.dataset.codeIndex = String(index)
    node.replaceWith(slot)
  })
  return { html: template.innerHTML, headings, codes, remoteImages: remoteCount, relativeImages: relativeCount }
}
