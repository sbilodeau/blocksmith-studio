import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { makeFixtureJar } from '../../scripts/make-fixture-jar.mjs'
import {
  detectInstalls,
  jarPathFor,
  jarVersionId,
  launcherCandidates,
  scanManualPath,
  type DetectEnv
} from '../../src/main/services/vanilla/detect'

const IDS = ['26.3', '26.2', '1.21.4']

async function touch(path: string): Promise<string> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, 'jar')
  return path
}

describe('minecraft launcher detection', () => {
  let home: string

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'blocksmith-home-'))
  })

  afterEach(async () => {
    await rm(home, { recursive: true, force: true })
  })

  it('finds nothing in an empty home', async () => {
    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      const env: DetectEnv = { platform, homedir: home, env: {} }
      expect(await detectInstalls({ env, versionIds: IDS, manualPaths: [] })).toEqual([])
    }
  })

  it('detects every launcher layout on macOS', async () => {
    const support = join(home, 'Library', 'Application Support')
    const official = join(support, 'minecraft')
    const prism = join(support, 'PrismLauncher')
    const multimc = join(support, 'MultiMC')
    const modrinth = join(support, 'com.modrinth.theseus')
    const curseforge = join(home, 'Documents', 'curseforge', 'minecraft', 'Install')

    await touch(join(official, 'versions', '1.21.4', '1.21.4.jar'))
    await touch(join(official, 'versions', '26.3', '26.3.jar'))
    // Snapshots, unknown ids and folders without a jar are ignored.
    await touch(join(official, 'versions', '26.4-snapshot-8', '26.4-snapshot-8.jar'))
    await touch(join(official, 'versions', '1.20.1', '1.20.1.jar'))
    await mkdir(join(official, 'versions', '26.2'), { recursive: true })
    await touch(
      join(prism, 'libraries', 'com', 'mojang', 'minecraft', '26.2', 'minecraft-26.2-client.jar')
    )
    await touch(
      join(multimc, 'libraries', 'com', 'mojang', 'minecraft', '26.3', 'minecraft-26.3-client.jar')
    )
    await touch(join(modrinth, 'meta', 'versions', '1.21.4', '1.21.4.jar'))
    await touch(join(curseforge, 'versions', '26.3', '26.3.jar'))

    const env: DetectEnv = { platform: 'darwin', homedir: home, env: {} }
    const installs = await detectInstalls({ env, versionIds: IDS, manualPaths: [] })
    expect(installs).toEqual([
      {
        launcher: 'official',
        path: official,
        versions: [
          { id: '26.3', jarPath: join(official, 'versions', '26.3', '26.3.jar') },
          { id: '1.21.4', jarPath: join(official, 'versions', '1.21.4', '1.21.4.jar') }
        ]
      },
      {
        launcher: 'prism',
        path: prism,
        versions: [
          {
            id: '26.2',
            jarPath: join(
              prism,
              'libraries',
              'com',
              'mojang',
              'minecraft',
              '26.2',
              'minecraft-26.2-client.jar'
            )
          }
        ]
      },
      {
        launcher: 'multimc',
        path: multimc,
        versions: [{ id: '26.3', jarPath: jarPathFor(multimc, 'libraries', '26.3') }]
      },
      {
        launcher: 'modrinth',
        path: modrinth,
        versions: [
          { id: '1.21.4', jarPath: join(modrinth, 'meta', 'versions', '1.21.4', '1.21.4.jar') }
        ]
      },
      {
        launcher: 'curseforge',
        path: curseforge,
        versions: [{ id: '26.3', jarPath: join(curseforge, 'versions', '26.3', '26.3.jar') }]
      }
    ])
  })

  it('uses %APPDATA% on Windows and falls back to AppData/Roaming', async () => {
    const appData = join(home, 'custom-appdata')
    await touch(join(appData, '.minecraft', 'versions', '26.3', '26.3.jar'))
    await touch(join(appData, 'ModrinthApp', 'meta', 'versions', '26.2', '26.2.jar'))
    await touch(
      join(home, 'curseforge', 'minecraft', 'Install', 'versions', '1.21.4', '1.21.4.jar')
    )

    const withEnv = await detectInstalls({
      env: { platform: 'win32', homedir: home, env: { APPDATA: appData } },
      versionIds: IDS,
      manualPaths: []
    })
    expect(withEnv.map((i) => [i.launcher, i.versions.map((v) => v.id)])).toEqual([
      ['official', ['26.3']],
      ['modrinth', ['26.2']],
      ['curseforge', ['1.21.4']]
    ])

    await touch(join(home, 'AppData', 'Roaming', 'PrismLauncher', 'libraries', 'x'))
    const fallback = await detectInstalls({
      env: { platform: 'win32', homedir: home, env: {} },
      versionIds: IDS,
      manualPaths: []
    })
    expect(fallback.map((i) => i.launcher)).toEqual(['prism', 'curseforge'])
    expect(fallback[0].versions).toEqual([])
  })

  it('uses ~/.minecraft and XDG_DATA_HOME on Linux', async () => {
    await touch(join(home, '.minecraft', 'versions', '1.21.4', '1.21.4.jar'))
    const xdg = join(home, 'xdg')
    await touch(jarPathFor(join(xdg, 'PrismLauncher'), 'libraries', '26.3'))
    await touch(
      jarPathFor(
        join(home, '.var', 'app', 'org.prismlauncher.PrismLauncher', 'data', 'PrismLauncher'),
        'libraries',
        '26.2'
      )
    )
    const installs = await detectInstalls({
      env: { platform: 'linux', homedir: home, env: { XDG_DATA_HOME: xdg } },
      versionIds: IDS,
      manualPaths: []
    })
    expect(installs.map((i) => [i.launcher, i.versions.map((v) => v.id)])).toEqual([
      ['official', ['1.21.4']],
      ['prism', ['26.3']],
      ['prism', ['26.2']]
    ])
  })

  it('lists the default candidate folders per platform', () => {
    const roots = (platform: NodeJS.Platform): string[] =>
      launcherCandidates({ platform, homedir: '/h', env: { APPDATA: '/h/ad' } }).map(
        (c) => `${c.launcher}:${c.root}`
      )
    expect(roots('darwin')).toContain(
      `official:${join('/h', 'Library', 'Application Support', 'minecraft')}`
    )
    expect(roots('win32')).toContain(`official:${join('/h/ad', '.minecraft')}`)
    expect(roots('linux')).toContain(`official:${join('/h', '.minecraft')}`)
  })

  describe('manual paths (settings.minecraftPaths)', () => {
    const env = (): DetectEnv => ({ platform: 'darwin', homedir: home, env: {} })

    it('accepts any launcher layout or a bare versions folder', async () => {
      const officialLike = join(home, 'games', 'mc')
      await touch(jarPathFor(officialLike, 'versions', '26.3'))
      const prismLike = join(home, 'games', 'prism')
      await touch(jarPathFor(prismLike, 'libraries', '26.2'))
      const versionsDir = join(home, 'games', 'just-versions')
      await touch(jarPathFor(versionsDir, 'flat', '1.21.4'))
      const curse = join(home, 'games', 'curseforge')
      await touch(join(curse, 'minecraft', 'Install', 'versions', '26.3', '26.3.jar'))

      const installs = await detectInstalls({
        env: env(),
        versionIds: IDS,
        manualPaths: [officialLike, prismLike, versionsDir, curse, join(home, 'gone')]
      })
      expect(installs.map((i) => [i.launcher, i.path, i.versions.map((v) => v.id)])).toEqual([
        ['custom', officialLike, ['26.3']],
        ['custom', prismLike, ['26.2']],
        ['custom', versionsDir, ['1.21.4']],
        ['custom', curse, ['26.3']]
      ])
    })

    it('accepts a direct .jar path, identified by file name or by its version.json', async () => {
      const named = await touch(join(home, 'jars', '26.2.jar'))
      const renamed = await makeFixtureJar(join(home, 'jars', 'client.jar'), '1.21.4')
      const installs = await detectInstalls({
        env: env(),
        versionIds: IDS,
        manualPaths: [named, renamed, join(home, 'jars', 'random.txt')]
      })
      expect(installs).toEqual([
        { launcher: 'custom', path: named, versions: [{ id: '26.2', jarPath: named }] },
        { launcher: 'custom', path: renamed, versions: [{ id: '1.21.4', jarPath: renamed }] }
      ])
      expect(await jarVersionId(renamed, IDS)).toBe('1.21.4')
    })

    it('skips manual entries with no known release and duplicates of detected launchers', async () => {
      const official = join(home, 'Library', 'Application Support', 'minecraft')
      await touch(jarPathFor(official, 'versions', '26.3'))
      const empty = join(home, 'empty')
      await mkdir(empty)
      const notAClient = await touch(join(home, 'mod.jar'))

      const installs = await detectInstalls({
        env: env(),
        versionIds: IDS,
        manualPaths: [official, empty, notAClient]
      })
      expect(installs.map((i) => i.launcher)).toEqual(['official'])
      expect(await scanManualPath(empty, IDS)).toBeNull()
      expect(await scanManualPath(notAClient, IDS)).toBeNull()
    })
  })
})
