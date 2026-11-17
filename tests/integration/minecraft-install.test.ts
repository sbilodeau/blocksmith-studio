import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { unzipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PackSummary } from '@shared/model/pack'
import type { MinecraftTarget, PackMinecraftStatus } from '@shared/model/minecraft'
import { gameDirId, listGameDirs } from '../../src/main/services/minecraft/destinations'
import {
  createMinecraftService,
  gameFileName,
  type MinecraftService
} from '../../src/main/services/minecraft/service'
import { MinecraftStore } from '../../src/main/services/minecraft/store'
import { LIVE_MARKER, syncLiveFolder } from '../../src/main/services/minecraft/sync'
import { T, createTestEnv, json, makePng, type TestEnv } from './packs-fixtures'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

async function put(folder: string, path: string, data: Uint8Array | string): Promise<void> {
  const abs = join(folder, ...path.split('/'))
  await mkdir(dirname(abs), { recursive: true })
  await writeFile(abs, data)
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/** Every file under `folder`, as sorted relative POSIX paths. */
async function tree(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { recursive: true, withFileTypes: true })
  return entries
    .filter((e) => e.isFile())
    .map((e) =>
      join(e.parentPath, e.name)
        .slice(folder.length + 1)
        .replace(/\\/g, '/')
    )
    .sort()
}

