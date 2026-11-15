import { describe, expect, it } from 'vitest'
import {
  applyPatch,
  cloneImage,
  createImage,
  cropImage,
  diffImages,
  fillRect,
  imagesEqual,
  setPixel,
  type RgbaImage
} from '@shared/image'

function noise(w: number, h: number, seed = 1): RgbaImage {
  const img = createImage(w, h)
  let s = seed
  for (let i = 0; i < img.data.length; i++) {
    s = (s * 1103515245 + 12345) >>> 0
    img.data[i] = s >>> 24
  }
  return img
}

describe('diffImages', () => {
  it('returns null for identical images', () => {
    expect(diffImages(noise(8, 8), noise(8, 8))).toBeNull()
    expect(diffImages(createImage(0, 0), createImage(0, 0))).toBeNull()
  })

  it('finds a single changed pixel, alpha-only changes included', () => {
    const before = createImage(4, 3)
    const after = cloneImage(before)
    after.data[(2 * 4 + 3) * 4 + 3] = 1
    const patch = diffImages(before, after)
    expect(patch?.rect).toEqual({ x: 3, y: 2, width: 1, height: 1 })
    expect([...(patch?.before ?? [])]).toEqual([0, 0, 0, 0])
    expect([...(patch?.after ?? [])]).toEqual([0, 0, 0, 1])
  })

  it('returns the minimal bounding rect and copies of its pixels', () => {
    const before = noise(10, 8)
    const after = cloneImage(before)
    setPixel(after, 6, 1, [1, 2, 3, 4])
    setPixel(after, 2, 5, [5, 6, 7, 8])
    setPixel(after, 4, 3, [9, 9, 9, 9])
    const patch = diffImages(before, after)
    expect(patch).not.toBeNull()
    if (!patch) return
    expect(patch.rect).toEqual({ x: 2, y: 1, width: 5, height: 5 })
    expect(patch.before).toEqual(cropImage(before, patch.rect).data)
    expect(patch.after).toEqual(cropImage(after, patch.rect).data)
    // Copies: later edits to the images do not leak into the patch.
    const snapshot = patch.after.slice()
    fillRect(after, { x: 0, y: 0, width: 10, height: 8 }, [0, 0, 0, 0])
    expect(patch.after).toEqual(snapshot)
  })

  it('throws when sizes differ', () => {
    expect(() => diffImages(createImage(2, 2), createImage(2, 3))).toThrow()
  })
})

describe('applyPatch', () => {
  it('undo restores before, redo restores after', () => {
    const before = noise(16, 16, 5)
    const after = cloneImage(before)
    fillRect(after, { x: 3, y: 4, width: 6, height: 2 }, [255, 0, 0, 255])
    setPixel(after, 12, 13, [0, 0, 0, 0])
    const patch = diffImages(before, after)
    expect(patch).not.toBeNull()
    if (!patch) return
    const img = cloneImage(after)
    applyPatch(img, patch, 'undo')
    expect(imagesEqual(img, before)).toBe(true)
    applyPatch(img, patch, 'redo')
    expect(imagesEqual(img, after)).toBe(true)
  })

  it('round-trips random edits', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const before = noise(13, 9, seed)
      const after = noise(13, 9, seed)
      const x = seed % 13
      const y = (seed * 7) % 9
      fillRect(after, { x, y, width: (seed % 4) + 1, height: (seed % 3) + 1 }, [seed, 0, 0, 255])
      const patch = diffImages(before, after)
      const img = cloneImage(after)
      if (patch) applyPatch(img, patch, 'undo')
      expect(imagesEqual(img, before)).toBe(true)
      if (patch) applyPatch(img, patch, 'redo')
      expect(imagesEqual(img, after)).toBe(true)
    }
  })

  it('throws when the patch does not fit the image', () => {
    const patch = {
      rect: { x: 1, y: 1, width: 2, height: 2 },
      before: new Uint8ClampedArray(16),
      after: new Uint8ClampedArray(16)
    }
    expect(() => applyPatch(createImage(2, 2), patch, 'undo')).toThrow()
    expect(() =>
      applyPatch(createImage(4, 4), { ...patch, after: new Uint8ClampedArray(12) }, 'redo')
    ).toThrow()
    expect(() => applyPatch(createImage(4, 4), patch, 'redo')).not.toThrow()
  })
})
