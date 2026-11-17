import { describe, expect, it, vi, type Mock } from 'vitest'
import type { PopoutManager } from '../../src/main/services/preview'

const handlers = new Map<string, (input: unknown, event?: unknown) => unknown>()

vi.mock('../../src/main/ipc/registry', () => ({
  handle: (channel: string, fn: (input: unknown, event?: unknown) => unknown) =>
    handlers.set(channel, fn)
}))

const { registerPreviewHandlers } = await import('../../src/main/ipc/preview-handlers')

function popouts(): { [K in keyof PopoutManager]: Mock<PopoutManager[K]> } {
  return {
    open: vi.fn(),
    close: vi.fn(),
    push: vi.fn(() => true),
    input: vi.fn(() => false),
    closeAll: vi.fn()
  }
}

describe('registerPreviewHandlers', () => {
  it('forwards texture.preview to the preview service', async () => {
    const preview = vi.fn(async () => ({ kind: 'item' as const }))
    registerPreviewHandlers({ preview: { preview }, popouts: popouts() })
    expect([...handlers.keys()]).toEqual([
      'texture.preview',
      'preview.popout.open',
      'preview.popout.close',
      'preview.popout.push',
      'preview.popout.input'
    ])
    const path = 'assets/minecraft/textures/item/apple.png'
    await expect(handlers.get('texture.preview')!({ packId: 'p', path })).resolves.toEqual({
      kind: 'item'
    })
    expect(preview).toHaveBeenCalledWith('p', path)
  })

  it('relays pop-out calls with the sending window', () => {
    const p = popouts()
    registerPreviewHandlers({ preview: { preview: vi.fn() }, popouts: p })
    const sender = { id: 7 }
    const state = { path: null, mcmeta: null, editingFrame: null, hover: null }
    handlers.get('preview.popout.open')!({ packId: 'p', title: 'Fire' }, { sender })
    expect(p.open).toHaveBeenCalledWith('p', 'Fire', sender)
    expect(handlers.get('preview.popout.push')!({ packId: 'p', state }, { sender })).toBe(true)
    expect(p.push).toHaveBeenCalledWith('p', state, sender)
    const input = { kind: 'hoverEnd' }
    expect(handlers.get('preview.popout.input')!({ packId: 'p', input }, { sender })).toBe(false)
    handlers.get('preview.popout.close')!({ packId: 'p' }, { sender })
    expect(p.close).toHaveBeenCalledWith('p', sender)
  })
})
