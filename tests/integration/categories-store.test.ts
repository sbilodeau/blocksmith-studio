import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CATEGORY_RULES, type CategoryRule } from '@shared/categories'
import type { PackSummary } from '@shared/model/pack'
import { CategoryMappingStore } from '../../src/main/services/categories'
import { AppErrorException } from '../../src/main/ipc/registry'
import { T, createTestEnv, type TestEnv } from './packs-fixtures'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

const custom = (id: string, label: string, include: string[], order = 500): CategoryRule => ({
  id,
  label,
  icon: '',
  include,
  order
})

async function rejection(promise: Promise<unknown>): Promise<AppErrorException> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e
  )
  expect(err).toBeInstanceOf(AppErrorException)
  return err as AppErrorException
}

describe('CategoryMappingStore', () => {
  let dir: string
  let store: CategoryMappingStore

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'blocksmith-categories-'))
    store = CategoryMappingStore.forUserData(dir)
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('uses the defaults when the file is missing', async () => {
    const state = await store.load()
    expect(state).toEqual({ rules: [...DEFAULT_CATEGORY_RULES], customized: false })
    expect(store.savedRules()).toBeNull()
  })

  it('saves the whole mapping to userData/categories.json and reads it back', async () => {
    await store.load()
    const rules = [...DEFAULT_CATEGORY_RULES, custom('swords', 'My swords', ['item/*_sword.png'])]
    const state = await store.save(rules)
    expect(state.customized).toBe(true)
    expect(state.rules.at(-1)).toMatchObject({ id: 'swords', label: 'My swords' })
    const file = JSON.parse(await readFile(join(dir, 'categories.json'), 'utf8'))
    expect(file.schemaVersion).toBe(1)
    expect(file.categories).toHaveLength(DEFAULT_CATEGORY_RULES.length + 1)

    const again = CategoryMappingStore.forUserData(dir)
    expect((await again.load()).rules.at(-1)).toMatchObject({ id: 'swords' })
  })

  it('falls back to the defaults on an invalid file and keeps a backup', async () => {
    await writeFile(join(dir, 'categories.json'), '{ not json')
    expect((await store.load()).customized).toBe(false)
    expect(await readFile(join(dir, 'categories.json.bak'), 'utf8')).toBe('{ not json')

    await writeFile(
      join(dir, 'categories.json'),
      JSON.stringify({ schemaVersion: 1, categories: [custom('x', 'X', ['a/{b'])] })
    )
    expect((await store.load()).customized).toBe(false)
  })

  it('refuses invalid globs and duplicate ids with typed errors', async () => {
    await store.load()
    const glob = await rejection(store.save([custom('fire', 'Fire', ['block/{fire'])]))
    expect(glob.code).toBe('categories.invalidGlob')
    expect(glob.params).toEqual({ category: 'fire', glob: 'block/{fire' })

    const dup = await rejection(
      store.save([custom('fire', 'Fire', ['a/**']), custom('fire', 'Fire 2', ['b/**'])])
    )
    expect(dup.code).toBe('categories.duplicateId')

    const label = await rejection(store.save([{ ...custom('fire', 'x', []), label: undefined }]))
    expect(label.code).toBe('categories.invalidRule')
    expect(store.savedRules()).toBeNull()
  })

  it('reset removes the file', async () => {
    await store.save([...DEFAULT_CATEGORY_RULES])
    await stat(join(dir, 'categories.json'))
    const state = await store.reset()
    expect(state.customized).toBe(false)
    await expect(stat(join(dir, 'categories.json'))).rejects.toThrow()
  })
})

