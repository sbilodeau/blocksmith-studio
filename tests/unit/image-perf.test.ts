import { describe, expect, it } from 'vitest'
import {
  adjustBrightness,
  createImage,
  diffImages,
  extractPalette,
  floodFill,
  hueShift,
  rotateImage,
  setPixel
} from '@shared/image'

/** Best of a few runs, in ms (the first run includes JIT warm-up). */
function timeIt(fn: () => void, runs = 3): number {
  let best = Infinity
  for (let i = 0; i < runs; i++) {
    const t = performance.now()
    fn()
    best = Math.min(best, performance.now() - t)
  }
  return best
}

// Sanity check only: generous bound so slow CI machines do not flake, while catching accidental O(n^2) code.
describe('image core performance (512x512)', () => {
  it('floodFill + rotate take well under 200 ms', () => {
    const img = createImage(512, 512, [10, 20, 30, 255])
    for (let x = 0; x < 512; x += 7) setPixel(img, x, 100, [0, 0, 0, 255])
    const t = timeIt(() => {
      floodFill(img, 0, 0, [Math.random() * 255, 0, 0, 255], { tolerance: 0 })
      rotateImage(img, 90, 'clockwise')
    })
    expect(t).toBeLessThan(200)
  })

  it('color ops, palette and diff stay fast', () => {
    const img = createImage(512, 512)
    for (let i = 0; i < img.data.length; i++) img.data[i] = (i * 2654435761) >>> 24
    const other = createImage(512, 512)
    expect(timeIt(() => hueShift(img, 30))).toBeLessThan(200)
    expect(timeIt(() => adjustBrightness(img, 0.1))).toBeLessThan(200)
    expect(timeIt(() => extractPalette(img, { max: 64 }))).toBeLessThan(500)
    expect(timeIt(() => diffImages(img, other))).toBeLessThan(200)
  })
})
