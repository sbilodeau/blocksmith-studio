import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { createImage, encodePng, getPixel } from '@shared/image'
import type { PopoutState } from '@shared/model/popout'
import { useEditorStore } from '@renderer/stores/editor'
import { usePopoutStore } from '@renderer/stores/popout'
import { fakeBridge } from './setup'
import { texture } from './fixtures'

const STONE = 'assets/minecraft/textures/block/stone.png'

const emitEvent = (channel: string, payload: unknown): void => fakeBridge.emit(channel, payload)
const calls: Array<{ channel: string; payload: unknown }> = []

async function frame(): Promise<void> {
  await nextTick()
  await new Promise((r) => requestAnimationFrame(() => r(undefined)))
  await nextTick()
}

describe('pop-out store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    calls.length = 0
  })

  it('pushes the editor state to the pop-out and applies its input to the editor', async () => {
    const png = encodePng(createImage(2, 2, [255, 0, 0, 255]))
    const values: Record<string, unknown> = {
      'texture.read': {
        path: STONE,
        png,
        origin: 'pack',
        vanillaPng: null,
        mcmeta: null,
        mcmetaOrigin: 'none',
        layers: null
      },
      'history.get': { entries: [], canUndo: false, canRedo: false },
      'preview.popout.push': true
    }
    window.blocksmith.invoke = (async (channel: string, payload: unknown) => {
      calls.push({ channel, payload })
      return { ok: true, value: values[channel] }
    }) as typeof window.blocksmith.invoke
    const editor = useEditorStore('fire')
    await editor.open(texture(STONE, 'added', ['blocks']))
    const popout = usePopoutStore('fire')

    await popout.popOut('Fire - 3D preview')
    expect(calls.find((c) => c.channel === 'preview.popout.open')!.payload).toEqual({
      packId: 'fire',
      title: 'Fire - 3D preview'
    })
    emitEvent('preview.popout.input', { packId: 'fire', input: { kind: 'ready' } })
    await frame()
    const pushes = (): PopoutState[] =>
      calls
        .filter((c) => c.channel === 'preview.popout.push')
        .map((c) => (c.payload as { state: PopoutState }).state)
    expect(pushes()).toHaveLength(1)
    expect(pushes()[0]).toMatchObject({
      path: STONE,
      mcmeta: null,
      editingFrame: null,
      hover: null
    })
    expect(pushes()[0]!.image).toMatchObject({ width: 2, height: 2 })

    // Painting from the pop-out edits the texture; the new pixels are pushed back.
    editor.primary = [0, 0, 255, 255]
    emitEvent('preview.popout.input', {
      packId: 'fire',
      input: { kind: 'paintStart', x: 1, y: 1, secondary: false }
    })
    emitEvent('preview.popout.input', { packId: 'fire', input: { kind: 'paintEnd' } })
    expect(getPixel(editor.image!, 1, 1)).toEqual([0, 0, 255, 255])
    expect(editor.undoStack.map((e) => e.label)).toEqual(['draw'])
    await frame()
    const last = pushes().at(-1)!
    expect(Array.from(last.image!.rgba.slice(12, 16))).toEqual([0, 0, 255, 255])

    // Hover from the pop-out is shown in the 2D canvas; a hover-only change sends no pixels.
    emitEvent('preview.popout.input', { packId: 'fire', input: { kind: 'hover', x: 0, y: 1 } })
    expect(editor.linkedHover).toEqual({ x: 0, y: 1, source: '3d' })
    editor.linkedHover = { x: 1, y: 0, source: '2d' }
    await frame()
    expect(pushes().at(-1)).toMatchObject({ hover: { x: 1, y: 0 } })
    expect(pushes().at(-1)!.image).toBeUndefined()

    // Other packs' input is ignored; closing the window stops the relay.
    emitEvent('preview.popout.input', {
      packId: 'ice',
      input: { kind: 'paintStart', x: 0, y: 0, secondary: false }
    })
    expect(editor.undoStack).toHaveLength(1)
    emitEvent('preview.popout.closed', { packId: 'fire' })
    expect(popout.open).toBe(false)
    const count = pushes().length
    editor.touch()
    await frame()
    expect(pushes()).toHaveLength(count)
  })
})
