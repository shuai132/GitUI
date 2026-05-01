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

try {
  const request = JSON.parse(await readStdin())
  const repoPath = request.params?.context?.repo_path
  if (!repoPath) {
    throw new Error('No active repository.')
  }

  const { stdout } = await execFileAsync('git', ['status', '--short'], {
    cwd: repoPath,
    timeout: 10000,
    maxBuffer: 1024 * 1024
  })
  const lines = stdout.split('\n').filter((line) => line.trim().length > 0)

  respond(request.id, {
    message: `Worktree has ${lines.length} changed file${lines.length === 1 ? '' : 's'}.`,
    refresh: ['workspace']
  })
} catch (error) {
  fail(1, error instanceof Error ? error.message : String(error))
}
