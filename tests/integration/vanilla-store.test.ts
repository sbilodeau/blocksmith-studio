import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync } from 'fs'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { makeFixtureJar } from '../../scripts/make-fixture-jar.mjs'
import { createVanillaStore, type VanillaStoreDeps } from '../../src/main/services/vanilla/store'
import { extractVanillaJar, type ExtractRunner } from '../../src/main/services/vanilla/extract'
import type { MojangClient } from '../../src/main/services/vanilla/mojang'
import { VanillaError } from '../../src/main/services/vanilla/errors'
import { AppErrorException } from '../../src/main/ipc/registry'

const NOW = new Date('2026-11-15T12:00:00Z')

describe('VanillaStore', () => {
  let home: string
  let userData: string
  let manualPaths: string[]
  let downloads: string[]

  /** Fake Mojang: "downloads" the fixture jar for 1.21.4 / 26.3. */
  const mojang: MojangClient = {
    async downloadClientJar(versionId, destPath, onProgress) {
      downloads.push(versionId)
      if (versionId !== '1.21.4' && versionId !== '26.3') {
        throw new VanillaError('vanilla.versionUnknown', { version: versionId })
      }
      onProgress?.('download', 0, 100)
      await makeFixtureJar(destPath, versionId)
      onProgress?.('download', 100, 100)
    }
  }

  function store(overrides: Partial<VanillaStoreDeps> = {}): ReturnType<typeof createVanillaStore> {
    return createVanillaStore({
      userDataDir: userData,
      now: () => NOW,
      detectEnv: { platform: 'darwin', homedir: home, env: {} },
      getMinecraftPaths: () => manualPaths,
      mojang,
      extract: (job, onProgress) => extractVanillaJar(job, onProgress),
      logger: { warn: () => {} },
      ...overrides
    })
  }

  const officialRoot = (): string => join(home, 'Library', 'Application Support', 'minecraft')

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'blocksmith-store-home-'))
    userData = await mkdtemp(join(tmpdir(), 'blocksmith-store-ud-'))
    manualPaths = []
    downloads = []
  })

  afterEach(async () => {
    await rm(home, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  })

  it('answers version table queries', () => {
    const s = store()
    expect(s.latestVersion().id).toBe('26.3')
    expect(s.supportedVersions().map((v) => v.id)[0]).toBe('26.3')
    expect(s.supportedVersions().at(-1)?.id).toBe('1.21.4')
    expect(s.getVersion('1.21.4')?.resourcePack.major).toBe(46)
    expect(s.getVersion('nope')).toBeUndefined()
    expect(s.versionForPackFormat({ major: 64, minor: 0 })?.id).toBe('1.21.8')
  })

  it('reports downloadable / local / ready availability, newest first', async () => {
    await makeFixtureJar(join(officialRoot(), 'versions', '1.21.4', '1.21.4.jar'), '1.21.4')
    const s = store()

    let availability = await s.availability()
    expect(availability).toHaveLength(13)
    expect(availability[0]).toEqual({
      versionId: '26.3',
      releaseTime: '2026-09-15T11:23:02+00:00',
      isLatest: true,
      state: 'downloadable'
    })
    expect(availability.filter((a) => a.isLatest)).toHaveLength(1)
    expect(availability.at(-1)).toEqual({
      versionId: '1.21.4',
      releaseTime: '2024-12-03T10:12:57+00:00',
      isLatest: false,
      state: 'local',
      jarPath: join(officialRoot(), 'versions', '1.21.4', '1.21.4.jar')
    })

    await s.prepare('1.21.4', { allowDownload: false })
    availability = await s.availability()
    expect(availability.at(-1)).toMatchObject({ versionId: '1.21.4', state: 'ready' })
    expect(availability.at(-1)?.jarPath).toBeUndefined()
  })

  it('prepares from a local jar without downloading, reporting extract and index progress', async () => {
    await makeFixtureJar(join(officialRoot(), 'versions', '1.21.4', '1.21.4.jar'), '1.21.4')
    const s = store()
    const phases = new Set<string>()
    const index = await s.prepare('1.21.4', {
      allowDownload: false,
      onProgress: (phase) => phases.add(phase)
    })
    expect(index.resourcePack).toEqual({ major: 46, minor: 0 })
    expect([...phases]).toEqual(['extract', 'index'])
    expect(downloads).toEqual([])
    expect(await s.getIndex('1.21.4')).toEqual(index)
    // A second store (app restart) reads the index from disk.
    expect(await store().getIndex('1.21.4')).toEqual(index)
  })

  it('uses manual paths from settings', async () => {
    const jar = await makeFixtureJar(join(home, 'elsewhere', 'client.jar'), '26.3')
    manualPaths = [jar]
    const s = store()
    expect((await s.availability())[0]).toMatchObject({ state: 'local', jarPath: jar })
    await s.prepare('26.3', { allowDownload: false })
    expect(downloads).toEqual([])
  })

  it('refuses to download without consent', async () => {
    const err = await store()
      .prepare('26.3', { allowDownload: false })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AppErrorException)
    expect(err).toMatchObject({ code: 'vanilla.downloadNotAllowed', params: { version: '26.3' } })
    expect(downloads).toEqual([])
  })

  it('downloads into userData/jars when allowed, then counts that jar as local', async () => {
    const s = store()
    const phases = new Set<string>()
    const index = await s.prepare('26.3', {
      allowDownload: true,
      onProgress: (phase) => phases.add(phase)
    })
    expect(index.resourcePack).toEqual({ major: 97, minor: 1 })
    expect([...phases]).toEqual(['download', 'extract', 'index'])
    expect(existsSync(join(userData, 'jars', '26.3.jar'))).toBe(true)
    expect(existsSync(join(userData, 'vanilla', '26.3', 'index.json'))).toBe(true)

    await rm(join(userData, 'vanilla'), { recursive: true })
    expect((await s.availability())[0]).toMatchObject({
      state: 'local',
      jarPath: join(userData, 'jars', '26.3.jar')
    })
  })

  it('returns the cached index without touching jars once ready', async () => {
    const s = store()
    await s.prepare('26.3', { allowDownload: true })
    await rm(join(userData, 'jars'), { recursive: true })
    const extract = vi.fn<ExtractRunner>()
    const again = store({ extract })
    await expect(again.prepare('26.3', { allowDownload: false })).resolves.toMatchObject({
      versionId: '26.3'
    })
    expect(extract).not.toHaveBeenCalled()
  })

  it('treats an interrupted extraction (no index.json) as not ready and redoes it', async () => {
    await makeFixtureJar(join(officialRoot(), 'versions', '1.21.4', '1.21.4.jar'), '1.21.4')
    const partial = join(userData, 'vanilla', '1.21.4', 'assets', 'minecraft', 'textures', 'block')
    await mkdir(partial, { recursive: true })
    await writeFile(join(partial, 'stone.png'), 'half written')

    const s = store()
    expect(await s.getIndex('1.21.4')).toBeNull()
    expect((await s.availability()).at(-1)?.state).toBe('local')
    expect(s.resolveFile('1.21.4', 'assets/minecraft/textures/block/stone.png')).toBeNull()

    await s.prepare('1.21.4', { allowDownload: false })
    expect(s.resolveFile('1.21.4', 'assets/minecraft/textures/block/stone.png')).toBe(
      join(partial, 'stone.png')
    )
  })

  it('shares one promise between concurrent prepare() calls and fans out progress', async () => {
    await makeFixtureJar(join(officialRoot(), 'versions', '26.3', '26.3.jar'), '26.3')
    let runs = 0
    const s = store({
      extract: (job, onProgress) => {
        runs++
        return extractVanillaJar(job, onProgress)
      }
    })
    const first: string[] = []
    const second: string[] = []
    const a = s.prepare('26.3', { allowDownload: false, onProgress: (p) => first.push(p) })
    const b = s.prepare('26.3', { allowDownload: false, onProgress: (p) => second.push(p) })
    expect(b).toBe(a)
    const [ia, ib] = await Promise.all([a, b])
    expect(ia).toBe(ib)
    expect(runs).toBe(1)
    expect(first.length).toBeGreaterThan(0)
    expect(second.length).toBeGreaterThan(0)

    // Once settled, a new call starts a new (cached) prepare.
    const c = s.prepare('26.3', { allowDownload: false })
    expect(c).not.toBe(a)
    await c
    expect(runs).toBe(1)
  })

  it('rejects unknown versions and converts worker errors to AppErrorException', async () => {
    const s = store()
    await expect(s.prepare('1.12.2', { allowDownload: true })).rejects.toMatchObject({
      code: 'vanilla.versionUnknown'
    })
    await expect(s.prepare('../x', { allowDownload: true })).rejects.toMatchObject({
      code: 'vanilla.versionUnknown'
    })

    // A jar whose version.json says 1.21.4 at the 26.3 location.
    await makeFixtureJar(join(officialRoot(), 'versions', '26.3', '26.3.jar'), '1.21.4')
    const err = await s.prepare('26.3', { allowDownload: false }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AppErrorException)
    expect(err).toMatchObject({
      code: 'vanilla.jarVersionMismatch',
      params: { expected: '26.3', actual: '1.21.4' }
    })

    const crashing = store({ extract: () => Promise.reject(new Error('disk full')) })
    await expect(crashing.prepare('26.3', { allowDownload: false })).rejects.toMatchObject({
      code: 'vanilla.extractFailed',
      params: { reason: 'disk full' }
    })
  })

  it('warns when the jar pack format differs from versions.json', async () => {
    await makeFixtureJar(join(officialRoot(), 'versions', '26.3', '26.3.jar'), '26.3')
    const warn = vi.fn()
    const s = store({
      logger: { warn },
      extract: async (job, onProgress) => ({
        ...(await extractVanillaJar(job, onProgress)),
        resourcePack: { major: 98, minor: 0 }
      })
    })
    await s.prepare('26.3', { allowDownload: false })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('98.0'))
  })

  describe('resolveFile', () => {
    beforeEach(async () => {
      await makeFixtureJar(join(officialRoot(), 'versions', '26.3', '26.3.jar'), '26.3')
    })

    it('returns files inside userData/vanilla/<id>/ only', async () => {
      const s = store()
      await s.prepare('26.3', { allowDownload: false })
      const root = join(userData, 'vanilla', '26.3')
      expect(s.resolveFile('26.3', 'assets/minecraft/textures/block/stone.png')).toBe(
        join(root, 'assets', 'minecraft', 'textures', 'block', 'stone.png')
      )
      expect(s.resolveFile('26.3', 'pack.png')).toBe(join(root, 'pack.png'))
      // Missing file, folder, index itself.
      expect(s.resolveFile('26.3', 'assets/minecraft/textures/block/nope.png')).toBeNull()
      expect(s.resolveFile('26.3', 'assets/minecraft/textures')).toBeNull()
      expect(s.resolveFile('26.3', 'index.json')).toBeNull()
      // Not extracted / unknown version.
      expect(s.resolveFile('1.21.4', 'pack.png')).toBeNull()
      expect(s.resolveFile('9.9', 'pack.png')).toBeNull()
    })

    it.each([
      '../../settings.json',
      'assets/../../26.3/pack.png',
      'assets/minecraft/../../../jars/26.3.jar',
      '/etc/passwd',
      'C:/Windows/win.ini',
      'assets\\minecraft\\textures\\block\\stone.png',
      '..\\..\\settings.json',
      './pack.png',
      ''
    ])('rejects traversal: %j', async (packPath) => {
      const s = store()
      await s.prepare('26.3', { allowDownload: false })
      await writeFile(join(userData, 'settings.json'), '{}')
      expect(s.resolveFile('26.3', packPath)).toBeNull()
    })

    it('rejects a traversal in the version id', async () => {
      const s = store()
      await s.prepare('26.3', { allowDownload: false })
      expect(s.resolveFile('..', 'vanilla/26.3/pack.png')).toBeNull()
      expect(s.resolveFile('26.3/..', 'pack.png')).toBeNull()
    })
  })

  describe('inspectPath', () => {
    it('only reports supported versions', async () => {
      const root = join(home, 'mc')
      await makeFixtureJar(join(root, 'versions', '1.21.4', '1.21.4.jar'), '1.21.4')
      await mkdir(join(root, 'versions', '1.21.1'), { recursive: true })
      await writeFile(join(root, 'versions', '1.21.1', '1.21.1.jar'), 'old')
      const install = await store().inspectPath(root)
      expect(install?.versions.map((v) => v.id)).toEqual(['1.21.4'])

      const oldOnly = join(home, 'old')
      await mkdir(join(oldOnly, 'versions', '1.21.1'), { recursive: true })
      await writeFile(join(oldOnly, 'versions', '1.21.1', '1.21.1.jar'), 'old')
      expect(await store().inspectPath(oldOnly)).toBeNull()
    })
  })
})
