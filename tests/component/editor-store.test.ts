import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createImage, encodePng, getPixel, setPixel } from '@shared/image'
import { useEditorStore } from '@renderer/stores/editor'
import { texture } from './fixtures'

const RED = [255, 0, 0, 255] as const
const BLUE = [0, 0, 255, 255] as const

/** 4x2 image: left half red, right half blue. */
function sampleImage(): ReturnType<typeof createImage> {
  const img = createImage(4, 2, [0, 0, 0, 0])
  for (let y = 0; y < 2; y++) for (let x = 0; x < 4; x++) setPixel(img, x, y, x < 2 ? RED : BLUE)
  return img
}

async function openEditor(): Promise<ReturnType<typeof useEditorStore>> {
  const png = encodePng(sampleImage())
  window.blocksmith.invoke = (async (channel: string) => {
    if (channel === 'texture.read') {
      return {
        ok: true,
        value: { path: 'p', png, origin: 'vanilla', vanillaPng: png, mcmeta: null }
      }
    }
    return { ok: true, value: { entries: [], canUndo: false, canRedo: false } }
  }) as typeof window.blocksmith.invoke
  const editor = useEditorStore('fire')
  await editor.open(texture('assets/minecraft/textures/block/stone.png', 'vanilla', ['blocks']))
  return editor
}

describe('editor store', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('loads a texture, tracks dirty state and undoes/redoes edits', async () => {
    const editor = await openEditor()
    expect(editor.image?.width).toBe(4)
    expect(editor.vanilla).not.toBeNull()
    expect(editor.dirty).toBe(false)

    const before = editor.snapshot()!
    setPixel(editor.image!, 0, 0, BLUE)
    editor.commit(before, 'draw')
    expect(editor.dirty).toBe(true)
    expect(editor.undoStack.map((e) => e.label)).toEqual(['draw'])

    editor.undo()
    expect(getPixel(editor.image!, 0, 0)).toEqual(RED)
    expect(editor.dirty).toBe(false)
    editor.redo()
    expect(getPixel(editor.image!, 0, 0)).toEqual(BLUE)
  })

  it('ignores commits that change nothing', async () => {
    const editor = await openEditor()
    editor.commit(editor.snapshot()!, 'draw')
    expect(editor.undoStack).toHaveLength(0)
  })

  it('rotates the whole texture (size change) and undoes it', async () => {
    const editor = await openEditor()
    editor.rotate('clockwise')
    expect([editor.image!.width, editor.image!.height]).toEqual([2, 4])
    expect(getPixel(editor.image!, 0, 0)).toEqual(RED)
    expect(getPixel(editor.image!, 0, 3)).toEqual(BLUE)
    editor.undo()
    expect([editor.image!.width, editor.image!.height]).toEqual([4, 2])
    expect(editor.dirty).toBe(false)
  })

  it('flips only the selection when one exists', async () => {
    const editor = await openEditor()
    editor.selection = { x: 0, y: 0, width: 2, height: 1 }
    setPixel(editor.image!, 0, 0, BLUE)
    editor.flip('horizontal')
    expect(getPixel(editor.image!, 0, 0)).toEqual(RED)
    expect(getPixel(editor.image!, 1, 0)).toEqual(BLUE)
    expect(getPixel(editor.image!, 0, 1)).toEqual(RED)
  })

  it('moves a selection as one undoable edit', async () => {
    const editor = await openEditor()
    editor.selection = { x: 0, y: 0, width: 1, height: 1 }
    editor.liftSelection()
    expect(getPixel(editor.image!, 0, 0)).toEqual([0, 0, 0, 0])
    editor.moveFloating(3, 1)
    editor.commitFloating()
    expect(getPixel(editor.image!, 3, 1)).toEqual(RED)
    expect(editor.undoStack.map((e) => e.label)).toEqual(['move'])
    editor.undo()
    expect(getPixel(editor.image!, 0, 0)).toEqual(RED)
    expect(getPixel(editor.image!, 3, 1)).toEqual(BLUE)
  })

  it('copies, pastes as a floating selection and deletes a selection', async () => {
    const editor = await openEditor()
    editor.selection = { x: 2, y: 0, width: 2, height: 2 }
    expect(editor.copy()).toBe(true)
    editor.selection = { x: 0, y: 0, width: 2, height: 2 }
    editor.paste()
    expect(editor.floating).not.toBeNull()
    expect(editor.tool).toBe('select')
    editor.commitFloating()
    expect(getPixel(editor.image!, 0, 0)).toEqual(BLUE)
    editor.selection = { x: 0, y: 0, width: 4, height: 1 }
    editor.deleteSelection()
    expect(getPixel(editor.image!, 3, 0)).toEqual([0, 0, 0, 0])
  })

  it('setColor changes the active color without adding it to recent colors', async () => {
    const editor = await openEditor()
    editor.setColor([10, 20, 30, 255])
    editor.setColor([11, 21, 31, 255])
    expect(editor.primary).toEqual([11, 21, 31, 255])
    expect(editor.recentColors).toEqual([])
    editor.rememberColor(editor.primary)
    expect(editor.recentColors).toEqual(['#0b151fff'])
  })

  it('remembers recent colors without duplicates and swaps colors', async () => {
    const editor = await openEditor()
    editor.useColor(RED)
    editor.useColor(BLUE)
    editor.useColor(RED)
    expect(editor.recentColors).toEqual(['#ff0000ff', '#0000ffff'])
    editor.secondary = BLUE
    editor.swapColors()
    expect(editor.primary).toEqual(BLUE)
    expect(editor.secondary).toEqual(RED)
  })
})

