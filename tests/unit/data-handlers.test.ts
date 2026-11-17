import { describe, expect, it, vi } from 'vitest'
import type { DataService } from '../../src/main/services/packs'
import { inputSchemas } from '@shared/ipc/contract'

const handlers = new Map<string, (input: unknown) => unknown>()

vi.mock('../../src/main/ipc/registry', () => ({
  handle: (channel: string, fn: (input: unknown) => unknown) => handlers.set(channel, fn)
}))

const { registerDataHandlers } = await import('../../src/main/ipc/data-handlers')

describe('registerDataHandlers', () => {
  it('maps each data channel to the service', async () => {
    const data: DataService = {
      list: vi.fn(async () => ({
        entries: [],
        vanillaData: true,
        ids: { items: [], blocks: [], tags: {} }
      })),
      ids: vi.fn(),
      read: vi.fn(async () => ({
        path: 'p',
        text: null,
        origin: 'none' as const,
        vanillaText: null
      })),
      vanillaText: vi.fn(async () => null),
      packText: vi.fn(async () => null),
      names: vi.fn(async () => ({})),
      save: vi.fn(async () => ({}) as never),
      create: vi.fn(async () => ({}) as never),
      remove: vi.fn(async () => undefined),
      saveMany: vi.fn()
    }
    registerDataHandlers({ data })
    expect([...handlers.keys()]).toEqual([
      'data.list',
      'data.read',
      'data.save',
      'data.create',
      'data.delete'
    ])
    const path = 'data/my_pack/recipe/a.json'
    await handlers.get('data.list')!({ packId: 'p' })
    await handlers.get('data.read')!({ packId: 'p', path })
    await handlers.get('data.save')!({ packId: 'p', path, text: '{}' })
    await handlers.get('data.create')!({ packId: 'p', path, text: '{}' })
    await handlers.get('data.delete')!({ packId: 'p', path })
    expect(data.list).toHaveBeenCalledWith('p')
    expect(data.save).toHaveBeenCalledWith('p', path, '{}')
    expect(data.create).toHaveBeenCalledWith('p', path, '{}')
    expect(data.remove).toHaveBeenCalledWith('p', path)
  })

  it('the contract accepts data paths only', () => {
    const ok = (path: string): boolean =>
      inputSchemas['data.read'].safeParse({ packId: 'p', path }).success
    expect(ok('data/my_pack/recipe/a.json')).toBe(true)
    expect(ok('data/my_pack/function/start.mcfunction')).toBe(true)
    expect(ok('data/my_pack/../x.json')).toBe(false)
    expect(ok('assets/minecraft/textures/block/stone.png')).toBe(false)
    expect(ok('data/my_pack/structure/x.nbt')).toBe(false)
    expect(inputSchemas['pack.setKind'].safeParse({ packId: 'p', kind: 'data' }).success).toBe(true)
    expect(inputSchemas['pack.setKind'].safeParse({ packId: 'p', kind: 'other' }).success).toBe(
      false
    )
  })
})
