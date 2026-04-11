/**
 * 把原始错误（Tauri rejection / Error 实例 / 字符串）映射成中文友好消息。
 *
 * 输入格式多样：
 *   - GitError 变体对象：{ RepoNotFound: "..." }、{ OperationFailed: "..." }、{ Git2: "..." }
 *   - 普通 Error：`new Error("...")`
 *   - 字符串
 *
 * 规则按优先级：
 *   1. 结构化变体 → 按 kind 分类
 *   2. 原始消息子串命中 → 已知 git2 pattern 翻译
 *   3. 兜底 → 截断的原始串
 *
 * 命中失败不会崩，体验只比原始串好一点。新 IPC 命令不必先改这里。
 */

type GitErrorKind =
  | 'RepoNotFound'
  | 'RepoNotOpen'
  | 'InvalidPath'
  | 'OperationFailed'
  | 'Git2'
  | 'Io'

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

/** 按子串命中的模式规则，越靠前优先级越高 */
const PATTERNS: Array<{ test: (msg: string) => boolean; friendly: (msg: string) => string }> = [
  // 认证失败
  {
    test: (m) => /authentication required|authentication failed|401|403/i.test(m),
    friendly: () => '认证失败：检查 SSH key 是否在 agent 中、或 HTTPS 凭据是否有效',
  },
  // 远端不存在
  {
    test: (m) => /remote ['"]?(\w+)['"]? does not exist|no such remote/i.test(m),
    friendly: () => '远端仓库不存在或未配置',
  },
  // 分支/引用已存在
  {
    test: (m) => /reference .* already exists/i.test(m) || /already exists/i.test(m),
    friendly: () => '目标已存在（分支 / 标签 / 引用名重复）',
  },
  // 分支/引用找不到
  {
    test: (m) => /reference .* not found|no such (branch|reference)/i.test(m),
    friendly: () => '找不到指定的分支或引用',
  },
  // 非 fast-forward
  {
    test: (m) => /non[- ]?fast[- ]?forward|cannot fast-forward/i.test(m),
    friendly: () => '不是 fast-forward：远端有新的 commit，需要先 pull / merge',
  },
  // Pull 需要 merge（本项目特殊错误）
  {
    test: (m) => /Merge required/i.test(m),
    friendly: () => 'Pull 需要合并（非 fast-forward），当前版本尚未支持——请在终端手动 merge',
  },
  // 冲突
  {
    test: (m) => /conflict|needs merge/i.test(m),
    friendly: () => '发生冲突，请在工作区手动解决后再提交',
  },
  // 工作区有未提交变更
  {
    test: (m) => /uncommitted|unstaged|working (tree|directory) (is )?dirty|local changes/i.test(m),
    friendly: () => '工作区有未提交的变更，请先 commit / stash / discard',
  },
  // Cherry-pick / revert 有冲突（后端 OperationFailed 自定义消息）
  {
    test: (m) => /Cherry-pick 出现冲突|Revert 出现冲突/.test(m),
    friendly: (m) => m,
  },
  // signature not found（git config user.name/email 缺失）
  {
    test: (m) => /config value .* not found|user\.(name|email)|no name was given/i.test(m),
    friendly: () => '当前 git config 缺少 user.name / user.email，请先在终端设置',
  },
  // Repo 未打开 / 无效路径
  {
    test: (m) => /not a git repository|could not find repository/i.test(m),
    friendly: () => '不是 Git 仓库，或仓库已失效',
  },
  // 网络
  {
    test: (m) => /network|failed to connect|timed out|dns|resolve/i.test(m),
    friendly: () => '网络错误：无法连接到远端',
  },
]

export function mapGitError(_op: string, raw: unknown): string {
  const { kind, message } = extractKindAndMessage(raw)

  // 1. 先看 GitError 变体
  if (kind === 'RepoNotFound') return '仓库不存在或不是 Git 仓库'
  if (kind === 'RepoNotOpen') return '仓库未打开（内部错误）'
  if (kind === 'InvalidPath') return `路径无效：${truncate(message, 80)}`
  if (kind === 'Io') return `文件系统错误：${truncate(message, 80)}`

  // 2. 按 pattern 命中 git2 原始消息（Git2 / OperationFailed 都走这里）
  for (const rule of PATTERNS) {
    if (rule.test(message)) {
      return rule.friendly(message)
    }
  }

  // 3. 兜底：清理 git2 的噪声后缀（class=... code=...）
  return truncate(stripGit2Noise(message), 120) || '未知错误'
}

function stripGit2Noise(msg: string): string {
  // "... ; class=Reference (4); code=Exists (-4)" → "..."
  return msg.replace(/\s*;\s*class=\w+\s*\(\d+\)\s*;\s*code=[\w-]+\s*\(-?\d+\)\s*$/i, '')
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max - 1) + '…'
}
