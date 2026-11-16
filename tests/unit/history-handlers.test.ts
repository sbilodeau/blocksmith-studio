import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TextureHandlerDeps } from '../../src/main/ipc/texture-handlers'

const handlers = new Map<string, (input: unknown) => unknown>()

vi.mock('../../src/main/ipc/registry', () => ({
  handle: (channel: string, fn: (input: unknown) => unknown) => handlers.set(channel, fn)
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
        saveMany: vi.fn(async () => null)
      },
      history: {
        get: vi.fn(async () => STATE),
        undo: vi.fn(async () => STATE),
        redo: vi.fn(async () => STATE)
      }
    }
    registerTextureHandlers(deps)
  })

  it('registers the texture and history channels', () => {
    expect([...handlers.keys()].sort()).toEqual(
      [
        'texture.read',
        'texture.save',
        'texture.revert',
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
    expect(deps.textures.save).toHaveBeenCalledWith('p', PATH, png)
    expect(deps.textures.revert).toHaveBeenCalledWith('p', PATH)
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
