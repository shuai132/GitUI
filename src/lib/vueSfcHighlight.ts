export type VueSfcBlockLang = 'html' | 'javascript' | 'typescript' | 'css'

export interface VueSfcLineLangMap {
  langForLine(lineNo: number | null | undefined): VueSfcBlockLang | null
}

const BLOCK_START_RE = /<\s*(template|script|style)\b([^>]*)>/i
const BLOCK_END_RE = /<\s*\/\s*(template|script|style)\s*>/i

export function isVuePath(path: string | null | undefined): boolean {
  return (path ?? '').toLowerCase().endsWith('.vue')
}

export function createVueSfcLineLangMap(content: string | null | undefined): VueSfcLineLangMap | null {
  if (content == null) return null

  const langs: Array<VueSfcBlockLang | null> = []
  const lines = content.split(/\r\n|\n|\r/)
  let current: VueSfcBlockLang | null = null
  let currentTag: 'template' | 'script' | 'style' | null = null

  for (const line of lines) {
    const start = line.match(BLOCK_START_RE)
    const end = line.match(BLOCK_END_RE)
    const lineLang = current ?? (start ? langForStartTag(start[1].toLowerCase(), start[2] ?? '') : null)

    langs.push(lineLang)

    const endTag = end?.[1].toLowerCase() ?? null
    const startTag = start?.[1].toLowerCase() ?? null

    if (endTag && currentTag === endTag) {
      current = null
      currentTag = null
    }

    if (start && !isSelfClosingTag(line) && startTag !== endTag) {
      const tag = start[1].toLowerCase()
      currentTag = tag === 'template' || tag === 'script' || tag === 'style' ? tag : null
      current = langForStartTag(tag, start[2] ?? '')
    }
  }

  return {
    langForLine(lineNo) {
      if (lineNo == null || lineNo < 1) return null
      return langs[lineNo - 1] ?? null
    },
  }
}

function langForStartTag(tag: string, attrs: string): VueSfcBlockLang | null {
  if (tag === 'template') return 'html'
  if (tag === 'style') return 'css'
  if (tag === 'script') return /\blang\s*=\s*["']?ts["']?/i.test(attrs) ? 'typescript' : 'javascript'
  return null
}

function isSelfClosingTag(line: string): boolean {
  return /\/\s*>\s*$/.test(line)
}
