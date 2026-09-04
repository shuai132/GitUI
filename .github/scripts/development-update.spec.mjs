import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createDevelopmentTauriConfig,
  createDevelopmentUpdate,
  createDevelopmentVersion,
} from './development-update.mjs'

const temporaryDirectories = []
const artifactSuffixes = [
  '.app.tar.gz',
  '.AppImage',
  '.deb',
  '.rpm',
  '-setup.exe',
  '.msi',
]

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, {
    recursive: true,
    force: true,
  })))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'gitui-development-update-'))
  temporaryDirectories.push(root)
  const artifactsDir = join(root, 'artifacts')
  const outputDir = join(root, 'output')
  await mkdir(artifactsDir)

  for (const [index, suffix] of artifactSuffixes.entries()) {
    const platformDir = join(artifactsDir, `platform-${index}`)
    await mkdir(platformDir)
    const artifact = join(platformDir, `GitUI${suffix}`)
    await writeFile(artifact, `artifact-${index}`)
    await writeFile(`${artifact}.sig`, `signature-${index}\n`)
  }
  return { artifactsDir, outputDir }
}

describe('development updater publishing', () => {
  it('creates an increasing prerelease version from the source version', () => {
    expect(createDevelopmentVersion('0.13.1', '42')).toBe('0.13.2-dev.42')
    expect(createDevelopmentVersion('1.0.0-beta.1', 7)).toBe('1.0.1-dev.7')
    expect(() => createDevelopmentVersion('invalid', 7)).toThrow('Invalid base version')
    expect(() => createDevelopmentVersion('1.0.0', 0)).toThrow('Invalid Actions run number')
  })

  it('creates an MSI-compatible numeric build version', () => {
    expect(createDevelopmentTauriConfig('0.13.1', 42)).toEqual({
      version: '0.13.2-dev.42',
      bundle: {
        windows: {
          wix: {
            version: '0.13.2.42',
          },
        },
      },
    })
    expect(() => createDevelopmentTauriConfig('0.13.1', 65_536)).toThrow(
      'run number must fit the MSI version format',
    )
  })

  it('copies signed platform artifacts and creates a static updater manifest', async () => {
    const { artifactsDir, outputDir } = await fixture()
    const manifest = await createDevelopmentUpdate({
      artifactsDir,
      outputDir,
      baseVersion: '0.13.1',
      runNumber: 42,
      sha: 'ABCDEF0123456789',
      baseUrl: 'https://shuai132.github.io/GitUI',
      publishedAt: '2026-09-04T08:00:00.000Z',
    })

    expect(manifest.version).toBe('0.13.2-dev.42')
    expect(manifest.notes).toBe('main @ abcdef0')
    expect(Object.keys(manifest.platforms)).toEqual([
      'darwin-aarch64',
      'darwin-aarch64-app',
      'linux-x86_64-appimage',
      'linux-x86_64-deb',
      'linux-x86_64-rpm',
      'windows-x86_64-nsis',
      'windows-x86_64-msi',
    ])
    expect(manifest.platforms['windows-x86_64-nsis']).toEqual({
      signature: 'signature-4',
      url: expect.stringContaining('gitui-0.13.2-dev.42-abcdef0-windows-x86_64-nsis-setup.exe'),
    })
    const written = JSON.parse(await readFile(join(outputDir, 'latest.json'), 'utf8'))
    expect(written).toEqual(manifest)
  })

  it('fails instead of publishing an unsigned updater artifact', async () => {
    const { artifactsDir, outputDir } = await fixture()
    await writeFile(join(artifactsDir, 'platform-0', 'GitUI.app.tar.gz.sig'), '')

    await expect(createDevelopmentUpdate({
      artifactsDir,
      outputDir,
      baseVersion: '0.13.1',
      runNumber: 42,
      sha: 'abcdef0123456789',
      baseUrl: 'https://shuai132.github.io/GitUI',
    })).rejects.toThrow('Empty signature')
  })
})
