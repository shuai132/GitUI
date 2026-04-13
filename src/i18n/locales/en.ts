// English translation resources. Mirrors the key tree of zh-CN.ts.
const messages = {
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
