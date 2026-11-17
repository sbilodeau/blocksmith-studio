import { describe, expect, it } from 'vitest'
import {
  compositeLayers,
  createImage,
  getPixel,
  overlayDiff,
  pasteImage,
  setPixel,
  type Rgba
} from '@shared/image'

const RED: Rgba = [255, 0, 0, 255]
const BLUE: Rgba = [0, 0, 255, 255]
const HALF_GREEN: Rgba = [0, 255, 0, 128]

function solid(color: Rgba, w = 2, h = 2): ReturnType<typeof createImage> {
  return createImage(w, h, color)
}

describe('compositeLayers', () => {
  it('copies a single opaque visible layer exactly and starts from transparency', () => {
    const base = solid(RED)
    setPixel(base, 1, 1, [0, 0, 0, 0])
    const out = compositeLayers([{ image: base, visible: true, opacity: 100 }], 2, 2)
    expect(Array.from(out.data)).toEqual(Array.from(base.data))
    expect(out).not.toBe(base)
    expect(getPixel(compositeLayers([], 2, 2), 0, 0)).toEqual([0, 0, 0, 0])
  })

  it('puts upper layers over lower ones, skipping hidden layers', () => {
    const top = createImage(2, 2)
    setPixel(top, 0, 0, BLUE)
    const layers = [
      { image: solid(RED), visible: true, opacity: 100 },
      { image: top, visible: true, opacity: 100 }
    ]
    const out = compositeLayers(layers, 2, 2)
    expect(getPixel(out, 0, 0)).toEqual(BLUE)
    expect(getPixel(out, 1, 0)).toEqual(RED)
    layers[1]!.visible = false
    expect(getPixel(compositeLayers(layers, 2, 2), 0, 0)).toEqual(RED)
  })

  it('scales a layer alpha by its opacity, with the same blend as pasteImage', () => {
    const out = compositeLayers(
      [
        { image: solid(RED), visible: true, opacity: 100 },
        { image: solid(BLUE), visible: true, opacity: 50 }
      ],
      2,
      2
    )
    // 255 * 50% = 128 alpha: same as pasting a [0,0,255,128] pixel over red.
    const expected = solid(RED)
    pasteImage(expected, solid([0, 0, 255, 128]), 0, 0, { blend: true })
    expect(getPixel(out, 0, 0)).toEqual(getPixel(expected, 0, 0))
    expect(getPixel(out, 0, 0)).toEqual([127, 0, 128, 255])
    expect(
      getPixel(compositeLayers([{ image: solid(BLUE), visible: true, opacity: 0 }], 2, 2), 0, 0)
    ).toEqual([0, 0, 0, 0])
  })

  it('blends semi-transparent pixels over transparency and keeps their color', () => {
    const out = compositeLayers([{ image: solid(HALF_GREEN), visible: true, opacity: 100 }], 2, 2)
    expect(getPixel(out, 1, 1)).toEqual(HALF_GREEN)
  })
})

describe('overlayDiff', () => {
  it('keeps only changed pixels, on transparency', () => {
    const base = solid(RED)
    const next = solid(RED)
    setPixel(next, 1, 0, BLUE)
    const overlay = overlayDiff(base, next)!
    expect(getPixel(overlay, 1, 0)).toEqual(BLUE)
    expect(getPixel(overlay, 0, 0)).toEqual([0, 0, 0, 0])
    // Put back on top of base it gives next.
    const out = compositeLayers(
      [
        { image: base, visible: true, opacity: 100 },
        { image: overlay, visible: true, opacity: 100 }
      ],
      2,
      2
    )
    expect(Array.from(out.data)).toEqual(Array.from(next.data))
  })

  it('refuses changes an overlay cannot express (erased or translucent pixels, other sizes)', () => {
    const next = solid(RED)
    setPixel(next, 0, 0, [0, 0, 0, 0])
    expect(overlayDiff(solid(RED), next)).toBeNull()
    setPixel(next, 0, 0, HALF_GREEN)
    expect(overlayDiff(solid(RED), next)).toBeNull()
    expect(overlayDiff(solid(RED), solid(RED, 3, 2))).toBeNull()
  })
})
