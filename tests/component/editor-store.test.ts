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
