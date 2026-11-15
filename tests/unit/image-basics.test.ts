import { describe, expect, it } from 'vitest'
import {
  clampRect,
  clearRect,
  cloneImage,
  createImage,
  cropImage,
  getPixel,
  imagesEqual,
  inBounds,
  pasteImage,
  setPixel,
  type Rgba,
  type RgbaImage
} from '@shared/image'

/** Image whose pixel (x, y) is [10*y + x + 1, 100, 200, 255]: every pixel distinct. */
function numbered(w: number, h: number): RgbaImage {
  const img = createImage(w, h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) setPixel(img, x, y, [10 * y + x + 1, 100, 200, 255])
  return img
}

/** Red channel of every pixel, as rows. */
function ids(img: RgbaImage): number[][] {
  const rows: number[][] = []
  for (let y = 0; y < img.height; y++) {
    rows.push([])
    for (let x = 0; x < img.width; x++) rows[y].push(img.data[(y * img.width + x) * 4])
  }
  return rows
}

const RED: Rgba = [255, 0, 0, 255]
const CLEAR: Rgba = [0, 0, 0, 0]

describe('createImage / cloneImage', () => {
  it('creates a transparent image of the right size', () => {
    const img = createImage(3, 2)
    expect(img.width).toBe(3)
    expect(img.height).toBe(2)
    expect(img.data).toBeInstanceOf(Uint8ClampedArray)
    expect(img.data.length).toBe(24)
    expect([...img.data].every((v) => v === 0)).toBe(true)
  })

  it('fills with a color', () => {
    const img = createImage(2, 2, [1, 2, 3, 4])
    expect([...img.data]).toEqual([1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4])
  })

  it('allows empty images and rejects invalid sizes', () => {
    expect(createImage(0, 0).data.length).toBe(0)
    expect(() => createImage(-1, 2)).toThrow(RangeError)
    expect(() => createImage(1.5, 2)).toThrow(RangeError)
    expect(() => createImage(Number.NaN, 2)).toThrow(RangeError)
  })

  it('clones deeply', () => {
    const a = numbered(3, 2)
    const b = cloneImage(a)
    expect(imagesEqual(a, b)).toBe(true)
    setPixel(b, 0, 0, RED)
    expect(getPixel(a, 0, 0)).toEqual([1, 100, 200, 255])
  })
})

describe('pixel access', () => {
  it('inBounds floors coordinates', () => {
    const img = createImage(3, 2)
    expect(inBounds(img, 0, 0)).toBe(true)
    expect(inBounds(img, 2, 1)).toBe(true)
    expect(inBounds(img, 2.9, 1.9)).toBe(true)
    expect(inBounds(img, 3, 0)).toBe(false)
    expect(inBounds(img, 0, 2)).toBe(false)
    expect(inBounds(img, -0.5, 0)).toBe(false)
    expect(inBounds(img, Number.NaN, 0)).toBe(false)
  })

  it('getPixel reads RGBA and returns transparent out of bounds', () => {
    const img = numbered(3, 2)
    expect(getPixel(img, 2, 1)).toEqual([13, 100, 200, 255])
    expect(getPixel(img, 1.7, 0.2)).toEqual([2, 100, 200, 255])
    expect(getPixel(img, -1, 0)).toEqual([0, 0, 0, 0])
    expect(getPixel(img, 0, 5)).toEqual([0, 0, 0, 0])
  })

  it('setPixel writes, floors and silently ignores out-of-bounds writes', () => {
    const img = createImage(3, 2)
    setPixel(img, 1, 1, [9, 8, 7, 6])
    setPixel(img, 0.9, 0.9, RED)
    setPixel(img, -1, 0, RED)
    setPixel(img, 3, 0, RED)
    setPixel(img, 0, 2, RED)
    expect(getPixel(img, 1, 1)).toEqual([9, 8, 7, 6])
    expect(getPixel(img, 0, 0)).toEqual(RED)
    expect([...img.data].filter((v) => v !== 0).length).toBe(6)
  })

  it('imagesEqual compares size and every byte', () => {
    expect(imagesEqual(numbered(3, 2), numbered(3, 2))).toBe(true)
    expect(imagesEqual(numbered(3, 2), numbered(2, 3))).toBe(false)
    const b = numbered(3, 2)
    b.data[23] = 254
    expect(imagesEqual(numbered(3, 2), b)).toBe(false)
  })

  it('imagesEqual works on unaligned subarray views', () => {
    const a = numbered(3, 2)
    const buf = new Uint8ClampedArray(a.data.length + 1)
    buf.set(a.data, 1)
    const view: RgbaImage = { width: 3, height: 2, data: buf.subarray(1) }
    expect(imagesEqual(a, view)).toBe(true)
  })
})

