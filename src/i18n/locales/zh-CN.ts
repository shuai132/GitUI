// 中文（简体）翻译资源。按域组织（common / app / toolbar / sidebar / history /
// workspace / diff / branch / settings / terminal / errors / misc），内容由后续
// commit 分批填充。
const messages = {
  common: {
    aboutTitle: '关于 GitUI',
    operationFailed: '操作失败：{detail}',
  },
  toolbar: {
    opFailed: '{label} 失败：{message}',
    noRemoteConfigured: '当前仓库没有配置 remote',
    button: {
      open: '打开',
    },
    search: {
      placeholder: '搜索提交',
    },
    title: {
      openRepo: '打开仓库',
      pull: 'Pull (fetch + merge)',
      pullModeSelect: '选择 Pull 模式',
      push: 'Push 当前分支',
      stash: 'Stash 当前工作区',
      popWithCount: 'Pop 最新 stash (共 {count} 条)',
      popEmpty: '没有 stash',
      terminalInApp: '打开应用内终端',
      terminalSystem: '在系统终端打开仓库',
      terminalModeSelect: '选择终端打开方式',
      layoutCustom: '自定义布局 → 切换为上下',
      layoutVertical: '上下布局 → 切换为左右',
      layoutHorizontal: '左右布局 → 切换为自定义',
      settings: '设置',
      actions: '更多操作',
    },
    pullMode: {
      ff: 'Pull (fast-forward if possible)',
      ffOnly: 'Pull (fast-forward only)',
      rebase: 'Pull (rebase)',
    },
    terminalMode: {
      inApp: '在应用内打开',
      system: '在系统终端打开',
    },
    actionsMenu: {
      fetching: '抓取中...',
      fetch: '抓取 (Fetch)',
      showUnreachable: '显示悬垂引用',
      showStashes: '显示贮藏',
      debugLog: '调试日志',
      reflog: '显示 Reflog',
      recentErrors: '最近错误...',
      recentErrorsWithCount: '最近错误 ({count})...',
      gcCleaning: '清理中...',
      gc: '清理仓库 (git gc)',
      discardAll: '丢弃所有变更',
      about: '关于 GitUI',
    },
    opLabels: {
      pull: 'Pull',
      push: 'Push',
      fetch: 'Fetch',
      stash: 'Stash',
      stashPop: 'Stash pop',
      gc: 'git gc',
      openRepo: '打开仓库',
      checkoutCommit: '检出提交',
      cherryPick: 'Cherry pick',
      revert: 'Revert',
      reset: 'Reset',
      createBranch: '创建分支',
      switchBranch: '切换分支',
      deleteBranch: '删除分支',
      checkoutRemoteBranch: '检出远程分支',
      commit: '提交',
      amend: 'Amend',
      createTag: '创建标签',
      discardAll: '丢弃全部',
      discardFile: '丢弃文件',
      openTerminal: '打开终端',
      initSubmodule: 'Init submodule',
      updateSubmodule: 'Update submodule',
      setSubmoduleUrl: '修改 submodule URL',
      deinitSubmodule: '删除 submodule',
    },
  },
  sidebar: {
    repo: {
      noRepo: '无仓库',
      addRepo: '添加仓库',
      allRepos: '所有仓库',
      removeRepo: '移除仓库',
      menu: {
        newWindow: '在新窗口打开',
        reveal: '在 Finder 中显示',
        openTerminal: '在终端中打开',
      },
    },
    branch: {
      menu: {
        checkoutRemote: '检出...',
        switchTo: '切换到此分支',
        copyName: '复制分支名字',
        delete: '删除...',
      },
      confirmDelete: '确认删除分支 "{name}"？此操作无法撤销。',
    },
    tag: {
      menu: {
        copyName: '复制标签名',
        copyOid: '复制 commit hash',
        delete: '删除标签...',
      },
      confirmDelete: '确认删除标签 "{name}"？此操作不可撤销。',
    },
    stash: {
      menu: {
        popLatest: 'Pop stash@{index}（最新）',
        copyOid: '复制 commit hash',
      },
    },
    submodule: {
      menu: {
        init: 'Initialize {path}',
        update: 'Update {path}',
        edit: 'Edit {path}',
        delete: 'Delete this submodule',
      },
      confirmDelete: '确认删除 submodule "{path}"？\n\n这将删除：\n  • 工作区目录 {path}/\n  • .git/modules/{name}/\n  • .gitmodules 中对应条目\n  • .git/config 中对应条目\n\n操作完成后请手动 commit 这次变更。',
      openFailed: '打开 submodule 失败：{detail}',
      hasChanges: '有未提交修改',
      menuTitle: 'Submodule 操作',
    },
  },
  history: {
    loading: '加载中...',
    loadingMore: '加载更多...',
    totalCount: '共 {count} 条',
    empty: {
      noActiveRepo: '请从左侧打开一个 Git 仓库',
      noCommits: '暂无提交历史',
    },
    search: {
      foundOf: '找到 {found} 条（已加载 {loaded} 条）',
    },
    columns: {
      description: '描述',
      commit: '提交',
      author: '作者',
      date: '日期',
      resizeGroup: '拖动整体移动提交/作者/日期列组',
      resizeAuthor: '拖动调整「作者」距离「提交」的位置',
      resizeDate: '拖动调整「日期」距离「作者」的位置',
      resizeDateWidth: '拖动调整「日期」列宽度',
    },
    tooltip: {
      author: '作者',
      date: '时间',
      commit: '提交',
    },
    tag: {
      annotated: '附注标签',
    },
    dock: {
      dragToMove: '拖拽停靠',
    },
    detailsPanel: {
      title: '详情',
      commit: '提交',
      author: '作者',
      date: '日期',
      email: '邮箱',
      parents: '父提交',
      empty: '选择提交查看详情',
    },
    wipRow: {
      unstagedTitle: '未暂存修改',
      untrackedTitle: '未跟踪文件',
      stagedTitle: '已暂存',
      pendingHint: '{count} 个文件待提交到 {branch}',
    },
    contextMenu: {
      checkout: '检出此提交',
      createBranch: '在此创建分支...',
      cherryPick: 'Cherry pick 此提交',
      resetTo: '将 {branch} 重置到此提交',
      resetSoft: 'Soft（保留工作区与暂存区）',
      resetMixed: 'Mixed（保留工作区，清空暂存区）',
      resetHard: 'Hard（丢弃所有变更）',
      revert: 'Revert 此提交',
      copySha: '复制提交 SHA',
      createTag: '在此创建标签...',
      createAnnotatedTag: '创建附注标签...',
    },
    dialog: {
      confirmCheckout: {
        body: '检出到提交 {shortOid} 将进入 detached HEAD 状态，确认？',
      },
      confirmCherryPick: {
        body: 'Cherry pick 提交 "{summary}"？',
      },
      confirmRevert: {
        body: 'Revert 提交 "{summary}"？将创建一条新提交撤销该改动',
      },
      confirmReset: {
        body: '将 {branch} {mode} reset 到 {shortOid}？',
        hardBody: 'Hard reset 将丢弃所有未提交变更，确认把 {branch} 重置到 {shortOid}？',
        mode: {
          soft: 'soft',
          mixed: 'mixed',
          hard: 'hard',
        },
      },
    },
  },
  branches: {
    noRepo: '请先打开一个 Git 仓库',
  },
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
