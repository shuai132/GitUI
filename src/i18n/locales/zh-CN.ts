// 中文（简体）翻译资源。按域组织（common / app / toolbar / sidebar / history /
// workspace / diff / branch / settings / terminal / errors / misc），内容由后续
// commit 分批填充。
const messages = {
  settings: {
    advanced: {
      uiLanguageTitle: '界面语言',
      uiLanguageAuto: '跟随系统',
      uiLanguageHint: '切换后立即生效，无需重启',
    },
  },
  errors: {
    generic: {
      repoNotFound: '仓库不存在或不是 Git 仓库',
      repoNotOpen: '仓库未打开（内部错误）',
      invalidPath: '路径无效：{path}',
      io: '文件系统错误：{detail}',
      unknown: '{detail}',
    },
    auth: {
      failed: '认证失败：检查 SSH key 是否在 agent 中、或 HTTPS 凭据是否有效',
    },
    remote: {
      notFound: '远端仓库不存在或未配置',
    },
    ref: {
      alreadyExists: '目标已存在（分支 / 标签 / 引用名重复）',
      notFound: '找不到指定的分支或引用',
    },
    push: {
      nonFastForward: '不是 fast-forward：远端有新的 commit，需要先 pull / merge',
    },
    pull: {
      mergeRequired: 'Pull 需要合并（非 fast-forward），当前版本尚未支持——请在终端手动 merge',
      diverged: 'Pull 失败：远端分支已分叉，无法 fast-forward。请使用 merge 或 rebase 模式',
    },
    rebase: {
      conflict: 'Rebase 出现冲突，请在终端手动解决',
      dirtyWorktree: '工作区有未提交的变更，请先 commit 或 stash 后再 rebase',
    },
    merge: {
      conflict: '发生冲突，请在工作区手动解决后再提交',
    },
    worktree: {
      dirty: '工作区有未提交的变更，请先 commit / stash / discard',
    },
    cherrypick: {
      conflict: '{type} 出现冲突，请在工作区手动解决',
    },
    config: {
      missingUser: '当前 git config 缺少 user.name / user.email，请先在终端设置',
    },
    repo: {
      invalid: '不是 Git 仓库，或仓库已失效',
    },
    network: {
      failed: '网络错误：无法连接到远端',
    },
  },
} as const

export default messages
export type MessageSchema = typeof messages
