import { readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CustomItemSchema, itemPreset, type CustomItem, type CustomItemInput } from '@shared/items'
import type { PackCacheControl, PackService } from '../../src/main/services/packs'
import {
  VERSIONS,
  createTestEnv,
  json,
  makePng,
  T,
  vanillaFiles,
  type TestEnv
} from './packs-fixtures'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

const { createDataService } = await import('../../src/main/services/packs')
const { createHistoryService } = await import('../../src/main/services/history')
const { createItemService } = await import('../../src/main/services/items')

function vanilla(): Record<string, Uint8Array> {
  return {
    ...vanillaFiles(),
    [T('item/diamond_sword.png')]: makePng(16, 16, [90, 220, 220, 255]),
    'assets/minecraft/items/apple.json': json({
      model: { type: 'minecraft:model', model: 'minecraft:item/apple' }
    }),
    'assets/minecraft/models/item/apple.json': json({
      parent: 'minecraft:item/generated',
      textures: { layer0: 'minecraft:item/apple' }
    }),
    'assets/minecraft/items/stone_sword.json': json({ model: {} }),
    'assets/minecraft/lang/en_us.json': json({ 'item.minecraft.apple': 'Apple' }),
    'data/minecraft/recipe/golden_apple.json': json({
      type: 'minecraft:crafting_shaped',
      pattern: ['###', '#A#', '###'],
      key: { '#': 'minecraft:gold_ingot', A: 'minecraft:apple' },
      result: { id: 'minecraft:golden_apple' }
    }),
    'data/minecraft/tags/item/fruits.json': json({ values: ['minecraft:apple'] })
  }
}

function sword(patch: Partial<CustomItemInput> = {}): CustomItem {
  return CustomItemSchema.parse({
    schemaVersion: 1,
    id: 'ruby_sword',
    namespace: 'gems',
    names: { en_us: 'Ruby Sword', fr_fr: 'Épée en rubis' },
    ...itemPreset('weapon').item,
    ...patch
  })
}

