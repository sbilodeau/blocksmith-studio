import { describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, (input: unknown) => unknown>()

vi.mock('../../src/main/ipc/registry', () => ({
  handle: (channel: string, fn: (input: unknown) => unknown) => handlers.set(channel, fn)
}))

const { registerPreviewHandlers } = await import('../../src/main/ipc/preview-handlers')

describe('registerPreviewHandlers', () => {
  it('forwards texture.preview to the preview service', async () => {
    const preview = vi.fn(async () => ({ kind: 'item' as const }))
    registerPreviewHandlers({ preview: { preview } })
    expect([...handlers.keys()]).toEqual(['texture.preview'])
    const path = 'assets/minecraft/textures/item/apple.png'
    await expect(handlers.get('texture.preview')!({ packId: 'p', path })).resolves.toEqual({
      kind: 'item'
    })
    expect(preview).toHaveBeenCalledWith('p', path)
  })
})
