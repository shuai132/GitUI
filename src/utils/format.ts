export function formatTime(seconds: number): string {
  const now = Math.floor(Date.now() / 1000)
  const diff = now - seconds

  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`
  if (diff < 604800) return `${Math.floor(diff / 86400)} 天前`

  const date = new Date(seconds * 1000)
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

export function formatAbsoluteTime(seconds: number): string {
  const date = new Date(seconds * 1000)
  return date.toLocaleString('zh-CN')
}

export function shortOid(oid: string): string {
  return oid.slice(0, 7)
}

export function fileStatusLabel(status: string): string {
  const map: Record<string, string> = {
    added: 'A',
    modified: 'M',
    deleted: 'D',
    renamed: 'R',
    untracked: '?',
    conflicted: 'C',
  }
  return map[status] ?? '?'
}

export function fileStatusColor(status: string): string {
  const map: Record<string, string> = {
    added: 'var(--accent-green)',
    modified: 'var(--accent-yellow)',
    deleted: 'var(--accent-red)',
    renamed: 'var(--accent-blue)',
    untracked: 'var(--text-muted)',
    conflicted: 'var(--accent-orange)',
  }
  return map[status] ?? 'var(--text-muted)'
}