describe('editor store: animated textures', () => {
  beforeEach(() => setActivePinia(createPinia()))

  /** 2x6 strip of three 2x2 frames: red, blue, red; `mcmeta` as given. */
  async function openAnimated(
    mcmeta: string | null,
    mcmetaOrigin: 'pack' | 'vanilla' | 'none'
  ): Promise<{ editor: ReturnType<typeof useEditorStore>; calls: Array<[string, unknown]> }> {
    const strip = createImage(2, 6, [...RED])
    for (let y = 2; y < 4; y++) for (let x = 0; x < 2; x++) setPixel(strip, x, y, BLUE)
    const png = encodePng(strip)
    const calls: Array<[string, unknown]> = []
    window.blocksmith.invoke = (async (channel: string, payload: unknown) => {
      calls.push([channel, payload])
      if (channel === 'texture.read') {
        return {
          ok: true,
          value: { path: 'p', png, origin: 'pack', vanillaPng: null, mcmeta, mcmetaOrigin }
        }
      }
      if (channel === 'texture.save') {
        return {
          ok: true,
          value: texture('assets/minecraft/textures/block/fire_0.png', 'added', [])
        }
      }
      return { ok: true, value: { entries: [], canUndo: false, canRedo: false } }
    }) as typeof window.blocksmith.invoke
    const editor = useEditorStore('fire')
    await editor.open(texture('assets/minecraft/textures/block/fire_0.png', 'added', ['blocks']))
    return { editor, calls }
  }

  it('edits one frame at a time and undo returns to the edited frame', async () => {
    const { editor } = await openAnimated('{"animation":{"frametime":2}}', 'pack')
    expect(editor.frameCount).toBe(3)
    expect([editor.image!.width, editor.image!.height]).toEqual([2, 2])
    expect(editor.dirty).toBe(false)

    editor.selectFrame(1)
    expect(getPixel(editor.image!, 0, 0)).toEqual(BLUE)
    const before = editor.snapshot()!
    setPixel(editor.image!, 0, 0, [0, 255, 0, 255])
    editor.commit(before, 'draw')
    expect(getPixel(editor.strip!, 0, 2)).toEqual([0, 255, 0, 255])
    expect(editor.dirty).toBe(true)

    editor.selectFrame(0)
    editor.undo()
    expect(editor.frameIndex).toBe(1)
    expect(getPixel(editor.strip!, 0, 2)).toEqual(BLUE)
    expect(editor.dirty).toBe(false)
    // A rotation of a square frame is fine; the vanilla compare follows the frame (none here).
    editor.rotate('clockwise')
    expect([editor.image!.width, editor.image!.height]).toEqual([2, 2])
  })

  it('adds, duplicates, moves and deletes frames, each undoable, keeping the .mcmeta in step', async () => {
    const { editor } = await openAnimated(
      '{"animation":{"frames":[0,{"index":1,"time":5},2]}}',
      'pack'
    )
    editor.selectFrame(1)
    editor.addFrame(true)
    expect(editor.frameCount).toBe(4)
    expect(editor.frameIndex).toBe(2)
    expect(getPixel(editor.image!, 0, 0)).toEqual(BLUE)
    expect(JSON.parse(editor.mcmeta!).animation.frames).toEqual([
      0,
      { index: 1, time: 5 },
      { index: 2, time: 5 },
      3
    ])
    editor.moveFrame(0)
    expect(getPixel(editor.strip!, 0, 0)).toEqual(BLUE)
    editor.deleteFrame()
    expect(editor.frameCount).toBe(3)
    editor.setFrametime(4)
    editor.setInterpolate(true)
    expect(JSON.parse(editor.mcmeta!).animation).toMatchObject({ frametime: 4, interpolate: true })
    expect(editor.undoStack.map((e) => e.label)).toEqual([
      'frameDuplicate',
      'frameMove',
      'frameDelete',
      'frameTiming',
      'frameTiming'
    ])
    for (let i = 0; i < 5; i++) editor.undo()
    expect(editor.frameCount).toBe(3)
    expect(editor.dirty).toBe(false)
  })

  it('saves the strip with a vanilla .mcmeta copied into the pack, and removes one on demand', async () => {
    const meta = '{\n  "animation": {\n    "frametime": 2\n  }\n}\n'
    const { editor, calls } = await openAnimated(meta, 'vanilla')
    const before = editor.snapshot()!
    setPixel(editor.image!, 1, 1, BLUE)
    editor.commit(before, 'draw')
    await editor.save()
    const save = calls.find(([c]) => c === 'texture.save')![1] as {
      png: Uint8Array
      mcmeta?: string
    }
    expect(save.mcmeta).toBe(meta)
    expect(editor.dirty).toBe(false)

    editor.removeAnimation()
    expect(editor.frames).toBeNull()
    expect([editor.image!.width, editor.image!.height]).toEqual([2, 2])
    expect(editor.mcmeta).toBeNull()
    expect(editor.dirty).toBe(true)
    editor.undo()
    expect(editor.frameCount).toBe(3)
    expect(editor.dirty).toBe(false)
  })

  it('animates a still texture and imports frames with their delays', async () => {
    const { editor } = await openAnimated(null, 'none')
    expect(editor.frames).toBeNull()
    expect([editor.image!.width, editor.image!.height]).toEqual([2, 6])
    editor.animate()
    expect(editor.frameCount).toBe(1)
    // A 2x6 frame is not square: the .mcmeta says how tall a frame is.
    expect(JSON.parse(editor.mcmeta!)).toEqual({ animation: { height: 6 } })
    const strip = createImage(2, 12, [...BLUE])
    editor.importFrames(encodePng(strip), [100, 300])
    expect(editor.frameCount).toBe(2)
    expect(JSON.parse(editor.mcmeta!).animation).toEqual({
      frametime: 2,
      frames: [0, { index: 1, time: 6 }],
      height: 6
    })
  })
})
