/**
 * 把原始错误（Tauri rejection / Error 实例 / 字符串）映射成 i18n key。
 *
 * 输入格式多样：
 *   - GitError 变体对象：{ RepoNotFound: "..." }、{ OperationFailed: "..." }、{ Git2: "..." }
 *   - 普通 Error：`new Error("...")`
 *   - 字符串
 *
 * 规则按优先级：
 *   1. 结构化变体 → 按 kind 分类 → errors.generic.*
 *   2. 原始消息子串命中 → 已知 git2 pattern → errors.<domain>.<reason>
 *   3. 兜底 → errors.generic.unknown，params.detail 带原文
 *
 * 调用端负责用 i18n t() 渲染 key。未命中 key 时应显示 fallbackText。
 * 新 IPC 命令不必先改这里。
 */

type GitErrorKind =
  | 'RepoNotFound'
  | 'RepoNotOpen'
  | 'InvalidPath'
  | 'OperationFailed'
  | 'Git2'
  | 'Io'

export interface FriendlyError {
  /** i18n key，如 'errors.auth.failed' */
  key: string
  /** t(key, params) 参数（用于带 {detail} / {path} / {type} 的 key） */
  params?: Record<string, unknown>
  /** key 缺失翻译时的兜底原文（通常是清理后的原始 message） */
  fallbackText?: string
}

function extractKindAndMessage(raw: unknown): { kind?: GitErrorKind; message: string } {
  // GitError 枚举序列化后是 { VariantName: "..." } 的单键对象
  if (raw && typeof raw === 'object' && !(raw instanceof Error)) {
    const keys = Object.keys(raw as Record<string, unknown>)
    if (keys.length === 1) {
      const kind = keys[0] as GitErrorKind
      const value = (raw as Record<string, unknown>)[kind]
      if (typeof value === 'string') {
        return { kind, message: value }
      }
    }
  }

  if (raw instanceof Error) {
    return { message: raw.message }
  }

  if (typeof raw === 'string') {
    return { message: raw }
  }

  try {
    return { message: JSON.stringify(raw) }
  } catch {
    return { message: String(raw) }
  }
}

/** 按子串命中的模式规则，越靠前优先级越高。build(msg) 返回 FriendlyError。 */
const PATTERNS: Array<{ test: (msg: string) => boolean; build: (msg: string) => FriendlyError }> = [
  // 认证失败
  {
    test: (m) => /authentication required|authentication failed|401|403/i.test(m),
    build: () => ({ key: 'errors.auth.failed' }),
  },
  // 远端不存在
  {
    test: (m) => /remote ['"]?(\w+)['"]? does not exist|no such remote/i.test(m),
    build: () => ({ key: 'errors.remote.notFound' }),
  },
  // 分支/引用已存在
  {
    test: (m) => /reference .* already exists/i.test(m) || /already exists/i.test(m),
    build: () => ({ key: 'errors.ref.alreadyExists' }),
  },
  // 分支/引用找不到
  {
    test: (m) => /reference .* not found|no such (branch|reference)/i.test(m),
    build: () => ({ key: 'errors.ref.notFound' }),
  },
  // force-with-lease 被拒（远端已有新 commit）
  {
    test: (m) => /stale info|fetch first/i.test(m),
    build: () => ({ key: 'errors.push.forceWithLeaseRejected' }),
  },
  // 非 fast-forward
  {
    test: (m) => /non[- ]?fast[- ]?forward|cannot fast-forward/i.test(m),
    build: () => ({ key: 'errors.push.nonFastForward' }),
  },
  // Pull 需要 merge
  {
    test: (m) => /Merge required/i.test(m),
    build: () => ({ key: 'errors.pull.mergeRequired' }),
  },
  // Cannot fast-forward (diverged)
  {
    test: (m) => /Cannot fast-forward.*diverged/i.test(m),
    build: () => ({ key: 'errors.pull.diverged' }),
  },
  // Rebase 冲突
  {
    test: (m) => /Rebase conflict/i.test(m),
    build: () => ({ key: 'errors.rebase.conflict' }),
  },
  // Rebase 工作区不干净
  {
    test: (m) => /Cannot rebase.*uncommitted/i.test(m),
    build: () => ({ key: 'errors.rebase.dirtyWorktree' }),
  },
  // Cherry-pick / revert 冲突（后端 OperationFailed 自定义中文消息）—— 优先级高于通用冲突
  {
    test: (m) => /Cherry-pick 出现冲突|Revert 出现冲突/.test(m),
    build: (m) => ({
      key: 'errors.cherrypick.conflict',
      params: { type: m.includes('Revert') ? 'revert' : 'cherry-pick' },
      fallbackText: m,
    }),
  },
  // 通用冲突
  {
    test: (m) => /conflict|needs merge/i.test(m),
    build: () => ({ key: 'errors.merge.conflict' }),
  },
  // 工作区有未提交变更
  {
    test: (m) => /uncommitted|unstaged|working (tree|directory) (is )?dirty|local changes/i.test(m),
    build: () => ({ key: 'errors.worktree.dirty' }),
  },
  // signature not found（git config user.name/email 缺失）
  {
    test: (m) => /config value .* not found|user\.(name|email)|no name was given/i.test(m),
    build: () => ({ key: 'errors.config.missingUser' }),
  },
  // Repo 未打开 / 无效路径
  {
    test: (m) => /not a git repository|could not find repository/i.test(m),
    build: () => ({ key: 'errors.repo.invalid' }),
  },
  // 网络
  {
    test: (m) => /network|failed to connect|timed out|dns|resolve/i.test(m),
    build: () => ({ key: 'errors.network.failed' }),
  },
]

export function mapGitError(_op: string, raw: unknown): FriendlyError {
  const { kind, message } = extractKindAndMessage(raw)

  // 1. GitError 变体
  if (kind === 'RepoNotFound') return { key: 'errors.generic.repoNotFound' }
  if (kind === 'RepoNotOpen') return { key: 'errors.generic.repoNotOpen' }
  if (kind === 'InvalidPath') {
    return { key: 'errors.generic.invalidPath', params: { path: truncate(message, 80) } }
  }
  if (kind === 'Io') {
    return { key: 'errors.generic.io', params: { detail: truncate(message, 80) } }
  }

  // 2. 按 pattern 命中 git2 原始消息（Git2 / OperationFailed 都走这里）
  for (const rule of PATTERNS) {
    if (rule.test(message)) {
      return rule.build(message)
    }
  }

  // 3. 兜底：带原文 detail 作为参数
  const detail = truncate(stripGit2Noise(message), 120)
  return {
    key: 'errors.generic.unknown',
    params: { detail },
    fallbackText: detail || 'Unknown error',
  }
}

function stripGit2Noise(msg: string): string {
  // "... ; class=Reference (4); code=Exists (-4)" → "..."
  return msg.replace(/\s*;\s*class=\w+\s*\(\d+\)\s*;\s*code=[\w-]+\s*\(-?\d+\)\s*$/i, '')
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max - 1) + '…'
}
