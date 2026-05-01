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

async function git(repoPath, args) {
  const { stdout } = await execFileAsync('git', args, {
    cwd: repoPath,
    timeout: 10000,
    maxBuffer: 1024 * 1024
  })
  return stdout.trim()
}

function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }))
}

function fail(id, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { message } }))
}

try {
  const request = JSON.parse(await readStdin())
  const repoPath = request.params?.context?.repo_path
  if (!repoPath) {
    throw new Error('No active repository.')
  }

  const branch = await git(repoPath, ['branch', '--show-current'])
  const head = await git(repoPath, ['rev-parse', '--short', 'HEAD'])
  const count = await git(repoPath, ['rev-list', '--count', 'HEAD'])
  const branchLabel = branch || 'detached HEAD'

  respond(request.id, {
    message: `${branchLabel} @ ${head}, ${count} reachable commits.`,
    refresh: ['history', 'branches']
  })
} catch (error) {
  fail(1, error instanceof Error ? error.message : String(error))
}
