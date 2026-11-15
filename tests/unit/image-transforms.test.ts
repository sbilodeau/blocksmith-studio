import { describe, expect, it } from 'vitest'
import {
  createImage,
  flipImage,
  imagesEqual,
  resizeNearest,
  rotateImage,
  setPixel,
  shiftImage,
  type RgbaImage,
  type RotateDegrees
} from '@shared/image'

/** Image whose pixel (x, y) is [10*y + x + 1, 100, 200, 255]: every pixel distinct. */
function numbered(w: number, h: number): RgbaImage {
  const img = createImage(w, h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) setPixel(img, x, y, [10 * y + x + 1, 100, 200, 255])
  return img
}

/** Red channel of every pixel, as rows (0 = transparent in these tests). */
function ids(img: RgbaImage): number[][] {
  const rows: number[][] = []
  for (let y = 0; y < img.height; y++) {
    rows.push([])
    for (let x = 0; x < img.width; x++) rows[y].push(img.data[(y * img.width + x) * 4])
  }
  return rows
}

// numbered(3, 2):
//   1  2  3
//  11 12 13
const CW90 = [
  [11, 1],
  [12, 2],
  [13, 3]
]
const CCW90 = [
  [3, 13],
  [2, 12],
  [1, 11]
]
const R180 = [
  [13, 12, 11],
  [3, 2, 1]
]

describe('rotateImage', () => {
  it('rotates 90 clockwise: (x, y) -> (h-1-y, x), width and height swapped', () => {
    const out = rotateImage(numbered(3, 2), 90, 'clockwise')
    expect([out.width, out.height]).toEqual([2, 3])
    expect(ids(out)).toEqual(CW90)
  })

  it('rotates 90 counterclockwise', () => {
    expect(ids(rotateImage(numbered(3, 2), 90, 'counterclockwise'))).toEqual(CCW90)
  })

  it('rotates 180 in both directions', () => {
    expect(ids(rotateImage(numbered(3, 2), 180, 'clockwise'))).toEqual(R180)
    expect(ids(rotateImage(numbered(3, 2), 180, 'counterclockwise'))).toEqual(R180)
  })

  it('270 clockwise == 90 counterclockwise and vice versa', () => {
    expect(ids(rotateImage(numbered(3, 2), 270, 'clockwise'))).toEqual(CCW90)
    expect(ids(rotateImage(numbered(3, 2), 270, 'counterclockwise'))).toEqual(CW90)
  })

  it('rotates a square image', () => {
    expect(ids(rotateImage(numbered(2, 2), 90, 'clockwise'))).toEqual([
      [11, 1],
      [12, 2]
    ])
  })

  it('keeps every channel', () => {
    const img = createImage(2, 1)
    setPixel(img, 0, 0, [1, 2, 3, 4])
    setPixel(img, 1, 0, [5, 6, 7, 8])
    expect([...rotateImage(img, 90, 'clockwise').data]).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect([...rotateImage(img, 180, 'clockwise').data]).toEqual([5, 6, 7, 8, 1, 2, 3, 4])
  })

  it.each([
    [3, 2],
    [4, 4],
    [1, 5],
    [7, 3]
  ])('4 x 90 cw and 90 cw + 90 ccw are the identity (%ix%i)', (w, h) => {
    const img = numbered(w, h)
    let r = img
    for (let i = 0; i < 4; i++) r = rotateImage(r, 90, 'clockwise')
    expect(imagesEqual(r, img)).toBe(true)
    expect(
      imagesEqual(rotateImage(rotateImage(img, 90, 'clockwise'), 90, 'counterclockwise'), img)
    ).toBe(true)
    expect(
      imagesEqual(rotateImage(rotateImage(img, 180, 'clockwise'), 180, 'clockwise'), img)
    ).toBe(true)
  })

  it('returns a new image and rejects invalid angles', () => {
    const img = numbered(2, 2)
    const out = rotateImage(img, 90, 'clockwise')
    out.data[0] = 0
    expect(img.data[0]).toBe(1)
    expect(() => rotateImage(img, 45 as RotateDegrees, 'clockwise')).toThrow(RangeError)
  })
})

