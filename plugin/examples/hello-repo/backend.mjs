import process from 'node:process'

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
  const commandId = request.params?.command_id
  const context = request.params?.context ?? {}
  const repoPath = context.repo_path ?? 'No active repository'
  const repoId = context.repo_id ?? 'unknown repo id'

  if (commandId === 'helloRepo.showCommit') {
    const commit = context.selection
    if (!commit || commit.type !== 'commit') {
      throw new Error('No commit selection was provided.')
    }
    respond(request.id, {
      message: `Selected commit ${commit.short_oid}: ${commit.summary}`,
      refresh: []
    })
  } else {
    respond(request.id, {
      message: `Hello from plugin. Repo: ${repoPath} (${repoId})`,
      refresh: []
    })
  }
} catch (error) {
  fail(1, error instanceof Error ? error.message : String(error))
}
