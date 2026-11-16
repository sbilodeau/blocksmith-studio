import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { zipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { T, createTestEnv, json, makePng, vanillaFiles, type TestEnv } from './packs-fixtures'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

const mcmeta = (pack: Record<string, unknown>, extra: Record<string, unknown> = {}): Uint8Array =>
  json({ pack, ...extra })

describe('import .zip', () => {
  let env: TestEnv

  beforeEach(async () => {
    env = await createTestEnv()
  })

  afterEach(async () => {
    await env.cleanup()
  })

  async function zipFile(name: string, files: Record<string, Uint8Array>): Promise<string> {
    const path = join(env.root, name)
    await writeFile(path, zipSync(files))
    return path
  }

  async function listPack(folder: string): Promise<string[]> {
    return (await readdir(folder, { recursive: true, withFileTypes: true }))
      .filter((d) => d.isFile())
      .map((d) =>
        join(d.parentPath, d.name)
          .slice(folder.length + 1)
          .split('\\')
          .join('/')
      )
      .sort()
  }

  it('imports a current-format pack, dropping files identical to vanilla', async () => {
    const vanilla = vanillaFiles()
    const zip = await zipFile('Fire Pack.zip', {
      'pack.mcmeta': mcmeta(
        {
          description: { text: 'Hot ', extra: [{ text: 'stuff', color: 'red' }] },
          min_format: [97, 0],
          max_format: 97
        },
        { language: { xx_yy: { name: 'X', region: 'Y', bidirectional: false } } }
      ),
      'pack.png': makePng(32, 32, [9, 9, 9, 255]),
      [T('block/stone.png')]: makePng(16, 16, [255, 0, 0, 255]),
      [T('block/dirt.png')]: vanilla[T('block/dirt.png')],
      [T('item/apple.png')]: vanilla[T('item/apple.png')],
      'assets/minecraft/lang/xx_yy.json': json({ 'block.minecraft.stone': 'Rock' }),
      '__MACOSX/._pack.png': new Uint8Array([1]),
      '.DS_Store': new Uint8Array([1]),
      'assets/.DS_Store': new Uint8Array([1])
    })

    const report = await env.service.importZip(zip)
    expect(report).toMatchObject({
      declaredFormat: { major: 97, minor: 0 },
      mappedVersion: '26.3',
      filesImported: 3,
      identicalToVanilla: 2,
      warnings: []
    })
    expect(report.pack).toMatchObject({
      name: 'Fire Pack',
      description: 'Hot stuff',
      authoringVersion: '26.3',
      base: 'vanilla',
      changedCount: 1
    })
    expect(await listPack(report.pack.folder)).toEqual([
      '.blocksmith/project.json',
      'assets/minecraft/lang/xx_yy.json',
      T('block/stone.png'),
      'pack.mcmeta',
      'pack.png'
    ])
    const written = JSON.parse(await readFile(join(report.pack.folder, 'pack.mcmeta'), 'utf8'))
    expect(written.pack.description).toBe('Hot stuff')
    expect(written.language).toEqual({ xx_yy: { name: 'X', region: 'Y', bidirectional: false } })
    expect(env.progress.some((p) => p.kind === 'packs.import' && p.phase === 'read')).toBe(true)
    expect(env.progress.some((p) => p.kind === 'packs.import' && p.phase === 'write')).toBe(true)
    expect(env.deps.notifyChanged).toHaveBeenCalledWith(report.pack.id)
    await expect(env.service.list()).resolves.toHaveLength(1)
  })

  it('finds the pack root inside a single top-level folder and warns on an older format', async () => {
    const zip = await zipFile('nested.zip', {
      'MyPack/pack.mcmeta': mcmeta({ pack_format: 46, description: 'Old one' }),
      [`MyPack/${T('block/stone.png')}`]: makePng(16, 16, [0, 0, 255, 255]),
      'MyPack/.blocksmith/project.json': json({ evil: true }),
      'README.txt': new TextEncoder().encode('outside the root')
    })
    const report = await env.service.importZip(zip)
    expect(report.declaredFormat).toEqual({ major: 46, minor: 0 })
    expect(report.mappedVersion).toBe('1.21.4')
    // 1.21.4 is in the migration chain: paths are upgraded to 26.3 (stone kept its name).
    expect(report.warnings).toEqual([{ code: 'import.migrated' }])
    expect(report.renamed).toBe(0)
    expect(report.pack.authoringVersion).toBe('26.3')
    expect(report.pack.name).toBe('nested')
    expect(report.pack.description).toBe('Old one')
    const files = await listPack(report.pack.folder)
    expect(files).toEqual([
      '.blocksmith/project.json',
      T('block/stone.png'),
      'pack.mcmeta',
      'pack.png'
    ])
    const project = JSON.parse(
      await readFile(join(report.pack.folder, '.blocksmith/project.json'), 'utf8')
    )
    expect(project.evil).toBeUndefined()
  })

  it('upgrades an older pack: renamed textures move, removed ones are not imported', async () => {
    const zip = await zipFile('old.zip', {
      'pack.mcmeta': mcmeta({ pack_format: 46, description: 'From 1.21.4' }),
      [T('block/chain.png')]: makePng(16, 16, [0, 0, 255, 255]),
      [`${T('block/chain.png')}.mcmeta`]: json({ animation: {} }),
      [T('entity/pig/pig.png')]: makePng(64, 32, [0, 0, 255, 255]),
      [T('block/stone.png')]: makePng(16, 16, [0, 0, 255, 255])
    })
    const report = await env.service.importZip(zip)
    expect(report).toMatchObject({ mappedVersion: '1.21.4', renamed: 2, filesImported: 3 })
    expect(report.warnings).toEqual([
      { code: 'import.migrated' },
      { code: 'import.notInVersion', path: T('entity/pig/pig.png') }
    ])
    const files = await listPack(report.pack.folder)
    expect(files).toEqual(
      expect.arrayContaining([T('block/iron_chain.png'), `${T('block/iron_chain.png')}.mcmeta`])
    )
    expect(files).not.toContain(T('block/chain.png'))
    expect(files).not.toContain(T('entity/pig/pig.png'))
  })

  it('warns when the format is unknown or missing', async () => {
    const zip = await zipFile('weird.zip', {
      'pack.mcmeta': mcmeta({ pack_format: 3, description: 'Ancient' })
    })
    const report = await env.service.importZip(zip)
    expect(report.mappedVersion).toBeUndefined()
    expect(report.warnings).toEqual([{ code: 'import.formatMismatch' }])

    const noFormat = await zipFile('nof.zip', { 'pack.mcmeta': mcmeta({ description: 'x' }) })
    expect((await env.service.importZip(noFormat)).warnings).toEqual([
      { code: 'import.formatMissing' }
    ])
  })

  it('keeps everything and warns when the vanilla index is not ready', async () => {
    env.vanilla.indexes.clear()
    const vanilla = vanillaFiles()
    const zip = await zipFile('p.zip', {
      'pack.mcmeta': mcmeta({ min_format: 97, max_format: 97, description: 'x' }),
      [T('block/dirt.png')]: vanilla[T('block/dirt.png')]
    })
    const report = await env.service.importZip(zip)
    expect(report.identicalToVanilla).toBe(0)
    expect(report.filesImported).toBe(1)
    expect(report.warnings).toEqual([{ code: 'import.vanillaNotReady' }])
    expect(report.pack.changedCount).toBe(1)
  })

  it.each([
    ['../evil.png'],
    ['/etc/evil.png'],
    ['assets/../../evil.png'],
    ['assets\\..\\..\\evil.png'],
    ['C:/evil.png'],
    ['assets//evil.png']
  ])('rejects zip-slip entry %j and writes nothing', async (name) => {
    const zip = await zipFile('slip.zip', {
      'pack.mcmeta': mcmeta({ pack_format: 97 }),
      [name]: makePng(1, 1)
    })
    await expect(env.service.importZip(zip)).rejects.toMatchObject({ code: 'import.unsafePath' })
    await expect(readdir(env.service.packsDir())).resolves.toEqual([])
  })

  it('rejects too many entries and too large files', async () => {
    const small = await createTestEnv({
      overrides: { importLimits: { maxEntries: 5, maxTotalBytes: 5_000, maxFileBytes: 2_000 } }
    })
    try {
      const many: Record<string, Uint8Array> = { 'pack.mcmeta': mcmeta({ pack_format: 97 }) }
      for (let i = 0; i < 10; i++) many[`assets/x/f${i}.txt`] = new Uint8Array([i])
      await writeFile(join(small.root, 'many.zip'), zipSync(many))
      await expect(small.service.importZip(join(small.root, 'many.zip'))).rejects.toMatchObject({
        code: 'import.tooLarge',
        params: { reason: 'entries' }
      })

      const big = { 'pack.mcmeta': mcmeta({ pack_format: 97 }), 'big.bin': new Uint8Array(5_000) }
      await writeFile(join(small.root, 'big.zip'), zipSync(big))
      await expect(small.service.importZip(join(small.root, 'big.zip'))).rejects.toMatchObject({
        code: 'import.tooLarge',
        params: { reason: 'file' }
      })

      const total: Record<string, Uint8Array> = { 'pack.mcmeta': mcmeta({ pack_format: 97 }) }
      for (let i = 0; i < 3; i++) total[`b${i}.bin`] = new Uint8Array(1_900)
      await writeFile(join(small.root, 'total.zip'), zipSync(total))
      await expect(small.service.importZip(join(small.root, 'total.zip'))).rejects.toMatchObject({
        code: 'import.tooLarge',
        params: { reason: 'total' }
      })
    } finally {
      await small.cleanup()
    }
  })

  it('rejects zips without a pack root, ambiguous roots and invalid zips', async () => {
    const none = await zipFile('none.zip', { 'readme.txt': new Uint8Array([1]) })
    await expect(env.service.importZip(none)).rejects.toMatchObject({ code: 'import.notAPack' })

    const two = await zipFile('two.zip', {
      'a/pack.mcmeta': mcmeta({ pack_format: 97 }),
      'b/pack.mcmeta': mcmeta({ pack_format: 97 })
    })
    await expect(env.service.importZip(two)).rejects.toMatchObject({ code: 'import.notAPack' })

    const badMeta = await zipFile('bad.zip', { 'pack.mcmeta': new TextEncoder().encode('{ no') })
    await expect(env.service.importZip(badMeta)).rejects.toMatchObject({ code: 'import.notAPack' })

    const notZip = join(env.root, 'not.zip')
    await writeFile(notZip, 'this is not a zip file at all, just text that is long enough')
    await expect(env.service.importZip(notZip)).rejects.toMatchObject({ code: 'import.invalidZip' })
    await expect(env.service.importZip(join(env.root, 'missing.zip'))).rejects.toMatchObject({
      code: 'import.invalidZip'
    })
  })
})