describe('flipImage', () => {
  it('horizontal mirrors left <-> right', () => {
    expect(ids(flipImage(numbered(3, 2), 'horizontal'))).toEqual([
      [3, 2, 1],
      [13, 12, 11]
    ])
  })

  it('vertical mirrors top <-> bottom', () => {
    expect(ids(flipImage(numbered(3, 2), 'vertical'))).toEqual([
      [11, 12, 13],
      [1, 2, 3]
    ])
  })

  it('twice is the identity', () => {
    const img = numbered(5, 3)
    expect(imagesEqual(flipImage(flipImage(img, 'horizontal'), 'horizontal'), img)).toBe(true)
    expect(imagesEqual(flipImage(flipImage(img, 'vertical'), 'vertical'), img)).toBe(true)
  })

  it('h + v flip equals a 180 rotation', () => {
    const img = numbered(4, 3)
    const both = flipImage(flipImage(img, 'horizontal'), 'vertical')
    expect(imagesEqual(both, rotateImage(img, 180, 'clockwise'))).toBe(true)
  })
})

describe('shiftImage', () => {
  it('wraps around', () => {
    expect(ids(shiftImage(numbered(3, 2), 1, 0, true))).toEqual([
      [3, 1, 2],
      [13, 11, 12]
    ])
    expect(ids(shiftImage(numbered(3, 2), -1, 1, true))).toEqual([
      [12, 13, 11],
      [2, 3, 1]
    ])
    expect(ids(shiftImage(numbered(3, 2), -7, 4, true))).toEqual([
      [2, 3, 1],
      [12, 13, 11]
    ])
    expect(imagesEqual(shiftImage(numbered(3, 2), 3, -2, true), numbered(3, 2))).toBe(true)
  })

  it('without wrap leaves the uncovered area transparent', () => {
    expect(ids(shiftImage(numbered(3, 2), 1, 0, false))).toEqual([
      [0, 1, 2],
      [0, 11, 12]
    ])
    const out = shiftImage(numbered(3, 2), -1, 1, false)
    expect(ids(out)).toEqual([
      [0, 0, 0],
      [2, 3, 0]
    ])
    expect([...out.data.subarray(0, 12)].every((v) => v === 0)).toBe(true)
    expect(ids(shiftImage(numbered(3, 2), 3, 0, false)).flat()).toEqual([0, 0, 0, 0, 0, 0])
    expect(ids(shiftImage(numbered(3, 2), 0, -2, false)).flat()).toEqual([0, 0, 0, 0, 0, 0])
    expect(imagesEqual(shiftImage(numbered(3, 2), 0, 0, false), numbered(3, 2))).toBe(true)
  })
})

describe('resizeNearest', () => {
  it('upscales by repeating pixels', () => {
    expect(ids(resizeNearest(numbered(2, 2), 4, 4))).toEqual([
      [1, 1, 2, 2],
      [1, 1, 2, 2],
      [11, 11, 12, 12],
      [11, 11, 12, 12]
    ])
    expect(ids(resizeNearest(numbered(2, 1), 6, 2))).toEqual([
      [1, 1, 1, 2, 2, 2],
      [1, 1, 1, 2, 2, 2]
    ])
  })

  it('downscales by sampling pixel centers', () => {
    expect(ids(resizeNearest(numbered(4, 4), 2, 2))).toEqual([
      [12, 14],
      [32, 34]
    ])
    expect(ids(resizeNearest(numbered(3, 3), 2, 1))).toEqual([[11, 13]])
  })

  it('handles same size, empty targets and invalid sizes', () => {
    const img = numbered(3, 2)
    expect(imagesEqual(resizeNearest(img, 3, 2), img)).toBe(true)
    expect(resizeNearest(img, 0, 5).data.length).toBe(0)
    expect(() => resizeNearest(img, -1, 2)).toThrow(RangeError)
    expect(() => resizeNearest(img, 2.5, 2)).toThrow(RangeError)
  })
})
