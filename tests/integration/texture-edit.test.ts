import { mkdir, readFile, stat, symlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { PackCacheControl, PackService } from '../../src/main/services/packs'
import { T, createTestEnv, json, makePng, vanillaFiles, type TestEnv } from './packs-fixtures'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

const { createTextureEditService } = await import('../../src/main/services/packs')
const { createHistoryService } = await import('../../src/main/services/history')

const STONE = T('block/stone.png')
const WATER = T('block/water_still.png')
const RED = makePng(16, 16, [200, 0, 0, 255])
const BLUE = makePng(16, 16, [0, 0, 200, 255])

/** A PNG with the same byte length as RED but different content (defeats size-based cache checks). */
function sameSizeAsRed(): Uint8Array {
  for (let g = 1; g < 256; g++) {
    const png = makePng(16, 16, [200, g, 0, 255])
    if (png.byteLength === RED.byteLength) return png
  }
  throw new Error('no same-size variant')
}

describe('texture editing and pack history', () => {
  let env: TestEnv
  let packs: PackService & PackCacheControl
  let history: ReturnType<typeof createHistoryService>
  let textures: ReturnType<typeof createTextureEditService>
  let notifyChanged: Mock<(packId: string) => void>
  let packId: string
  let folder: string

  const packFile = (path: string): string => join(folder, ...path.split('/'))
  const exists = (path: string): Promise<boolean> =>
    stat(packFile(path)).then(
      () => true,
      () => false
    )
  async function writePackFile(path: string, data: Uint8Array | string): Promise<void> {
    await mkdir(dirname(packFile(path)), { recursive: true })
    await writeFile(packFile(path), data)
  }
  async function entry(path: string): Promise<Awaited<ReturnType<PackService['textures']>>[0]> {
    return (await packs.textures(packId)).find((e) => e.path === path)!
  }

  beforeEach(async () => {
    env = await createTestEnv()
    packs = env.service as PackService & PackCacheControl
    notifyChanged = vi.fn()
    history = createHistoryService({
      locate: (id) => packs.locate(id),
      onFilesChanged: (location, paths) => packs.invalidate(location, paths),
      notifyChanged,
      warn: () => undefined
    })
    textures = createTextureEditService({ packs, vanilla: env.vanilla, history, notifyChanged })
    const pack = await packs.create({
      name: 'Fire',
      description: '',
      base: 'vanilla',
      authoringVersion: '26.3'
    })
    packId = pack.id
    folder = pack.folder
  })

  afterEach(async () => {
    await env.cleanup()
  })

  describe('texture.read', () => {
    it('falls back to vanilla, then prefers the pack copy', async () => {
      const vanillaStone = vanillaFiles()[STONE]
      let data = await textures.read(packId, STONE)
      expect(data).toEqual({
        path: STONE,
        png: vanillaStone,
        origin: 'vanilla',
        vanillaPng: vanillaStone,
        mcmeta: null
      })
      await writePackFile(STONE, RED)
      data = await textures.read(packId, STONE)
      expect(data.origin).toBe('pack')
      expect(data.png).toEqual(RED)
      expect(data.vanillaPng).toEqual(vanillaStone)
    })

    it('returns origin none for a texture that exists nowhere', async () => {
      await expect(textures.read(packId, T('block/nothing.png'))).resolves.toEqual({
        path: T('block/nothing.png'),
        png: null,
        origin: 'none',
        vanillaPng: null,
        mcmeta: null
      })
    })

    it('reads the .mcmeta from the pack first, then vanilla', async () => {
      const vanillaMeta = new TextDecoder().decode(vanillaFiles()[`${WATER}.mcmeta`])
      expect((await textures.read(packId, WATER)).mcmeta).toBe(vanillaMeta)
      const packMeta = JSON.stringify({ animation: { frametime: 5 } })
      await writePackFile(`${WATER}.mcmeta`, packMeta)
      expect((await textures.read(packId, WATER)).mcmeta).toBe(packMeta)
    })

    it('never uses vanilla files for an empty pack', async () => {
      const empty = await packs.create({
        name: 'Empty',
        description: '',
        base: 'empty',
        authoringVersion: '26.3'
      })
      await expect(textures.read(empty.id, STONE)).resolves.toMatchObject({
        png: null,
        origin: 'none',
        vanillaPng: null,
        mcmeta: null
      })
    })

    it('rejects unknown packs and invalid paths', async () => {
      await expect(textures.read('nope', STONE)).rejects.toMatchObject({ code: 'packs.notFound' })
      for (const path of [
        'assets/minecraft/textures/../../../pack.mcmeta',
        'assets/minecraft/textures/block/../../../../escape.png',
        'assets/minecraft/models/block/stone.png',
        'assets/minecraft/textures/block/stone.json',
        'assets/minecraft/textures/.hidden.png',
        'assets/minecraft/textures//stone.png',
        '/etc/passwd.png',
        'assets\\minecraft\\textures\\stone.png'
      ]) {
        await expect(textures.read(packId, path), path).rejects.toMatchObject({
          code: 'texture.invalidPath'
        })
      }
    })
  })

  describe('texture.save', () => {
    it('writes the file, marks it modified with a new url and notifies', async () => {
      const before = await entry(STONE)
      const saved = await textures.save(packId, STONE, RED)
      expect(saved).toMatchObject({ path: STONE, status: 'modified', width: 16, height: 16 })
      expect(saved.url).not.toBe(before.url)
      expect(saved.categories).toEqual(before.categories)
      expect(new Uint8Array(await readFile(packFile(STONE)))).toEqual(RED)
      expect(notifyChanged).toHaveBeenCalledWith(packId)

      const state = await history.get(packId)
      expect(state.entries).toEqual([
        expect.objectContaining({
          source: 'editor',
          label: { key: 'save', params: { name: 'stone' } },
          paths: [STONE],
          applied: true
        })
      ])
      expect(state.canUndo).toBe(true)
    })

    it('sees a same-size rewrite right away (cache invalidated)', async () => {
      const variant = sameSizeAsRed()
      const red = await textures.save(packId, STONE, RED)
      const other = await textures.save(packId, STONE, variant)
      expect(other.url).not.toBe(red.url)
      expect((await entry(STONE)).url).toBe(other.url)
    })

    it('removes the pack copy when the bytes equal vanilla, and still records history', async () => {
      await textures.save(packId, STONE, RED)
      const saved = await textures.save(packId, STONE, vanillaFiles()[STONE])
      expect(saved.status).toBe('vanilla')
      expect(await exists(STONE)).toBe(false)
      expect((await history.get(packId)).entries).toHaveLength(2)
      await history.undo(packId)
      expect(new Uint8Array(await readFile(packFile(STONE)))).toEqual(RED)
    })

    it('adds a new texture and creates folders', async () => {
      const path = 'assets/fire/textures/item/torch_x.png'
      const saved = await textures.save(packId, path, RED)
      expect(saved.status).toBe('added')
      expect(await exists(path)).toBe(true)
    })

    it('rejects invalid PNGs and unsafe paths without writing', async () => {
      const bad = [
        new Uint8Array([1, 2, 3]),
        RED.slice(0, 40),
        makePng(4097, 1),
        (() => {
          const copy = RED.slice()
          copy[1] = 0
          return copy
        })()
      ]
      for (const png of bad) {
        await expect(textures.save(packId, STONE, png)).rejects.toMatchObject({
          code: 'texture.invalidPng'
        })
      }
      await expect(
        textures.save(packId, 'assets/minecraft/textures/../../../x.png', RED)
      ).rejects.toMatchObject({ code: 'texture.invalidPath' })
      expect(await exists(STONE)).toBe(false)
      expect((await history.get(packId)).entries).toEqual([])
    })

    it('refuses to write through a symbolic link that leaves the pack', async () => {
      const outside = join(env.root, 'outside')
      await mkdir(outside, { recursive: true })
      await mkdir(join(folder, 'assets', 'evil'), { recursive: true })
      await symlink(outside, join(folder, 'assets', 'evil', 'textures'))
      await expect(textures.save(packId, 'assets/evil/textures/x.png', RED)).rejects.toMatchObject({
        code: 'packs.unsafePath'
      })
      await expect(stat(join(outside, 'x.png'))).rejects.toThrow()
    })
  })

  describe('texture.revert', () => {
    it('deletes the pack copy and records a revert entry', async () => {
      await textures.save(packId, STONE, RED)
      const reverted = await textures.revert(packId, STONE)
      expect(reverted.status).toBe('vanilla')
      expect(reverted.url).toBe((await entry(STONE)).url)
      expect(await exists(STONE)).toBe(false)
      const [latest] = (await history.get(packId)).entries
      expect(latest).toMatchObject({
        source: 'revert',
        label: { key: 'revert', params: { name: 'stone' } }
      })
    })

    it('keeps a pack .png.mcmeta (M2 only reverts the image)', async () => {
      await textures.save(packId, WATER, makePng(16, 512, [1, 2, 3, 255]))
      await writePackFile(`${WATER}.mcmeta`, json({ animation: { frametime: 9 } }))
      await textures.revert(packId, WATER)
      expect(await exists(`${WATER}.mcmeta`)).toBe(true)
    })

    it('refuses textures not in the pack or without a vanilla counterpart', async () => {
      await expect(textures.revert(packId, STONE)).rejects.toMatchObject({
        code: 'texture.notInPack'
      })
      const added = 'assets/fire/textures/item/new.png'
      await textures.save(packId, added, RED)
      await expect(textures.revert(packId, added)).rejects.toMatchObject({
        code: 'texture.noVanilla'
      })
    })
  })

  describe('undo / redo', () => {
    it('walks back and forth across saves and a revert', async () => {
      await textures.save(packId, STONE, RED)
      await textures.save(packId, STONE, BLUE)
      await textures.revert(packId, STONE)
      const urls = { vanilla: (await entry(STONE)).url }

      notifyChanged.mockClear()
      await history.undo(packId)
      expect(notifyChanged).toHaveBeenCalledWith(packId)
      expect(new Uint8Array(await readFile(packFile(STONE)))).toEqual(BLUE)
      const blue = await entry(STONE)
      expect(blue.status).toBe('modified')
      expect(blue.url).not.toBe(urls.vanilla)

      await history.undo(packId)
      expect(new Uint8Array(await readFile(packFile(STONE)))).toEqual(RED)
      expect((await entry(STONE)).url).not.toBe(blue.url)

      let state = await history.undo(packId)
      expect(await exists(STONE)).toBe(false)
      expect((await entry(STONE)).status).toBe('vanilla')
      expect(state).toMatchObject({ canUndo: false, canRedo: true })

      await history.redo(packId)
      await history.redo(packId)
      expect((await entry(STONE)).url).toBe(blue.url)
      state = await history.redo(packId)
      expect(await exists(STONE)).toBe(false)
      expect(state).toMatchObject({ canUndo: true, canRedo: false })
      expect(state.entries.map((e) => e.source)).toEqual(['revert', 'editor', 'editor'])
    })

    it('refuses to clobber a texture edited outside the app', async () => {
      await textures.save(packId, STONE, RED)
      await writePackFile(STONE, BLUE)
      await expect(history.undo(packId)).rejects.toMatchObject({
        code: 'history.conflict',
        params: { path: STONE }
      })
      expect(new Uint8Array(await readFile(packFile(STONE)))).toEqual(BLUE)
    })

    it('keeps the journal out of the texture index and the exported files', async () => {
      await textures.save(packId, STONE, RED)
      expect(await exists('.blocksmith/history/journal.jsonl')).toBe(true)
      const list = await packs.textures(packId)
      expect(list.some((e) => e.path.includes('.blocksmith'))).toBe(false)
    })
  })
})
