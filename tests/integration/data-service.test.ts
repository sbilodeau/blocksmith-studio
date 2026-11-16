import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PackCacheControl, PackService } from '../../src/main/services/packs'
import { VERSIONS, createTestEnv, json, vanillaFiles, type TestEnv } from './packs-fixtures'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

const { createDataService } = await import('../../src/main/services/packs')
const { createHistoryService } = await import('../../src/main/services/history')

const RECIPE = 'data/minecraft/recipe/stone_slab.json'
const LOOT = 'data/minecraft/loot_table/blocks/stone.json'
const TAG = 'data/minecraft/tags/item/stone_tool_materials.json'

const vanillaRecipe = {
  type: 'minecraft:crafting_shaped',
  key: { '#': 'minecraft:stone' },
  pattern: ['###'],
  result: { count: 6, id: 'minecraft:stone_slab' }
}

/** Vanilla 26.3 with data files, item definitions and blockstates (ids for warnings). */
function vanillaWithData(): Record<string, Uint8Array> {
  return {
    ...vanillaFiles(),
    'assets/minecraft/items/stone.json': json({ model: {} }),
    'assets/minecraft/items/stone_slab.json': json({ model: {} }),
    'assets/minecraft/blockstates/stone.json': json({ variants: {} }),
    [RECIPE]: json(vanillaRecipe),
    [LOOT]: json({ type: 'minecraft:block', pools: [] }),
    [TAG]: json({ values: ['minecraft:cobblestone'] })
  }
}

