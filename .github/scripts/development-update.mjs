import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const GITHUB_PAGES_SITE_SIZE_LIMIT = 1024 * 1024 * 1024
const MSI_MAJOR_MINOR_LIMIT = 255
const MSI_PATCH_BUILD_LIMIT = 65_535

const UPDATER_ARTIFACTS = [
  {
    suffix: '.app.tar.gz',
    assetLabel: 'macos-arm64',
    targets: ['darwin-aarch64', 'darwin-aarch64-app'],
  },
  {
    suffix: '.AppImage',
    assetLabel: 'linux-x86_64-appimage',
    targets: ['linux-x86_64-appimage'],
  },
  {
    suffix: '.deb',
    assetLabel: 'linux-x86_64-deb',
    targets: ['linux-x86_64-deb'],
  },
  {
    suffix: '.rpm',
    assetLabel: 'linux-x86_64-rpm',
    targets: ['linux-x86_64-rpm'],
  },
  {
    suffix: '-setup.exe',
    assetLabel: 'windows-x86_64-nsis',
    targets: ['windows-x86_64-nsis'],
  },
  {
    suffix: '.msi',
    assetLabel: 'windows-x86_64-msi',
    targets: ['windows-x86_64-msi'],
  },
]

export function createDevelopmentVersion(baseVersion, runNumber) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(baseVersion)
  if (!match) throw new Error(`Invalid base version: ${baseVersion}`)
  if (!/^[1-9]\d*$/.test(String(runNumber))) {
    throw new Error(`Invalid Actions run number: ${runNumber}`)
  }

  const [, major, minor, patch] = match
  return `${major}.${minor}.${Number(patch) + 1}-dev.${runNumber}`
}

export function createDevelopmentTauriConfig(baseVersion, runNumber) {
  const version = createDevelopmentVersion(baseVersion, runNumber)
  const [, major, minor, patch] = /^(\d+)\.(\d+)\.(\d+)/.exec(version)
  const numericParts = [major, minor, patch, String(runNumber)].map(Number)
  const [majorNumber, minorNumber, patchNumber, buildNumber] = numericParts

  if (majorNumber > MSI_MAJOR_MINOR_LIMIT || minorNumber > MSI_MAJOR_MINOR_LIMIT) {
    throw new Error('Development version major and minor must fit the MSI version format')
  }
  if (patchNumber > MSI_PATCH_BUILD_LIMIT || buildNumber > MSI_PATCH_BUILD_LIMIT) {
    throw new Error('Development version patch and run number must fit the MSI version format')
  }

  return {
    version,
    bundle: {
      windows: {
        wix: {
          version: numericParts.join('.'),
        },
      },
    },
  }
}

export async function createDevelopmentUpdate(options) {
  const {
    artifactsDir,
    outputDir,
    baseVersion,
    runNumber,
    sha,
    baseUrl,
    publishedAt = new Date().toISOString(),
  } = options
  const version = createDevelopmentVersion(baseVersion, runNumber)
  const sourceCommit = normalizeSha(sha)
  const shortSha = sourceCommit.slice(0, 7)
  const files = await walkFiles(artifactsDir)
  const platforms = {}
  let publishedBytes = 0

  await mkdir(outputDir, { recursive: true })

  for (const artifact of UPDATER_ARTIFACTS) {
    const source = findUniqueArtifact(files, artifact.suffix)
    const signaturePath = `${source}.sig`
    if (!files.includes(signaturePath)) {
      throw new Error(`Missing signature for updater artifact: ${basename(source)}`)
    }

    const sourceStat = await stat(source)
    publishedBytes += sourceStat.size

    const fileName = `gitui-${version}-${shortSha}-${artifact.assetLabel}${artifact.suffix}`
    await copyFile(source, join(outputDir, fileName))
    const signature = (await readFile(signaturePath, 'utf8')).trim()
    if (!signature) throw new Error(`Empty signature for updater artifact: ${basename(source)}`)

    const url = publishedAssetUrl(baseUrl, fileName)
    for (const target of artifact.targets) {
      platforms[target] = { signature, url }
    }
  }

  if (publishedBytes >= GITHUB_PAGES_SITE_SIZE_LIMIT) {
    throw new Error('Development updater snapshot exceeds the GitHub Pages 1 GiB site limit')
  }

  const manifest = {
    version,
    commit: sourceCommit,
    notes: `main @ ${shortSha}`,
    pub_date: publishedAt,
    platforms,
  }
  await writeFile(join(outputDir, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

function findUniqueArtifact(files, suffix) {
  const matches = files.filter((file) => file.endsWith(suffix))
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one updater artifact ending in ${suffix}, found ${matches.length}`,
    )
  }
  return matches[0]
}

async function walkFiles(root) {
  const entries = await readdir(root, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(root, entry.name)
    return entry.isDirectory() ? walkFiles(path) : [path]
  }))
  return nested.flat()
}

function normalizeSha(sha) {
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) throw new Error(`Invalid commit SHA: ${sha}`)
  return sha.toLowerCase()
}

function publishedAssetUrl(baseUrl, fileName) {
  const parsed = new URL(baseUrl)
  if (parsed.protocol !== 'https:') throw new Error(`Invalid development update base URL: ${baseUrl}`)
  const normalized = parsed.toString().endsWith('/') ? parsed.toString() : `${parsed.toString()}/`
  return new URL(encodeURIComponent(fileName), normalized).toString()
}

function readArgs(argv) {
  const args = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error(`Invalid argument list near: ${key ?? '<end>'}`)
    }
    args.set(key.slice(2), value)
  }
  return args
}

function required(args, key) {
  const value = args.get(key)
  if (!value) throw new Error(`Missing required argument: --${key}`)
  return value
}

async function main(argv) {
  const [command, ...rest] = argv
  const args = readArgs(rest)
  if (command === 'version') {
    process.stdout.write(createDevelopmentVersion(
      required(args, 'base-version'),
      required(args, 'run-number'),
    ))
    return
  }
  if (command === 'config') {
    process.stdout.write(JSON.stringify(createDevelopmentTauriConfig(
      required(args, 'base-version'),
      required(args, 'run-number'),
    )))
    return
  }
  if (command === 'manifest') {
    await createDevelopmentUpdate({
      artifactsDir: required(args, 'artifacts-dir'),
      outputDir: required(args, 'output-dir'),
      baseVersion: required(args, 'base-version'),
      runNumber: required(args, 'run-number'),
      sha: required(args, 'sha'),
      baseUrl: required(args, 'base-url'),
    })
    return
  }
  throw new Error(`Unknown command: ${command ?? '<none>'}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