describe('install in Minecraft and live mode', () => {
  let env: TestEnv
  let pack: PackSummary
  let gameDir: string
  let store: MinecraftStore
  let minecraft: MinecraftService
  let statuses: PackMinecraftStatus[]

  beforeEach(async () => {
    env = await createTestEnv()
    pack = await env.service.create({
      name: 'Fire: Pack',
      base: 'vanilla',
      authoringVersion: '26.3'
    })
    await put(pack.folder, T('block/stone.png'), makePng(16, 16, [255, 0, 0, 255]))
    gameDir = join(env.root, 'minecraft')
    await put(gameDir, 'options.txt', 'lang:en_us\n')
    await put(gameDir, 'saves/World A/level.dat', 'x')
    await put(gameDir, 'saves/not a world/readme.txt', 'x')
    store = MinecraftStore.forUserData(join(env.root, 'userData'))
    await store.load()
    statuses = []
    minecraft = createMinecraftService({
      packs: env.service,
      store,
      officialRoot: () => gameDir,
      showItemInFolder: env.deps.showItemInFolder,
      notifyStatus: (_id, s) => statuses.push(s),
      now: () => new Date('2026-11-17T12:00:00Z'),
      debounceMs: 5
    })
  })

  afterEach(async () => {
    minecraft.dispose()
    await env.cleanup()
  })

  const target = (extra: Partial<MinecraftTarget> = {}): MinecraftTarget => ({
    packId: pack.id,
    gameDirId: gameDirId(gameDir),
    version: '26.3',
    parts: ['resource'],
    ...extra
  })

  it('lists the official folder and its worlds (folders with a level.dat)', async () => {
    const dirs = await minecraft.gameDirs()
    expect(dirs).toEqual([
      { id: gameDirId(gameDir), kind: 'official', path: gameDir, worlds: [{ id: 'World A' }] }
    ])
    // A missing official folder is not offered.
    expect(await listGameDirs([{ kind: 'official', path: join(env.root, 'nope') }])).toEqual([])
  })

  it('adds a game folder by hand, and refuses a folder that is not one', async () => {
    const other = join(env.root, 'instance', '.minecraft')
    await put(other, 'resourcepacks/.keep', '')
    const dir = await minecraft.addGameDir(other)
    expect(dir).toMatchObject({ kind: 'custom', path: other })
    expect((await minecraft.gameDirs()).map((d) => d.kind)).toEqual(['official', 'custom'])

    await mkdir(join(env.root, 'empty'))
    await expect(minecraft.addGameDir(join(env.root, 'empty'))).rejects.toMatchObject({
      code: 'minecraft.notAGameDir'
    })
  })

  it('installs a zip with a stable name into resourcepacks and remembers the destination', async () => {
    const result = await minecraft.install(target())
    expect(gameFileName('Fire: Pack')).toBe('Fire Pack')
    expect(result.written).toEqual([{ part: 'resource', name: 'Fire Pack.zip' }])
    const zip = unzipSync(
      new Uint8Array(await readFile(join(gameDir, 'resourcepacks', 'Fire Pack.zip')))
    )
    expect(Object.keys(zip).sort()).toEqual([
      'assets/minecraft/textures/block/stone.png',
      'pack.mcmeta',
      'pack.png'
    ])
    expect(store.link(pack.id)).toMatchObject({ version: '26.3', parts: ['resource'], live: false })

    // Installing again replaces the same file.
    await minecraft.install(target())
    expect(await readdir(join(gameDir, 'resourcepacks'))).toEqual(['Fire Pack.zip'])
  })

  it('needs a world for the data part, and refuses parts the pack does not have', async () => {
    await expect(minecraft.install(target({ parts: ['data'] }))).rejects.toMatchObject({
      code: 'minecraft.partNotInPack'
    })
    const both = await env.service.create({
      name: 'Both',
      base: 'empty',
      kind: 'combined',
      authoringVersion: '26.3'
    })
    await put(both.folder, 'data/demo/function/hello.mcfunction', 'say hi\n')
    const t = { ...target(), packId: both.id, parts: ['resource' as const, 'data' as const] }
    await expect(minecraft.install(t)).rejects.toMatchObject({ code: 'minecraft.worldRequired' })
    await expect(minecraft.install({ ...t, worldId: 'Gone' })).rejects.toMatchObject({
      code: 'minecraft.worldMissing'
    })
    const result = await minecraft.install({ ...t, worldId: 'World A' })
    expect(result.written.map((w) => w.part)).toEqual(['data', 'resource'])
    expect(await exists(join(gameDir, 'saves', 'World A', 'datapacks', 'Both.zip'))).toBe(true)
    expect(await exists(join(gameDir, 'resourcepacks', 'Both.zip'))).toBe(true)
  })

  it('keeps a live folder in sync with the pack and removes it when switched off', async () => {
    const status = await minecraft.setLive(pack.id, true, target())
    const live = join(gameDir, 'resourcepacks', 'Fire Pack [live]')
    expect(status).toMatchObject({
      live: { state: 'synced', changed: 3 },
      liveNames: ['Fire Pack [live]']
    })
    expect(await tree(live)).toEqual([
      LIVE_MARKER,
      'assets/minecraft/textures/block/stone.png',
      'pack.mcmeta',
      'pack.png'
    ])

    // A change in the pack re-syncs only what changed.
    await put(pack.folder, T('block/dirt.png'), makePng(16, 16, [0, 0, 255, 255]))
    minecraft.packChanged(pack.id)
    await minecraft.idle()
    expect(statuses.at(-1)?.live).toEqual({
      state: 'synced',
      at: '2026-11-17T12:00:00.000Z',
      changed: 1
    })
    expect(await exists(join(live, 'assets/minecraft/textures/block/dirt.png'))).toBe(true)

    // A removed texture is removed from the game copy, with its empty folders.
    await rm(join(pack.folder, 'assets'), { recursive: true })
    minecraft.packChanged(pack.id)
    await minecraft.idle()
    expect(await tree(live)).toEqual([LIVE_MARKER, 'pack.mcmeta', 'pack.png'])

    const off = await minecraft.setLive(pack.id, false)
    expect(off.live).toEqual({ state: 'off' })
    expect(await exists(live)).toBe(false)
    expect(store.link(pack.id)?.live).toBe(false)
  })

  it('coalesces changes made close together into one sync', async () => {
    await minecraft.setLive(pack.id, true, target())
    const before = statuses.length
    for (let i = 0; i < 5; i++) minecraft.packChanged(pack.id)
    await minecraft.idle()
    expect(statuses.slice(before).map((s) => s.live.state)).toEqual(['syncing', 'synced'])
  })

  it('never takes over a folder it did not create', async () => {
    const live = join(gameDir, 'resourcepacks', 'Fire Pack [live]')
    await put(live, 'pack.mcmeta', '{}')
    await expect(minecraft.setLive(pack.id, true, target())).rejects.toMatchObject({
      code: 'minecraft.folderNotOurs'
    })
    expect(store.link(pack.id)?.live).toBe(false)
    expect(await readFile(join(live, 'pack.mcmeta'), 'utf8')).toBe('{}')

    // Another pack's live folder is not ours either.
    await rm(live, { recursive: true })
    await syncLiveFolder(live, 'someone-else', [{ path: 'pack.mcmeta', data: json({}) }])
    await expect(syncLiveFolder(live, pack.id, [])).rejects.toMatchObject({
      code: 'minecraft.folderNotOurs'
    })
  })

  it('resumes live mode after a restart and moves the folder when the pack is renamed', async () => {
    await minecraft.setLive(pack.id, true, target())
    minecraft.dispose()

    const store2 = MinecraftStore.forUserData(join(env.root, 'userData'))
    await store2.load()
    minecraft = createMinecraftService({
      packs: env.service,
      store: store2,
      officialRoot: () => gameDir,
      showItemInFolder: env.deps.showItemInFolder,
      notifyStatus: (_id, s) => statuses.push(s),
      debounceMs: 5
    })
    await put(pack.folder, T('block/dirt.png'), makePng(16, 16, [0, 0, 255, 255]))
    minecraft.resume()
    await minecraft.idle()
    const live = join(gameDir, 'resourcepacks', 'Fire Pack [live]')
    expect(await exists(join(live, 'assets/minecraft/textures/block/dirt.png'))).toBe(true)

    await env.service.updateMeta(pack.id, { name: 'Ice Pack' })
    minecraft.packChanged(pack.id)
    await minecraft.idle()
    expect(await readdir(join(gameDir, 'resourcepacks'))).toEqual(['Ice Pack [live]'])
  })

  it('removes the live copy when the pack is deleted', async () => {
    await minecraft.setLive(pack.id, true, target())
    await env.service.delete(pack.id)
    minecraft.packChanged(pack.id)
    await minecraft.idle()
    expect(await readdir(join(gameDir, 'resourcepacks'))).toEqual([])
    expect(store.link(pack.id)).toBeNull()
  })

  it('shows the live folder or the installed zip in the file manager', async () => {
    await minecraft.install(target())
    await minecraft.reveal(pack.id)
    expect(env.deps.showItemInFolder).toHaveBeenLastCalledWith(
      join(gameDir, 'resourcepacks', 'Fire Pack.zip')
    )
    await minecraft.setLive(pack.id, true, target())
    await minecraft.reveal(pack.id)
    expect(env.deps.showItemInFolder).toHaveBeenLastCalledWith(
      join(gameDir, 'resourcepacks', 'Fire Pack [live]')
    )
  })
})
