import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { decodePng, getPixel } from '@shared/image'
import type { TextureHandlerDeps } from '../../src/main/ipc/texture-handlers'
import { makeGif } from '../fixtures/gif'

const handlers = new Map<string, (input: unknown) => unknown>()

vi.mock('../../src/main/ipc/registry', () => ({
  handle: (channel: string, fn: (input: unknown) => unknown) => handlers.set(channel, fn),
  AppErrorException: class extends Error {
    constructor(public code: string) {
      super(code)
    }
  }
}))

const { registerTextureHandlers } = await import('../../src/main/ipc/texture-handlers')

const PATH = 'assets/minecraft/textures/block/stone.png'
const STATE = { entries: [], canUndo: false, canRedo: false }

describe('registerTextureHandlers', () => {
  let deps: TextureHandlerDeps

  beforeEach(() => {
    handlers.clear()
    deps = {
      textures: {
        read: vi.fn(async () => ({ path: PATH }) as never),
        save: vi.fn(async () => ({ path: PATH, status: 'modified' }) as never),
        revert: vi.fn(async () => ({ path: PATH, status: 'vanilla' }) as never),
        saveMany: vi.fn(async () => null),
        readCatalog: vi.fn(async () => null)
      },
      history: {
        get: vi.fn(async () => STATE),
        undo: vi.fn(async () => STATE),
        redo: vi.fn(async () => STATE)
      },
      openGif: vi.fn(async () => null)
    }
    registerTextureHandlers(deps)
  })

  it('registers the texture and history channels', () => {
    expect([...handlers.keys()].sort()).toEqual(
      [
        'texture.read',
        'texture.save',
        'texture.revert',
        'texture.importGif',
        'history.get',
        'history.undo',
        'history.redo'
      ].sort()
    )
  })

  it('forwards texture channels', async () => {
    const png = new Uint8Array([1, 2, 3])
    expect(await handlers.get('texture.read')!({ packId: 'p', path: PATH })).toEqual({ path: PATH })
    expect(await handlers.get('texture.save')!({ packId: 'p', path: PATH, png })).toEqual({
      path: PATH,
      status: 'modified'
    })
    expect(await handlers.get('texture.revert')!({ packId: 'p', path: PATH })).toEqual({
      path: PATH,
      status: 'vanilla'
    })
    expect(deps.textures.read).toHaveBeenCalledWith('p', PATH)
    expect(deps.textures.save).toHaveBeenCalledWith('p', PATH, png, undefined, undefined)
    await handlers.get('texture.save')!({ packId: 'p', path: PATH, png, mcmeta: null })
    expect(deps.textures.save).toHaveBeenLastCalledWith('p', PATH, png, null, undefined)
    const layers = { active: 0, items: [{ name: 'A', visible: true, opacity: 100, png }] }
    await handlers.get('texture.save')!({ packId: 'p', path: PATH, png, layers })
    expect(deps.textures.save).toHaveBeenLastCalledWith('p', PATH, png, undefined, layers)
    expect(deps.textures.revert).toHaveBeenCalledWith('p', PATH)
  })

  it('imports a GIF as a strip fitted to the frame size, or null when cancelled', async () => {
    expect(await handlers.get('texture.importGif')!({ frameWidth: 16, frameHeight: 16 })).toBeNull()
    const dir = await mkdtemp(join(tmpdir(), 'blocksmith-gif-'))
    try {
      const file = join(dir, 'flame.gif')
      await writeFile(
        file,
        makeGif(
          8,
          8,
          [
            [255, 0, 0],
            [0, 0, 255]
          ],
          [10, 30]
        )
      )
      vi.mocked(deps.openGif).mockResolvedValueOnce(file)
      const out = (await handlers.get('texture.importGif')!({
        frameWidth: 16,
        frameHeight: 16
      })) as {
        name: string
        png: Uint8Array
        frames: number
        delaysMs: number[]
      }
      expect(out).toMatchObject({
        name: 'flame.gif',
        frames: 2,
        delaysMs: [100, 300],
        truncated: false
      })
      const strip = decodePng(out.png)
      expect([strip.width, strip.height]).toEqual([16, 32])
      expect(getPixel(strip, 15, 15)).toEqual([255, 0, 0, 255])
      expect(getPixel(strip, 0, 16)).toEqual([0, 0, 255, 255])

      await writeFile(file, 'not a gif')
      vi.mocked(deps.openGif).mockResolvedValueOnce(file)
      await expect(
        handlers.get('texture.importGif')!({ frameWidth: 16, frameHeight: 16 })
      ).rejects.toMatchObject({ code: 'texture.invalidGif' })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('forwards history channels', async () => {
    for (const channel of ['history.get', 'history.undo', 'history.redo']) {
      expect(await handlers.get(channel)!({ packId: 'p' })).toBe(STATE)
    }
    expect(deps.history.get).toHaveBeenCalledWith('p')
    expect(deps.history.undo).toHaveBeenCalledWith('p')
    expect(deps.history.redo).toHaveBeenCalledWith('p')
  })

  it('propagates service errors (the registry maps them to AppError)', async () => {
    vi.mocked(deps.history.undo).mockRejectedValueOnce(
      Object.assign(new Error('history.conflict'), { code: 'history.conflict' })
    )
    await expect(handlers.get('history.undo')!({ packId: 'p' })).rejects.toMatchObject({
      code: 'history.conflict'
    })
  })
})
