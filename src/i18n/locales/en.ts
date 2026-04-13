// English translation resources. Mirrors the key tree of zh-CN.ts.
const messages = {
  common: {
    aboutTitle: 'About GitUI',
    operationFailed: 'Operation failed: {detail}',
  },
  toolbar: {
    opFailed: '{label} failed: {message}',
    noRemoteConfigured: 'This repository has no remote configured',
    button: {
      open: 'Open',
    },
    search: {
      placeholder: 'Search commits',
    },
    title: {
      openRepo: 'Open repository',
      pull: 'Pull (fetch + merge)',
      pullModeSelect: 'Choose Pull mode',
      push: 'Push current branch',
      stash: 'Stash current working tree',
      popWithCount: 'Pop latest stash ({count} total)',
      popEmpty: 'No stash',
      terminalInApp: 'Open in-app terminal',
      terminalSystem: 'Open repository in system terminal',
      terminalModeSelect: 'Choose terminal mode',
      layoutCustom: 'Custom layout → switch to stacked',
      layoutVertical: 'Stacked layout → switch to side-by-side',
      layoutHorizontal: 'Side-by-side layout → switch to custom',
      settings: 'Settings',
      actions: 'More actions',
    },
    pullMode: {
      ff: 'Pull (fast-forward if possible)',
      ffOnly: 'Pull (fast-forward only)',
      rebase: 'Pull (rebase)',
    },
    terminalMode: {
      inApp: 'Open in app',
      system: 'Open in system terminal',
    },
    actionsMenu: {
      fetching: 'Fetching...',
      fetch: 'Fetch',
      showUnreachable: 'Show dangling refs',
      showStashes: 'Show stashes',
      debugLog: 'Debug log',
      reflog: 'Show Reflog',
      recentErrors: 'Recent errors...',
      recentErrorsWithCount: 'Recent errors ({count})...',
      gcCleaning: 'Cleaning...',
      gc: 'Clean repository (git gc)',
      discardAll: 'Discard all changes',
      about: 'About GitUI',
    },
    opLabels: {
      pull: 'Pull',
      push: 'Push',
      fetch: 'Fetch',
      stash: 'Stash',
      stashPop: 'Stash pop',
      gc: 'git gc',
      openRepo: 'Open repository',
      checkoutCommit: 'Checkout commit',
      cherryPick: 'Cherry pick',
      revert: 'Revert',
      reset: 'Reset',
      createBranch: 'Create branch',
      switchBranch: 'Switch branch',
      deleteBranch: 'Delete branch',
      checkoutRemoteBranch: 'Checkout remote branch',
      commit: 'Commit',
      amend: 'Amend',
      createTag: 'Create tag',
      discardAll: 'Discard all',
      discardFile: 'Discard file',
      openTerminal: 'Open terminal',
      initSubmodule: 'Init submodule',
      updateSubmodule: 'Update submodule',
      setSubmoduleUrl: 'Set submodule URL',
      deinitSubmodule: 'Deinit submodule',
    },
  },
  sidebar: {
    repo: {
      noRepo: 'No repository',
      addRepo: 'Add repository',
      allRepos: 'All repositories',
      removeRepo: 'Remove repository',
      menu: {
        newWindow: 'Open in new window',
        reveal: 'Reveal in Finder',
        openTerminal: 'Open in terminal',
      },
    },
    branch: {
      menu: {
        checkoutRemote: 'Checkout...',
        switchTo: 'Switch to this branch',
        copyName: 'Copy branch name',
        delete: 'Delete...',
      },
      confirmDelete: 'Delete branch "{name}"? This cannot be undone.',
    },
    tag: {
      menu: {
        copyName: 'Copy tag name',
        copyOid: 'Copy commit hash',
        delete: 'Delete tag...',
      },
      confirmDelete: 'Delete tag "{name}"? This cannot be undone.',
    },
    stash: {
      menu: {
        popLatest: 'Pop stash@{index} (latest)',
        copyOid: 'Copy commit hash',
      },
    },
    submodule: {
      menu: {
        init: 'Initialize {path}',
        update: 'Update {path}',
        edit: 'Edit {path}',
        delete: 'Delete this submodule',
      },
      confirmDelete: 'Delete submodule "{path}"?\n\nThis will remove:\n  • work directory {path}/\n  • .git/modules/{name}/\n  • the corresponding entry in .gitmodules\n  • the corresponding entry in .git/config\n\nPlease commit the change afterwards.',
      openFailed: 'Failed to open submodule: {detail}',
      hasChanges: 'Has uncommitted changes',
      menuTitle: 'Submodule actions',
    },
  },
  settings: {
    advanced: {
      uiLanguageTitle: 'Interface language',
      uiLanguageAuto: 'System default',
      uiLanguageHint: 'Takes effect immediately, no restart required',
    },
  },
  errors: {
    generic: {
      repoNotFound: 'Repository not found or not a Git repository',
      repoNotOpen: 'Repository is not open (internal error)',
      invalidPath: 'Invalid path: {path}',
      io: 'Filesystem error: {detail}',
      unknown: '{detail}',
    },
    auth: {
      failed: 'Authentication failed: check that your SSH key is loaded in the agent, or that HTTPS credentials are valid',
    },
    remote: {
      notFound: 'Remote does not exist or is not configured',
    },
    ref: {
      alreadyExists: 'Target already exists (branch / tag / reference name is taken)',
      notFound: 'The specified branch or reference was not found',
    },
    push: {
      nonFastForward: 'Not a fast-forward: the remote has new commits, pull / merge first',
    },
    pull: {
      mergeRequired: 'Pull requires a merge (non fast-forward), which is not yet supported — please merge manually in the terminal',
      diverged: 'Pull failed: the remote branch has diverged and cannot be fast-forwarded. Use merge or rebase mode',
    },
    rebase: {
      conflict: 'Rebase conflict detected, please resolve it manually in the terminal',
      dirtyWorktree: 'Working tree has uncommitted changes, please commit or stash before rebasing',
    },
    merge: {
      conflict: 'Conflict detected, please resolve it in the working tree before committing',
    },
    worktree: {
      dirty: 'Working tree has uncommitted changes, please commit / stash / discard first',
    },
    cherrypick: {
      conflict: '{type} conflict detected, please resolve it manually in the working tree',
    },
    config: {
      missingUser: 'git config is missing user.name / user.email, please configure it in the terminal first',
    },
    repo: {
      invalid: 'Not a Git repository, or the repository is no longer valid',
    },
    network: {
      failed: 'Network error: cannot reach the remote',
    },
  },
} as const

export default messages
