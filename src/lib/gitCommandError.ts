/** IPC command failure already recorded in errorsStore and shown by ToolbarToast. */
export class GitCommandError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GitCommandError'
  }
}
