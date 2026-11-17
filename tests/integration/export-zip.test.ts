import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PackSummary } from '@shared/model/pack'
import { T, createTestEnv, json, makePng, vanillaFiles, type TestEnv } from './packs-fixtures'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

async function put(folder: string, path: string, data: Uint8Array | string): Promise<void> {
  const abs = join(folder, ...path.split('/'))
  await mkdir(dirname(abs), { recursive: true })
  await writeFile(abs, data)
}

describe('export .zip', () => {
  let env: TestEnv
  let pack: PackSummary

  beforeEach(async () => {
    env = await createTestEnv()
    pack = await env.service.create({
      name: 'Fire Pack',
      description: 'Hot stuff',
      base: 'vanilla',
      authoringVersion: '26.3'
    })
  })

  afterEach(async () => {
    await env.cleanup()
  })

  it('suggests "<slug>-<version>-<type>-pack.zip" and only allows the authoring version or a newer snapshot', async () => {
    await expect(env.service.exportFileName(pack.id, '26.3')).resolves.toBe(
      'fire-pack-26.3-resource-pack.zip'
    )
    await expect(env.service.exportFileName(pack.id, '26.3', 'data')).resolves.toBe(
      'fire-pack-26.3-data-pack.zip'
    )
    await expect(env.service.exportFileName(pack.id, '26.4-snapshot-8')).resolves.toBe(
      'fire-pack-26.4-snapshot-8-resource-pack.zip'
    )
    // Older releases of the support window are reachable through the migration chain.
    await expect(env.service.exportFileName(pack.id, '1.21.4')).resolves.toBe(
      'fire-pack-1.21.4-resource-pack.zip'
    )
    await expect(env.service.exportFileName(pack.id, '1.20.1')).rejects.toMatchObject({
      code: 'export.targetNotSupported',
      params: { target: '1.20.1', authoring: '26.3' }
    })
  })

  it('writes only changed files plus a regenerated pack.mcmeta, skipping identical ones', async () => {
    const vanilla = vanillaFiles()
    await put(pack.folder, T('block/stone.png'), makePng(16, 16, [255, 0, 0, 255]))
    await put(pack.folder, T('block/dirt.png'), vanilla[T('block/dirt.png')])
    await put(pack.folder, 'assets/minecraft/lang/xx_yy.json', json({ a: 'b' }))
    await put(pack.folder, '.blocksmith/style-brief.json', json({ secret: true }))
    await put(pack.folder, '.git/HEAD', 'ref: refs/heads/main')
    await put(pack.folder, 'assets/.DS_Store', 'junk')
    await put(pack.folder, 'Thumbs.db', 'junk')
    await put(
      pack.folder,
      'pack.mcmeta',
      JSON.stringify({
        pack: { pack_format: 1, description: 'stale' },
        language: { xx_yy: { name: 'X', region: 'Y', bidirectional: false } }
      })
    )

    const out = join(env.root, 'out', 'fire.zip')
    const report = await env.service.exportPack(pack.id, '26.3', out)
    const zip = unzipSync(new Uint8Array(await readFile(out)))
    expect(Object.keys(zip)).toEqual([
      'pack.mcmeta',
      'pack.png',
      'assets/minecraft/lang/xx_yy.json',
      T('block/stone.png')
    ])
    const mcmeta = JSON.parse(strFromU8(zip['pack.mcmeta']))
    expect(mcmeta.pack.description).toBe('Hot stuff')
    expect(mcmeta.pack.pack_format).not.toBe(1)
    expect(mcmeta.language).toEqual({ xx_yy: { name: 'X', region: 'Y', bidirectional: false } })
    // Same layout as hand-written files: number arrays on one line.
    expect(strFromU8(zip['pack.mcmeta'])).toContain('"min_format": [97, 0],')
    expect(Object.keys(mcmeta)[0]).toBe('pack')

    expect(report).toMatchObject({
      outputPath: out,
      targetVersion: '26.3',
      filesWritten: 4,
      skipped: [{ path: T('block/dirt.png'), reason: 'identicalToVanilla' }],
      warnings: []
    })
    expect(report.sizeBytes).toBe((await readFile(out)).byteLength)
    expect(env.progress.filter((p) => p.kind === 'pack.export').map((p) => p.phase)).toContain(
      'collect'
    )
    expect(env.progress.filter((p) => p.kind === 'pack.export').map((p) => p.phase)).toContain(
      'write'
    )
  })

  it('"accept newer versions" opens max_format in the exported pack.mcmeta', async () => {
    const pack = await env.service.create({
      name: 'Open',
      description: '',
      base: 'vanilla',
      authoringVersion: '26.3'
    })
    const out = join(env.root, 'open.zip')
    await env.service.exportPack(pack.id, '26.3', out, { acceptNewer: true })
    const mcmeta = JSON.parse(
      strFromU8(unzipSync(new Uint8Array(await readFile(out)))['pack.mcmeta'])
    )
    // min_format stays the target's format (97.x in the fixture), only max_format opens.
    expect(mcmeta.pack.min_format[0]).toBe(97)
    expect(mcmeta.pack.max_format).toBe(999)
    // The pack folder's own pack.mcmeta is untouched.
    const own = JSON.parse(await readFile(join(pack.folder, 'pack.mcmeta'), 'utf8'))
    expect(own.pack.max_format).toEqual([97, 0])
  })

  it('exports to a newer snapshot with its pack format, skipping files identical to the authoring vanilla', async () => {
    const vanilla = vanillaFiles()
    await put(pack.folder, T('block/stone.png'), makePng(16, 16, [255, 0, 0, 255]))
    await put(pack.folder, T('block/dirt.png'), vanilla[T('block/dirt.png')])
    const out = join(env.root, 'snap.zip')
    const report = await env.service.exportPack(pack.id, '26.4-snapshot-8', out)
    const zip = unzipSync(new Uint8Array(await readFile(out)))
    expect(Object.keys(zip)).toEqual(['pack.mcmeta', 'pack.png', T('block/stone.png')])
    const mcmeta = JSON.parse(strFromU8(zip['pack.mcmeta']))
    expect(mcmeta.pack).toEqual({
      pack_format: 103,
      min_format: [103, 0],
      max_format: [103, 0],
      description: 'Hot stuff'
    })
    expect(report).toMatchObject({
      targetVersion: '26.4-snapshot-8',
      skipped: [{ path: T('block/dirt.png'), reason: 'identicalToVanilla' }],
      warnings: []
    })
  })

  it('keeps data/ files out of a resource pack and puts only them in a data pack, with its format', async () => {
    await put(pack.folder, T('block/stone.png'), makePng(16, 16, [255, 0, 0, 255]))
    await put(
      pack.folder,
      'data/fire/recipe/torch.json',
      json({
        type: 'minecraft:crafting_shapeless',
        ingredients: ['minecraft:coal'],
        result: { id: 'minecraft:torch' }
      })
    )

    const resourceOut = join(env.root, 'r.zip')
    const resource = await env.service.exportPack(pack.id, '26.3', resourceOut)
    const rzip = unzipSync(new Uint8Array(await readFile(resourceOut)))
    expect(Object.keys(rzip)).toEqual(['pack.mcmeta', 'pack.png', T('block/stone.png')])
    expect(resource).toMatchObject({
      packType: 'resource',
      warnings: [{ code: 'export.dataLeftOut' }]
    })

    const dataOut = join(env.root, 'd.zip')
    const data = await env.service.exportPack(pack.id, '26.3', dataOut, { packType: 'data' })
    const dzip = unzipSync(new Uint8Array(await readFile(dataOut)))
    expect(Object.keys(dzip)).toEqual(['pack.mcmeta', 'pack.png', 'data/fire/recipe/torch.json'])
    // The fixture's 26.3 data pack format is 120.0.
    expect(JSON.parse(strFromU8(dzip['pack.mcmeta'])).pack).toEqual({
      pack_format: 120,
      min_format: [120, 0],
      max_format: [120, 0],
      description: 'Hot stuff'
    })
    expect(data).toMatchObject({ packType: 'data', warnings: [{ code: 'export.assetsLeftOut' }] })
  })

  it('warns that a data pack is empty when the pack has no data/ files', async () => {
    await put(pack.folder, T('block/stone.png'), makePng(16, 16, [255, 0, 0, 255]))
    const report = await env.service.exportPack(pack.id, '26.3', join(env.root, 'e.zip'), {
      packType: 'data'
    })
    expect(report.warnings.map((w) => w.code)).toEqual([
      'export.assetsLeftOut',
      'export.noDataFiles'
    ])
  })

  it('exports to an older release: renamed textures, missing ones skipped, its pack format', async () => {
    await put(pack.folder, T('block/iron_chain.png'), makePng(16, 16, [255, 0, 0, 255]))
    await put(pack.folder, `${T('block/iron_chain.png')}.mcmeta`, json({ animation: {} }))
    await put(pack.folder, T('entity/cow/cow_temperate.png'), makePng(64, 32, [255, 0, 0, 255]))
    await put(pack.folder, T('block/stone.png'), makePng(16, 16, [0, 255, 0, 255]))
    await put(
      pack.folder,
      'assets/minecraft/models/block/stone.json',
      json({ parent: 'block/cube_all' })
    )
    const out = join(env.root, 'old.zip')
    const report = await env.service.exportPack(pack.id, '1.21.4', out)
    const zip = unzipSync(new Uint8Array(await readFile(out)))
    expect(Object.keys(zip).sort()).toEqual([
      'assets/minecraft/models/block/stone.json',
      T('block/chain.png'),
      `${T('block/chain.png')}.mcmeta`,
      T('block/stone.png'),
      'pack.mcmeta',
      'pack.png'
    ])
    expect(JSON.parse(strFromU8(zip['pack.mcmeta'])).pack).toEqual({
      pack_format: 46,
      description: 'Hot stuff'
    })
    expect(report).toMatchObject({ targetVersion: '1.21.4', renamed: 2 })
    expect(report.skipped).toEqual([
      { path: T('entity/cow/cow_temperate.png'), reason: 'notInTarget' }
    ])
    expect(report.warnings.map((w) => w.code)).toEqual(
      expect.arrayContaining(['export.vanillaNotReady', 'export.otherFilesAsIs'])
    )
  })

  it('exports one zip per target into a folder and remembers the export profile', async () => {
    await put(pack.folder, T('block/stone.png'), makePng(16, 16, [255, 0, 0, 255]))
    const folder = join(env.root, 'many')
    await mkdir(folder, { recursive: true })
    const reports = await env.service.exportMany(pack.id, ['26.3', '1.21.4', '26.3'], folder, {
      acceptNewer: true
    })
    expect(reports.map((r) => r.outputPath.split(/[\\/]/).pop())).toEqual([
      'fire-pack-26.3-resource-pack.zip',
      'fire-pack-1.21.4-resource-pack.zip'
    ])
    const old = JSON.parse(
      strFromU8(unzipSync(new Uint8Array(await readFile(reports[1]!.outputPath)))['pack.mcmeta'])
    )
    // pack_format target + "accept newer": both declarations, open range.
    expect(old.pack).toMatchObject({ pack_format: 46, max_format: 999 })
    await expect(env.service.exportMany(pack.id, ['26.3', '1.20.1'], folder)).rejects.toMatchObject(
      { code: 'export.targetNotSupported' }
    )

    expect((await env.service.get(pack.id)).exportProfile).toBeUndefined()
    await env.service.saveExportProfile(pack.id, { targets: ['26.3', '1.21.4'], acceptNewer: true })
    expect((await env.service.get(pack.id)).exportProfile).toEqual({
      targets: ['26.3', '1.21.4'],
      acceptNewer: true
    })
  })

  it('produces byte-identical zips for the same content', async () => {
    await put(pack.folder, T('block/stone.png'), makePng(16, 16, [255, 0, 0, 255]))
    await put(pack.folder, T('item/zzz.png'), makePng(16, 16, [0, 255, 0, 255]))
    await put(
      pack.folder,
      'assets/minecraft/models/item/zzz.json',
      json({ parent: 'item/generated' })
    )
    const a = join(env.root, 'a.zip')
    const b = join(env.root, 'b.zip')
    await env.service.exportPack(pack.id, '26.3', a)
    await new Promise((r) => setTimeout(r, 1100))
    await env.service.exportPack(pack.id, '26.3', b)
    expect(Buffer.compare(await readFile(a), await readFile(b))).toBe(0)
  })

  it('reports validation warnings (never silently)', async () => {
    await put(pack.folder, T('block/broken.png'), 'not a png')
    await put(pack.folder, T('block/odd.png'), makePng(15, 15))
    await put(pack.folder, T('gui/odd_but_fine.png'), makePng(182, 5))
    await put(pack.folder, T('block/strip.png'), makePng(16, 40))
    await put(pack.folder, T('block/strip.png.mcmeta'), json({ animation: {} }))
    await put(pack.folder, T('block/Upper.png'), makePng(16, 16))
    await put(pack.folder, 'assets/minecraft/models/block/bad.json', '{ nope')
    await put(pack.folder, 'pack.mcmeta', '{ broken')

    const report = await env.service.exportPack(pack.id, '26.3', join(env.root, 'w.zip'))
    const codes = report.warnings.map((w) => `${w.code} ${w.path ?? ''}`.trim()).sort()
    expect(codes).toEqual(
      [
        `export.animationMismatch ${T('block/strip.png')}`,
        `export.invalidJson assets/minecraft/models/block/bad.json`,
        'export.invalidMcmeta pack.mcmeta',
        `export.invalidPath ${T('block/Upper.png')}`,
        `export.invalidPng ${T('block/broken.png')}`,
        `export.nonPowerOfTwo ${T('block/odd.png')}`
      ].sort()
    )
  })

  it('warns when vanilla is not extracted and when pack.png is missing', async () => {
    const { rm } = await import('node:fs/promises')
    await rm(join(pack.folder, 'pack.png'))
    env.vanilla.indexes.clear()
    const report = await env.service.exportPack(pack.id, '26.3', join(env.root, 'n.zip'))
    expect(report.warnings).toEqual([
      { code: 'export.vanillaNotReady' },
      { code: 'export.missingPackPng' }
    ])
  })
})
