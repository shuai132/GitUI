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

/**
 * 历史列表日期格式：今天显示 "今天 HH:MM"，其他显示 "YYYY年M月D日 HH:MM"。
 */
export function formatHistoryTime(seconds: number): string {
  const d = new Date(seconds * 1000)
  const now = new Date()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  if (sameDay) return `今天 ${hh}:${mm}`
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${hh}:${mm}`
}

/**
 * 作者格式："name <email>"；email 缺失时仅返回 name。
 */
export function formatAuthor(name: string, email?: string | null): string {
  const n = (name ?? '').trim()
  const e = (email ?? '').trim()
  if (!e) return n
  return `${n} <${e}>`
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