describe('item service', () => {
  let env: TestEnv
  let packs: PackService & PackCacheControl
  let history: ReturnType<typeof createHistoryService>
  let items: ReturnType<typeof createItemService>
  let packId: string
  let folder: string
  const notifyChanged = vi.fn()

  const packFile = (path: string): string => join(folder, ...path.split('/'))
  const exists = (path: string): Promise<boolean> =>
    stat(packFile(path)).then(
      () => true,
      () => false
    )
  const readJson = async (path: string): Promise<unknown> =>
    JSON.parse(await readFile(packFile(path), 'utf8'))

  beforeEach(async () => {
    env = await createTestEnv()
    await env.vanilla.addVersion('26.3', vanilla())
    await env.vanilla.addVersion('1.21.4', vanilla())
    packs = env.service as PackService & PackCacheControl
    history = createHistoryService({
      locate: (id) => packs.locate(id),
      onFilesChanged: (location, paths) => packs.invalidate(location, paths),
      notifyChanged,
      warn: () => undefined
    })
    const data = createDataService({ packs, vanilla: env.vanilla, history, notifyChanged })
    items = createItemService({ packs, vanilla: env.vanilla, history, data, notifyChanged })
    const pack = await packs.create({
      name: 'Gems',
      base: 'empty',
      kind: 'combined',
      authoringVersion: '26.3'
    })
    packId = pack.id
    folder = pack.folder
    notifyChanged.mockClear()
  })

  afterEach(async () => {
    await env.cleanup()
  })

  it('creates an item as one undoable history entry', async () => {
    expect(await items.list(packId)).toEqual({ items: [], invalid: [], namespace: 'gems' })
    const summary = await items.create(packId, sword(), T('item/diamond_sword.png'))
    expect(summary).toMatchObject({ id: 'ruby_sword', kind: 'weapon', hasTexture: true })
    expect(notifyChanged).toHaveBeenCalledWith(packId)
    for (const path of [
      'blocksmith/items/ruby_sword.json',
      'assets/gems/textures/item/ruby_sword.png',
      'assets/gems/items/ruby_sword.json',
      'assets/gems/models/item/ruby_sword.json',
      'data/gems/function/give/ruby_sword.mcfunction'
    ]) {
      expect(await exists(path)).toBe(true)
    }
    expect(await readJson('assets/gems/lang/fr_fr.json')).toEqual({
      'item.gems.ruby_sword': 'Épée en rubis'
    })
    expect(await items.read(packId, 'ruby_sword')).toEqual(sword())
    const state = await history.get(packId)
    expect(state.entries).toHaveLength(1)
    expect(state.entries[0]!.label).toEqual({ key: 'createItem', params: { name: 'Ruby Sword' } })

    await history.undo(packId)
    expect(await exists('blocksmith/items/ruby_sword.json')).toBe(false)
    expect(await exists('assets/gems/textures/item/ruby_sword.png')).toBe(false)
    expect(await exists('assets/gems/lang/en_us.json')).toBe(false)
  })

  it('refuses packs that are not combined, existing ids and unknown textures', async () => {
    const res = await packs.create({ name: 'Res', base: 'empty', authoringVersion: '26.3' })
    await expect(items.create(res.id, sword(), null)).rejects.toMatchObject({
      code: 'items.needsCombined'
    })
    await items.create(packId, sword(), null)
    await expect(items.create(packId, sword(), null)).rejects.toMatchObject({
      code: 'items.exists'
    })
    await expect(
      items.create(packId, sword({ id: 'other' }), T('item/nope.png'))
    ).rejects.toMatchObject({ code: 'items.invalidTexture' })
  })

  it('saves, renames and deletes', async () => {
    await items.create(packId, sword(), null)
    await writeFile(
      packFile('assets/gems/lang/en_us.json'),
      JSON.stringify({ 'item.gems.ruby_sword': 'Ruby Sword', 'item.gems.keep': 'Keep' })
    )
    await items.save(
      packId,
      'ruby_sword',
      sword({ recipe: { type: 'shapeless', ingredients: ['minecraft:apple'] } })
    )
    expect(await exists('data/gems/recipe/ruby_sword.json')).toBe(true)

    await items.save(packId, 'ruby_sword', sword({ id: 'ruby_blade' }))
    expect(await exists('blocksmith/items/ruby_sword.json')).toBe(false)
    expect(await exists('data/gems/recipe/ruby_sword.json')).toBe(false)
    expect(await exists('assets/gems/textures/item/ruby_sword.png')).toBe(false)
    expect(await exists('assets/gems/textures/item/ruby_blade.png')).toBe(true)
    expect(await readJson('assets/gems/lang/en_us.json')).toEqual({
      'item.gems.keep': 'Keep',
      'item.gems.ruby_blade': 'Ruby Sword'
    })
    expect((await history.get(packId)).entries[0]!.label.key).toBe('renameItem')

    await items.remove(packId, 'ruby_blade')
    expect((await items.list(packId)).items).toEqual([])
    expect(await exists('assets/gems/textures/item/ruby_blade.png')).toBe(false)
    expect(await readJson('assets/gems/lang/en_us.json')).toEqual({ 'item.gems.keep': 'Keep' })
  })

  it('applies several operations as one entry and creates armor textures', async () => {
    const helmet = CustomItemSchema.parse({
      schemaVersion: 1,
      id: 'ruby_helmet',
      namespace: 'gems',
      names: { en_us: 'Ruby Helmet' },
      ...itemPreset('armor', 'head').item
    })
    const entry = await items.applyMany(
      packId,
      [
        { op: 'write', item: sword(), textureFrom: T('item/apple.png') },
        { op: 'write', item: helmet }
      ],
      { source: 'ai', label: { key: 'aiItems', params: { count: 2 } } }
    )
    expect(entry?.paths).toContain('assets/gems/equipment/ruby_helmet.json')
    expect(await exists('assets/gems/textures/entity/equipment/humanoid/ruby_helmet.png')).toBe(
      true
    )
    expect((await history.get(packId)).entries).toHaveLength(1)
    expect((await items.list(packId)).items.map((i) => i.id)).toEqual(['ruby_helmet', 'ruby_sword'])
    expect(
      await items.forTexture(packId, 'assets/gems/textures/item/ruby_helmet.png')
    ).toMatchObject({
      id: 'ruby_helmet'
    })
  })

  it('lists vanilla items and recipe uses of a base item', async () => {
    const catalog = await items.catalog(packId)
    expect(catalog.items).toContainEqual({
      id: 'minecraft:apple',
      name: 'Apple',
      icon: T('item/apple.png')
    })
    expect(catalog.tags).toEqual(['#minecraft:fruits'])
    expect(await items.context(packId, 'minecraft:apple')).toEqual({
      baseRecipeUses: ['minecraft:golden_apple']
    })
    expect(await items.context(packId, 'minecraft:stone_sword')).toEqual({ baseRecipeUses: [] })
  })

  it('exports in the target format without blocksmith/, and the doctor checks items', async () => {
    await items.create(packId, sword(), null)
    const modern = await packs.exportFiles(packId, '26.3', { packType: 'resource' })
    const paths = modern.collected.files.map((f) => f.path)
    expect(paths.some((p) => p.startsWith('blocksmith/'))).toBe(false)
    expect(paths).toContain('assets/gems/items/ruby_sword.json')

    const old = await packs.exportFiles(packId, '1.21.4', { packType: 'data' })
    const give = old.collected.files.find((f) => f.path.endsWith('ruby_sword.mcfunction'))!
    expect(new TextDecoder().decode(give.data)).toContain('show_in_tooltip:true')

    expect((await packs.doctor(packId)).issues.filter((i) => i.code.startsWith('items.'))).toEqual(
      []
    )
    await writeFile(packFile('assets/gems/models/item/ruby_sword.json'), '{}')
    const issues = (await packs.doctor(packId)).issues.filter((i) => i.code.startsWith('items.'))
    expect(issues).toEqual([
      {
        code: 'items.generatedEdited',
        path: 'assets/gems/models/item/ruby_sword.json',
        itemId: 'ruby_sword'
      }
    ])
    await items.regenerate(packId, 'ruby_sword')
    expect((await packs.doctor(packId)).issues.filter((i) => i.code.startsWith('items.'))).toEqual(
      []
    )
  })

  it('marks generated data files', async () => {
    await items.create(packId, sword(), null)
    const data = createDataService({ packs, vanilla: env.vanilla, history, notifyChanged })
    const file = await data.read(packId, 'data/gems/function/give/ruby_sword.mcfunction')
    expect(file.generatedBy).toBe('ruby_sword')
    expect(VERSIONS.length).toBeGreaterThan(0)
  })
})
