import { createImage } from './basics'
import type { RgbaImage } from './types'

/** One layer as the compositor sees it (the editor's layers panel, the saved .blocksmith layers file). */
export interface LayerView {
  image: RgbaImage
  visible: boolean
  /** 0..100 (percent). */
  opacity: number
}

/**
 * Flattens `layers` (bottom first) into a new `width` x `height` image: straight-alpha "over" of every visible
 * layer, each layer's alpha scaled by its opacity. Pixels of layers with another size are ignored outside the
 * overlap. A single visible layer at 100% gives an exact copy of its pixels.
 */
export function compositeLayers(
  layers: readonly LayerView[],
  width: number,
  height: number
): RgbaImage {
  const out = createImage(width, height)
  const d = out.data
  for (const layer of layers) {
    const opacity = Math.max(0, Math.min(100, Math.round(layer.opacity)))
    if (!layer.visible || opacity === 0) continue
    const src = layer.image
    const s = src.data
    const w = Math.min(width, src.width)
    const h = Math.min(height, src.height)
    for (let y = 0; y < h; y++) {
      let si = y * src.width * 4
      let di = y * width * 4
      for (let x = 0; x < w; x++, si += 4, di += 4) {
        const sa = opacity === 100 ? s[si + 3] : Math.round((s[si + 3] * opacity) / 100)
        if (sa === 0) continue
        if (sa === 255) {
          d[di] = s[si]
          d[di + 1] = s[si + 1]
          d[di + 2] = s[si + 2]
          d[di + 3] = 255
          continue
        }
        // Same integer "over" as pasteImage({ blend: true }): weights in units of 1/255^2.
        const sw = sa * 255
        const dw = d[di + 3] * (255 - sa)
        const outA = sw + dw
        d[di] = Math.round((s[si] * sw + d[di] * dw) / outA)
        d[di + 1] = Math.round((s[si + 1] * sw + d[di + 1] * dw) / outA)
        d[di + 2] = Math.round((s[si + 2] * sw + d[di + 2] * dw) / outA)
        d[di + 3] = Math.round(outA / 255)
      }
    }
  }
  return out
}

/**
 * The pixels of `next` that differ from `base`, on a transparent image (an overlay layer that turns `base` into
 * `next` when put on top), or null when a changed pixel of `next` is not fully opaque (an overlay cannot erase or
 * lighten what is below it). Both images must have the same size.
 */
export function overlayDiff(base: RgbaImage, next: RgbaImage): RgbaImage | null {
  if (base.width !== next.width || base.height !== next.height) return null
  const out = createImage(next.width, next.height)
  const a = base.data
  const b = next.data
  for (let i = 0; i < b.length; i += 4) {
    if (a[i] === b[i] && a[i + 1] === b[i + 1] && a[i + 2] === b[i + 2] && a[i + 3] === b[i + 3])
      continue
    if (b[i + 3] !== 255) return null
    out.data[i] = b[i]
    out.data[i + 1] = b[i + 1]
    out.data[i + 2] = b[i + 2]
    out.data[i + 3] = 255
  }
  return out
}
