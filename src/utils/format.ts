import { t, i18n } from '@/i18n'

export function formatTime(seconds: number): string {
  const now = Math.floor(Date.now() / 1000)
  const diff = now - seconds

  if (diff < 60) return t('time.justNow')
  if (diff < 3600) return t('time.minutesAgo', { n: Math.floor(diff / 60) })
  if (diff < 86400) return t('time.hoursAgo', { n: Math.floor(diff / 3600) })
  if (diff < 604800) return t('time.daysAgo', { n: Math.floor(diff / 86400) })

  const date = new Date(seconds * 1000)
  return t('time.date', {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    time: '',
  }).trim()
}

export function formatAbsoluteTime(seconds: number): string {
  const date = new Date(seconds * 1000)
  return date.toLocaleString(i18n.global.locale.value as string)
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
  if (sameDay) return t('time.today', { time: `${hh}:${mm}` })
  return t('time.date', {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
    time: `${hh}:${mm}`,
  })
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
