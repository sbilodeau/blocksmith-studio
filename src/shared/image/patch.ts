import { readPixels32 } from './internal'
import type { Patch, RgbaImage } from './types'

/** Smallest rect covering every differing pixel; null when identical. Sizes must match. */
export function diffImages(before: RgbaImage, after: RgbaImage): Patch | null {
  const { width: w, height: h } = before
  if (after.width !== w || after.height !== h) {
    throw new Error(`image core: cannot diff ${w}x${h} against ${after.width}x${after.height}`)
  }
  const a = readPixels32(before)
  const b = readPixels32(after)
  let minX = w
  let maxX = -1
  let minY = -1
  let maxY = -1
  for (let y = 0; y < h; y++) {
    const row = y * w
    let first = -1
    for (let x = 0; x < w; x++) {
      if (a[row + x] !== b[row + x]) {
        first = x
        break
      }
    }
    if (first < 0) continue
    if (minY < 0) minY = y
    maxY = y
    if (first < minX) minX = first
    for (let x = w - 1; x > maxX; x--) {
      if (a[row + x] !== b[row + x]) {
        maxX = x
        break
      }
    }
  }
  if (minY < 0) return null
  const rect = { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
  return { rect, before: copyRect(before, rect), after: copyRect(after, rect) }
}

/** Mutates `img`: writes patch.after ('redo') or patch.before ('undo'). */
export function applyPatch(img: RgbaImage, patch: Patch, direction: 'undo' | 'redo'): void {
  const { x, y, width, height } = patch.rect
  const src = direction === 'undo' ? patch.before : patch.after
  if (
    ![x, y, width, height].every(Number.isInteger) ||
    x < 0 ||
    y < 0 ||
    width < 0 ||
    height < 0 ||
    x + width > img.width ||
    y + height > img.height ||
    src.length !== width * height * 4
  ) {
    throw new Error('image core: patch does not fit the image')
  }
  const rowBytes = width * 4
  for (let row = 0; row < height; row++) {
    img.data.set(
      src.subarray(row * rowBytes, (row + 1) * rowBytes),
      ((y + row) * img.width + x) * 4
    )
  }
}

function copyRect(img: RgbaImage, rect: Patch['rect']): Uint8ClampedArray {
  const rowBytes = rect.width * 4
  const out = new Uint8ClampedArray(rowBytes * rect.height)
  for (let row = 0; row < rect.height; row++) {
    const start = ((rect.y + row) * img.width + rect.x) * 4
    out.set(img.data.subarray(start, start + rowBytes), row * rowBytes)
  }
  return out
}