describe('data service', () => {
  let env: TestEnv
  let packs: PackService & PackCacheControl
  let history: ReturnType<typeof createHistoryService>
  let data: ReturnType<typeof createDataService>
  let packId: string
  let folder: string
  const notifyChanged = vi.fn()

  const packFile = (path: string): string => join(folder, ...path.split('/'))
  const exists = (path: string): Promise<boolean> =>
    stat(packFile(path)).then(
      () => true,
      () => false
    )
  async function put(path: string, text: string): Promise<void> {
    await mkdir(dirname(packFile(path)), { recursive: true })
    await writeFile(packFile(path), text)
  }

  beforeEach(async () => {
    env = await createTestEnv()
    await env.vanilla.addVersion('26.3', vanillaWithData())
    packs = env.service as PackService & PackCacheControl
    history = createHistoryService({
      locate: (id) => packs.locate(id),
      onFilesChanged: (location, paths) => packs.invalidate(location, paths),
      notifyChanged,
      warn: () => undefined
    })
    data = createDataService({ packs, vanilla: env.vanilla, history, notifyChanged })
    const pack = await packs.create({
      name: 'Data',
      base: 'vanilla',
      kind: 'data',
      authoringVersion: '26.3'
    })
    packId = pack.id
    folder = pack.folder
    notifyChanged.mockClear()
  })

  afterEach(() => env.cleanup())

  it('lists vanilla data and the pack files with their status', async () => {
    await put(
      RECIPE,
      JSON.stringify({ ...vanillaRecipe, result: { id: 'minecraft:stone_slab', count: 3 } })
    )
    // Same JSON as vanilla, other formatting: still "vanilla" for Minecraft.
    await put(TAG, '{"values":["minecraft:cobblestone"]}')
    await put('data/data/recipe/ruby.json', '{}')
    await put('data/data/function/start.mcfunction', 'say hi\n')
    await put('data/data/structure/house.nbt', 'x')
    const list = await data.list(packId)
    expect(list.vanillaData).toBe(true)
    expect(list.entries.map((e) => [e.path, e.kind, e.status])).toEqual([
      ['data/data/function/start.mcfunction', 'function', 'added'],
      ['data/data/recipe/ruby.json', 'recipe', 'added'],
      [LOOT, 'loot_table', 'vanilla'],
      [RECIPE, 'recipe', 'modified'],
      [TAG, 'tag', 'vanilla']
    ])
    expect(list.entries.find((e) => e.path === TAG)).toMatchObject({
      registry: 'item',
      id: 'minecraft:stone_tool_materials'
    })
    expect(list.ids.items).toEqual(['minecraft:stone', 'minecraft:stone_slab'])
    expect(list.ids.blocks).toEqual(['minecraft:stone'])
    expect(list.ids.tags).toEqual({ item: ['minecraft:stone_tool_materials'] })
    // The pack summary counts changed data files (the reformatted tag is a byte change).
    expect((await packs.get(packId)).changedCount).toBe(4)
  })

  it('lists only the pack files when the vanilla data cannot be added', async () => {
    env.vanilla.noData.add('26.3')
    await put('data/data/recipe/ruby.json', '{}')
    const list = await data.list(packId)
    expect(list.vanillaData).toBe(false)
    expect(list.entries.map((e) => e.path)).toEqual(['data/data/recipe/ruby.json'])
  })

  it('reads the pack file or vanilla', async () => {
    expect(await data.read(packId, RECIPE)).toMatchObject({
      origin: 'vanilla',
      text: JSON.stringify(vanillaRecipe, null, 2),
      vanillaText: JSON.stringify(vanillaRecipe, null, 2)
    })
    await put(RECIPE, '{"x":1}')
    expect(await data.read(packId, RECIPE)).toMatchObject({ origin: 'pack', text: '{"x":1}' })
    expect(await data.read(packId, 'data/data/recipe/none.json')).toEqual({
      path: 'data/data/recipe/none.json',
      text: null,
      origin: 'none',
      vanillaText: null
    })
  })

  it('saves as one history entry; a file equal to vanilla is removed instead', async () => {
    const text = JSON.stringify({ ...vanillaRecipe, pattern: ['## '] }, null, 2)
    await expect(data.save(packId, RECIPE, text)).resolves.toMatchObject({ status: 'modified' })
    expect(await readFile(packFile(RECIPE), 'utf8')).toBe(text)
    expect(notifyChanged).toHaveBeenCalledWith(packId)
    // Back to the vanilla content (other formatting): the pack's copy goes.
    await expect(data.save(packId, RECIPE, JSON.stringify(vanillaRecipe))).resolves.toMatchObject({
      status: 'vanilla'
    })
    expect(await exists(RECIPE)).toBe(false)
    const state = await history.get(packId)
    expect(state.entries.map((e) => e.label)).toEqual([
      { key: 'saveData', params: { name: 'stone_slab' } },
      { key: 'saveData', params: { name: 'stone_slab' } }
    ])
    await history.undo(packId)
    expect(await readFile(packFile(RECIPE), 'utf8')).toBe(text)
  })

  it('creates new files and refuses existing ones', async () => {
    const path = 'data/data/function/start.mcfunction'
    await expect(data.create(packId, path, 'say hi\n')).resolves.toMatchObject({
      kind: 'function',
      status: 'added'
    })
    expect(await readFile(packFile(path), 'utf8')).toBe('say hi\n')
    await expect(data.create(packId, path, 'x')).rejects.toMatchObject({ code: 'data.exists' })
    // A vanilla path is opened, not created.
    await expect(data.create(packId, LOOT, '{}')).rejects.toMatchObject({ code: 'data.exists' })
  })

  it('removes the pack copy, validates paths and sizes', async () => {
    await put(RECIPE, '{"x":1}')
    await data.remove(packId, RECIPE)
    expect(await exists(RECIPE)).toBe(false)
    await expect(data.remove(packId, RECIPE)).rejects.toMatchObject({ code: 'data.notInPack' })
    for (const bad of [
      'data/../x.json',
      'assets/minecraft/recipe/x.json',
      'data/x/recipe/A.json'
    ]) {
      await expect(data.save(packId, bad, '{}')).rejects.toMatchObject({ code: 'data.invalidPath' })
    }
    await expect(data.save(packId, RECIPE, 'x'.repeat(1024 * 1024 + 1))).rejects.toMatchObject({
      code: 'data.tooLarge'
    })
  })

  it('writes several files as one history entry (AI plans)', async () => {
    const entry = await data.saveMany(
      packId,
      [
        { path: 'data/data/recipe/a.json', text: '{"type":"minecraft:smelting"}' },
        { path: TAG, text: '{"values":["minecraft:stone"]}' }
      ],
      { source: 'ai', label: { key: 'aiDataFiles', params: { count: 2 } } }
    )
    expect(entry?.paths.sort()).toEqual(['data/data/recipe/a.json', TAG])
    expect(await exists('data/data/recipe/a.json')).toBe(true)
    expect(await data.saveMany(packId, [], { source: 'ai', label: { key: 'x' } })).toBeNull()
  })
})