describe('clampRect / cropImage / clearRect', () => {
  const img = createImage(4, 3)

  it('clamps to the image and floors coordinates', () => {
    expect(clampRect(img, { x: 1, y: 1, width: 2, height: 1 })).toEqual({
      x: 1,
      y: 1,
      width: 2,
      height: 1
    })
    expect(clampRect(img, { x: -2, y: -1, width: 10, height: 10 })).toEqual({
      x: 0,
      y: 0,
      width: 4,
      height: 3
    })
    expect(clampRect(img, { x: 1.6, y: 0.2, width: 2, height: 1 })).toEqual({
      x: 1,
      y: 0,
      width: 2,
      height: 1
    })
  })

  it('returns null for empty or outside rects', () => {
    expect(clampRect(img, { x: 0, y: 0, width: 0, height: 2 })).toBeNull()
    expect(clampRect(img, { x: 0, y: 0, width: 2, height: -1 })).toBeNull()
    expect(clampRect(img, { x: 4, y: 0, width: 2, height: 2 })).toBeNull()
    expect(clampRect(img, { x: -3, y: 0, width: 3, height: 2 })).toBeNull()
    expect(clampRect(img, { x: Number.NaN, y: 0, width: 3, height: 2 })).toBeNull()
  })

  it('crops a copy of the clamped rect', () => {
    const src = numbered(4, 3)
    const out = cropImage(src, { x: 1, y: 1, width: 2, height: 2 })
    expect(ids(out)).toEqual([
      [12, 13],
      [22, 23]
    ])
    out.data[0] = 0
    expect(getPixel(src, 1, 1)[0]).toBe(12)
    expect(ids(cropImage(src, { x: 2, y: -1, width: 5, height: 2 }))).toEqual([[3, 4]])
    const empty = cropImage(src, { x: 9, y: 9, width: 1, height: 1 })
    expect([empty.width, empty.height, empty.data.length]).toEqual([0, 0, 0])
  })

  it('clears the clamped rect to transparent', () => {
    const src = numbered(4, 3)
    clearRect(src, { x: 2, y: 1, width: 5, height: 5 })
    expect(ids(src)).toEqual([
      [1, 2, 3, 4],
      [11, 12, 0, 0],
      [21, 22, 0, 0]
    ])
    expect(getPixel(src, 3, 2)).toEqual(CLEAR)
    clearRect(src, { x: 0, y: 0, width: 0, height: 3 })
    expect(getPixel(src, 0, 0)).toEqual([1, 100, 200, 255])
  })
})

describe('pasteImage', () => {
  it('replaces pixels exactly, transparency included', () => {
    const dst = createImage(3, 3, RED)
    const src = createImage(2, 1)
    setPixel(src, 1, 0, [1, 2, 3, 128])
    pasteImage(dst, src, 1, 1)
    expect(getPixel(dst, 1, 1)).toEqual(CLEAR)
    expect(getPixel(dst, 2, 1)).toEqual([1, 2, 3, 128])
    expect(getPixel(dst, 0, 1)).toEqual(RED)
    expect(getPixel(dst, 1, 0)).toEqual(RED)
  })

  it('clips to the destination on every side', () => {
    const src = numbered(3, 3)
    const a = createImage(3, 3)
    pasteImage(a, src, -1, -2)
    expect(ids(a)).toEqual([
      [22, 23, 0],
      [0, 0, 0],
      [0, 0, 0]
    ])
    const b = createImage(3, 3)
    pasteImage(b, src, 2, 1.5)
    expect(ids(b)).toEqual([
      [0, 0, 0],
      [0, 0, 1],
      [0, 0, 11]
    ])
    const c = createImage(3, 3)
    pasteImage(c, src, 3, 0)
    pasteImage(c, src, -3, 0)
    pasteImage(c, src, 0, 3)
    expect(
      ids(c)
        .flat()
        .every((v) => v === 0)
    ).toBe(true)
  })

  it('pastes an image into itself without clobbering rows', () => {
    const img = numbered(3, 3)
    pasteImage(img, img, 0, 1)
    expect(ids(img)).toEqual([
      [1, 2, 3],
      [1, 2, 3],
      [11, 12, 13]
    ])
  })

  it('blends with straight-alpha "over" and correct rounding', () => {
    const dst = createImage(4, 1)
    setPixel(dst, 0, 0, [0, 0, 255, 255])
    setPixel(dst, 1, 0, [0, 0, 255, 255])
    setPixel(dst, 2, 0, [10, 20, 30, 0])
    setPixel(dst, 3, 0, [0, 0, 255, 128])
    const src = createImage(4, 1)
    setPixel(src, 0, 0, [255, 0, 0, 255])
    setPixel(src, 1, 0, [255, 0, 0, 128])
    setPixel(src, 2, 0, [255, 0, 0, 128])
    setPixel(src, 3, 0, [255, 0, 0, 128])
    pasteImage(dst, src, 0, 0, { blend: true })
    expect(getPixel(dst, 0, 0)).toEqual([255, 0, 0, 255])
    // 255 * 128/255 = 128; 255 * 127/255 = 127.
    expect(getPixel(dst, 1, 0)).toEqual([128, 0, 127, 255])
    // Over a transparent pixel the source is kept as is.
    expect(getPixel(dst, 2, 0)).toEqual([255, 0, 0, 128])
    // outA = 128 + 128 * 127/255 = 191.75 -> 192; r = 255*128*255 / (128*255 + 128*127) = 170.2 -> 170.
    expect(getPixel(dst, 3, 0)).toEqual([170, 0, 85, 192])
  })

  it('leaves the destination untouched under fully transparent source pixels', () => {
    const dst = createImage(1, 1, [10, 20, 30, 0])
    pasteImage(dst, createImage(1, 1), 0, 0, { blend: true })
    expect(getPixel(dst, 0, 0)).toEqual([10, 20, 30, 0])
  })
})
