import { mkdir, utimes, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PackSummary, TextureEntry } from '@shared/model/pack'
import { T, createTestEnv, json, makePng, vanillaFiles, type TestEnv } from './packs-fixtures'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

async function put(folder: string, path: string, data: Uint8Array): Promise<void> {
  const abs = join(folder, ...path.split('/'))
  await mkdir(dirname(abs), { recursive: true })
  await writeFile(abs, data)
}

const byPath = (entries: TextureEntry[]): Map<string, TextureEntry> =>
  new Map(entries.map((e) => [e.path, e]))

describe('texture index', () => {
  let env: TestEnv
  let pack: PackSummary

  beforeEach(async () => {
    env = await createTestEnv()
    pack = await env.service.create({ name: 'Tex', base: 'vanilla', authoringVersion: '26.3' })
  })

  afterEach(async () => {
    await env.cleanup()
  })

  it('lists vanilla textures only (no models, no pack.png) with metadata from the index', async () => {
    const entries = await env.service.textures(pack.id)
    expect(entries.map((e) => e.path)).toEqual([
      T('block/diamond_ore.png'),
      T('block/dirt.png'),
      T('block/grass_block_side.png'),
      T('block/stone.png'),
      T('block/water_still.png'),
      T('entity/zombie/zombie.png'),
      T('gui/sprites/hud/heart/full.png'),
      T('item/apple.png'),
      T('item/diamond_pickaxe.png')
    ])
    const map = byPath(entries)
    expect(map.get(T('block/stone.png'))).toMatchObject({
      namespace: 'minecraft',
      folder: 'block',
      name: 'stone',
      width: 16,
      height: 16,
      animated: false,
      status: 'vanilla',
      categories: ['blocks']
    })
    expect(map.get(T('block/stone.png'))!.url).toMatch(
      /^bs-asset:\/\/pack\/pack0001\/assets\/minecraft\/textures\/block\/stone\.png\?v=[0-9a-f]{12}$/
    )
    expect(map.get(T('block/water_still.png'))).toMatchObject({ animated: true, frameCount: 32 })
    expect(map.get(T('gui/sprites/hud/heart/full.png'))).toMatchObject({
      folder: 'gui/sprites/hud/heart',
      categories: ['gui']
    })
  })

  it('computes modified / added / identical statuses and pack mcmeta overrides', async () => {
    const vanilla = vanillaFiles()
    await put(pack.folder, T('block/stone.png'), makePng(16, 16, [255, 0, 0, 255]))
    await put(pack.folder, T('block/dirt.png'), vanilla[T('block/dirt.png')])
    await put(pack.folder, T('block/ruby_ore.png'), makePng(32, 32))
    await put(pack.folder, 'assets/mymod/textures/item/gem.png', makePng(16, 16))
    await put(pack.folder, T('block/diamond_ore.png'), makePng(16, 64))
    await put(pack.folder, T('block/diamond_ore.png.mcmeta'), json({ animation: { frametime: 5 } }))
    await put(pack.folder, T('block/water_still.png.mcmeta'), json({ notAnimation: true }))

    const map = byPath(await env.service.textures(pack.id))
    expect(map.get(T('block/stone.png'))!.status).toBe('modified')
    expect(map.get(T('block/dirt.png'))!.status).toBe('vanilla')
    expect(map.get(T('block/ruby_ore.png'))).toMatchObject({
      status: 'added',
      width: 32,
      height: 32,
      categories: ['blocks', 'ores']
    })
    expect(map.get('assets/mymod/textures/item/gem.png')).toMatchObject({
      namespace: 'mymod',
      status: 'added'
    })
    expect(map.get(T('block/diamond_ore.png'))).toMatchObject({
      status: 'modified',
      animated: true,
      frameCount: 4
    })
    expect(map.get(T('block/water_still.png'))!.animated).toBe(false)
    expect(map.get(T('block/water_still.png'))!.frameCount).toBeUndefined()

    const summary = await env.service.get(pack.id)
    expect(summary.changedCount).toBe(4)
  })

  it('reuses the cached list until a texture changes, then refreshes the url', async () => {
    const first = await env.service.textures(pack.id)
    const second = await env.service.textures(pack.id)
    expect(second).toBe(first)

    const file = join(pack.folder, ...T('block/stone.png').split('/'))
    await put(pack.folder, T('block/stone.png'), makePng(16, 16, [1, 1, 1, 255]))
    const third = await env.service.textures(pack.id)
    expect(third).not.toBe(first)
    const before = byPath(first).get(T('block/stone.png'))!.url
    const after = byPath(third).get(T('block/stone.png'))!.url
    expect(after).not.toBe(before)

    await writeFile(file, makePng(16, 16, [2, 2, 2, 255]))
    const later = new Date(Date.now() + 5000)
    await utimes(file, later, later)
    const fourth = await env.service.textures(pack.id)
    expect(byPath(fourth).get(T('block/stone.png'))!.url).not.toBe(after)
  })

  it('summarizes categories in display order with counts, changes and icons', async () => {
    await put(pack.folder, T('item/apple.png'), makePng(16, 16, [0, 255, 0, 255]))
    const categories = await env.service.categories(pack.id)
    expect(categories.map((c) => [c.id, c.count, c.changedCount])).toEqual([
      ['blocks', 5, 0],
      ['ores', 1, 0],
      ['tools', 1, 0],
      ['food', 1, 1],
      ['entities', 1, 0],
      ['gui', 1, 0]
    ])
    const blocks = categories[0]
    expect(blocks.i18nKey).toBe('category.blocks')
    expect(blocks.iconUrl).toContain('block/grass_block_side.png')
  })

  it('empty-based packs only list their own files; vanilla-based packs need vanilla', async () => {
    const empty = await env.service.create({ name: 'E', base: 'empty', authoringVersion: '26.3' })
    await put(empty.folder, T('block/stone.png'), makePng(16, 16))
    const entries = await env.service.textures(empty.id)
    expect(entries.map((e) => [e.path, e.status])).toEqual([[T('block/stone.png'), 'added']])

    env.vanilla.indexes.delete('26.3')
    await expect(env.service.textures(pack.id)).rejects.toMatchObject({
      code: 'packs.vanillaNotReady'
    })
    // The pack list still works (changedCount falls back to counting pack textures).
    await expect(env.service.list()).resolves.toHaveLength(2)
  })

  it('stays fast on a full-size pack (4000 vanilla textures, 1000 pack files)', async () => {
    const files: Record<string, Uint8Array> = {}
    const png = makePng(16, 16)
    for (let i = 0; i < 4000; i++) files[T(`block/generated_${i}.png`)] = png
    await env.vanilla.addVersion('26.3', files)
    for (let i = 0; i < 1000; i++) {
      await put(pack.folder, T(`block/generated_${i}.png`), makePng(16, 16, [i % 256, 0, 0, 255]))
    }

    const coldStart = performance.now()
    const cold = await env.service.textures(pack.id)
    const coldMs = performance.now() - coldStart
    expect(cold).toHaveLength(4000)

    const warmStart = performance.now()
    await env.service.textures(pack.id)
    await env.service.categories(pack.id)
    const warmMs = performance.now() - warmStart
    console.info(
      `pack.textures: cold ${coldMs.toFixed(0)} ms, warm (+categories) ${warmMs.toFixed(0)} ms`
    )
    expect(warmMs).toBeLessThan(300)
    // Writing 5000 fixture files is slow on Windows CI disks; only the timed section above has a budget.
  }, 60_000)
})