describe('pack kinds', () => {
  let env: TestEnv
  beforeEach(async () => {
    env = await createTestEnv()
  })
  afterEach(() => env.cleanup())

  const mcmeta = async (folder: string): Promise<{ pack: Record<string, unknown> }> =>
    JSON.parse(await readFile(join(folder, 'pack.mcmeta'), 'utf8'))

  it('a data pack declares the data pack format; changing the kind rewrites it', async () => {
    const pack = await env.service.create({
      name: 'D',
      base: 'vanilla',
      kind: 'data',
      authoringVersion: '26.3'
    })
    expect(pack.kind).toBe('data')
    expect((await mcmeta(pack.folder)).pack).toMatchObject({
      pack_format: VERSIONS[0]!.dataPack.major
    })
    const combined = await env.service.updateMeta(pack.id, { kind: 'combined' })
    expect(combined.kind).toBe('combined')
    expect((await mcmeta(pack.folder)).pack).toMatchObject({
      pack_format: VERSIONS[0]!.resourcePack.major,
      description: ''
    })
    // Older projects (no kind) are resource packs.
    const old = await env.service.create({ name: 'R', base: 'vanilla', authoringVersion: '26.3' })
    expect(old.kind).toBe('resource')
  })

  it('exports a combined pack as both zips in one go', async () => {
    const pack = await env.service.create({
      name: 'Both',
      base: 'vanilla',
      kind: 'combined',
      authoringVersion: '26.3'
    })
    await mkdir(join(pack.folder, 'data/both/tags/item'), { recursive: true })
    await writeFile(join(pack.folder, 'data/both/tags/item/x.json'), '{"values":[]}')
    const out = join(env.root, 'out')
    await mkdir(out)
    const reports = await env.service.exportMany(pack.id, ['26.3'], out, {
      packTypes: ['resource', 'data']
    })
    expect(reports.map((r) => [r.packType, r.outputPath.slice(out.length + 1)])).toEqual([
      ['resource', 'both-26.3-resource-pack.zip'],
      ['data', 'both-26.3-data-pack.zip']
    ])
  })

  it('Pack Doctor flags data files Minecraft would reject or that name unknown ids', async () => {
    const pack = await env.service.create({
      name: 'Doc',
      base: 'vanilla',
      kind: 'data',
      authoringVersion: '26.3'
    })
    await env.vanilla.addVersion('26.3', {
      ...vanillaFiles(),
      'assets/minecraft/items/stone.json': json({})
    })
    const put = async (path: string, text: string): Promise<void> => {
      await mkdir(dirname(join(pack.folder, path)), { recursive: true })
      await writeFile(join(pack.folder, path), text)
    }
    await put('data/doc/recipe/bad.json', '{"type":"minecraft:smelting"}')
    await put(
      'data/doc/recipe/odd.json',
      '{"type":"minecraft:stonecutting","ingredient":"minecraft:stone","result":{"id":"minecraft:rubyy"}}'
    )
    await put(
      'data/doc/recipe/ok.json',
      '{"type":"minecraft:stonecutting","ingredient":"minecraft:stone","result":{"id":"minecraft:stone"}}'
    )
    await put('data/doc/recipe/broken.json', '{')
    const report = await env.service.doctor(pack.id)
    expect(report.issues.filter((i) => i.path?.startsWith('data/'))).toEqual([
      { code: 'export.invalidJson', path: 'data/doc/recipe/broken.json' },
      { code: 'doctor.invalidData', path: 'data/doc/recipe/bad.json' },
      { code: 'doctor.dataWarnings', path: 'data/doc/recipe/odd.json' }
    ])
  })
})
