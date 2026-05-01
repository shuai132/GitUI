import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import process from 'node:process'

const execFileAsync = promisify(execFile)

async function readStdin() {
  return await new Promise((resolve) => {
    let raw = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => { raw += chunk })
    process.stdin.on('end', () => resolve(raw))
  })
}

function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }))
}

function fail(id, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { message } }))
}

function statusSummary(stdout) {
  const lines = stdout.split('\n').filter((line) => line.trim().length > 0)
  const branchLine = lines.find((line) => line.startsWith('## '))
  const changedCount = lines.filter((line) => !line.startsWith('## ')).length
  const branch = branchLine ? branchLine.slice(3) : 'unknown branch'

  if (changedCount === 0) {
    return `worktree is clean on ${branch}`
  }

  const suffix = changedCount === 1 ? 'change' : 'changes'
  return `worktree has ${changedCount} ${suffix} on ${branch}`
}

try {
  const request = JSON.parse(await readStdin())
  const context = request.params?.context ?? {}
  const repoPath = context.repo_path
  const commit = context.selection

  if (!repoPath) {
    throw new Error('No active repository.')
  }
  if (!commit || commit.type !== 'commit') {
    throw new Error('Run this command from a commit context menu.')
  }

  const { stdout } = await execFileAsync('git', ['status', '--short', '--branch'], {
    cwd: repoPath,
    timeout: 10000,
    maxBuffer: 1024 * 1024
  })

  respond(request.id, {
    message: `Selected ${commit.short_oid}: ${statusSummary(stdout)}.`,
    refresh: ['workspace']
  })
} catch (error) {
  fail(1, error instanceof Error ? error.message : String(error))
}