describe('pack service with edited categories', () => {
  let env: TestEnv
  let pack: PackSummary
  let saved: CategoryRule[] | null

  beforeEach(async () => {
    saved = null
    env = await createTestEnv({ overrides: { categoryRules: () => saved } })
    pack = await env.service.create({ name: 'Cats', base: 'vanilla', authoringVersion: '26.3' })
  })

  afterEach(async () => {
    await env.cleanup()
  })

  const categoriesOf = async (path: string): Promise<string[]> =>
    (await env.service.textures(pack.id)).find((e) => e.path === path)!.categories

  it('recomputes texture categories and summaries when the "All packs" mapping changes', async () => {
    expect(await categoriesOf(T('item/apple.png'))).toEqual(['food'])
    saved = [
      ...DEFAULT_CATEGORY_RULES.filter((r) => r.id !== 'food'),
      { ...DEFAULT_CATEGORY_RULES.find((r) => r.id === 'food')!, hidden: true },
      custom('fruit', 'Fruit', ['item/apple.png'], 55)
    ]
    expect(await categoriesOf(T('item/apple.png'))).toEqual(['fruit'])
    const summaries = await env.service.categories(pack.id)
    expect(summaries.find((c) => c.id === 'fruit')).toMatchObject({
      label: 'Fruit',
      count: 1,
      changedCount: 0
    })
    expect(summaries.find((c) => c.id === 'fruit')?.i18nKey).toBeUndefined()
    expect(summaries.some((c) => c.id === 'food')).toBe(false)

    // Back to the defaults: the cached index is re-categorized again.
    saved = null
    expect(await categoriesOf(T('item/apple.png'))).toEqual(['food'])
  })

  it('stores pack rules in project.json and applies them on top of the user mapping', async () => {
    expect(await env.service.categoryOverrides(pack.id)).toEqual([])
    saved = [...DEFAULT_CATEGORY_RULES, custom('mobs', 'Mobs', ['entity/**'], 85)]
    const overrides = [
      { ...DEFAULT_CATEGORY_RULES.find((r) => r.id === 'ores')!, include: ['block/stone.png'] },
      custom('hud', 'HUD', ['gui/sprites/hud/**'], 95)
    ]
    expect(await env.service.setCategoryOverrides(pack.id, overrides)).toEqual(overrides)
    expect(env.deps.notifyChanged).toHaveBeenLastCalledWith(pack.id)

    const project = JSON.parse(
      await readFile(join(pack.folder, '.blocksmith/project.json'), 'utf8')
    )
    expect(project.categoryOverrides).toEqual(overrides)
    expect(await env.service.categoryOverrides(pack.id)).toEqual(overrides)

    expect(await categoriesOf(T('block/stone.png'))).toEqual(['blocks', 'ores'])
    expect(await categoriesOf(T('block/diamond_ore.png'))).toEqual(['blocks'])
    expect(await categoriesOf(T('entity/zombie/zombie.png'))).toEqual(['entities', 'mobs'])
    expect(await categoriesOf(T('gui/sprites/hud/heart/full.png'))).toEqual(['gui', 'hud'])
    const rules = await env.service.categoryRules(pack.id)
    expect(rules.find((r) => r.id === 'hud')?.label).toBe('HUD')
    // The catalog (creation agent) uses the same categories.
    const catalog = await env.service.catalog(pack.id)
    expect(catalog.find((e) => e.path === T('block/stone.png'))!.categories).toEqual([
      'blocks',
      'ores'
    ])

    // An empty list removes the field.
    await env.service.setCategoryOverrides(pack.id, [])
    const cleared = JSON.parse(
      await readFile(join(pack.folder, '.blocksmith/project.json'), 'utf8')
    )
    expect(cleared.categoryOverrides).toBeUndefined()
    expect(await categoriesOf(T('block/stone.png'))).toEqual(['blocks'])
  })

  it('refuses invalid pack rules without writing', async () => {
    const err = await rejection(
      env.service.setCategoryOverrides(pack.id, [custom('fire', 'Fire', ['\\block\\fire.png'])])
    )
    expect(err.code).toBe('categories.invalidGlob')
    expect(await env.service.categoryOverrides(pack.id)).toEqual([])
  })

  it('keeps other packs on the user mapping', async () => {
    const other = await env.service.create({
      name: 'Other',
      base: 'vanilla',
      authoringVersion: '26.3'
    })
    await env.service.setCategoryOverrides(pack.id, [custom('hud', 'HUD', ['gui/**'], 95)])
    const entries = await env.service.textures(other.id)
    expect(entries.find((e) => e.path === T('gui/sprites/hud/heart/full.png'))!.categories).toEqual(
      ['gui']
    )
  })
})
