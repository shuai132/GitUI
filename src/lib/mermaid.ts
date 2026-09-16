import type { MermaidConfig } from 'mermaid'

export const MAX_MERMAID_CHARS = 20000
let sequence = 0
let queue: Promise<unknown> = Promise.resolve()

// initialize + render share Mermaid global state. Serialize both across all previews.
export function renderMermaid(source: string, dark: boolean, isCurrent: () => boolean): Promise<string | null> {
  const task = queue.then(async () => {
    if (!isCurrent()) return null
    if (source.length > MAX_MERMAID_CHARS) throw new Error('too-large')
    const { default: mermaid } = await import('mermaid')
    if (!isCurrent()) return null
    const config: MermaidConfig = {
      startOnLoad: false,
      securityLevel: 'strict',
      theme: dark ? 'dark' : 'default',
      fontFamily: 'Arial, sans-serif',
      htmlLabels: false,
      maxTextSize: MAX_MERMAID_CHARS,
      maxEdges: 300,
      suppressErrorRendering: true,
      // Repository directives cannot weaken security, resource bounds or theme isolation.
      secure: ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'maxEdges', 'suppressErrorRendering', 'theme', 'themeCSS', 'themeVariables', 'fontFamily', 'htmlLabels'],
    }
    mermaid.initialize(config)
    const container = document.createElement('div')
    container.style.cssText = 'position:fixed;left:-100000px;top:0;visibility:hidden;'
    document.body.appendChild(container)
    try {
      const { svg } = await mermaid.render(`gitui-mermaid-${++sequence}`, source, container)
      if (!isCurrent()) return null
      // SVG image documents isolate styles/scripts and cannot load external resources.
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
    } finally {
      container.remove()
    }
  })
  queue = task.catch(() => {})
  return task
}
