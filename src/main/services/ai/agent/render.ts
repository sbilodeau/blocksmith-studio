import type { RgbaImage } from '@shared/image'

/**
 * Upscaled texture for vision models (PLAN 6.6): nearest-neighbor scaled to about `target` px on the long side,
 * transparent pixels on a checkerboard, optional 1-px grid lines and axis labels (column numbers on top, row
 * numbers on the left) drawn with a built-in 3x5 bitmap digit font. Pure TS: main has no canvas.
 */

/** 3x5 digit glyphs, one string per row, '#' = ink. */
const DIGITS: readonly (readonly string[])[] = [
  ['###', '#.#', '#.#', '#.#', '###'],
  ['.#.', '##.', '.#.', '.#.', '###'],
  ['###', '..#', '###', '#..', '###'],
  ['###', '..#', '###', '..#', '###'],
  ['#.#', '#.#', '###', '..#', '..#'],
  ['###', '#..', '###', '..#', '###'],
  ['###', '#..', '###', '#.#', '###'],
  ['###', '..#', '..#', '..#', '..#'],
  ['###', '#.#', '###', '#.#', '###'],
  ['###', '#.#', '###', '..#', '###']
]
export const GLYPH_W = 3
export const GLYPH_H = 5

export interface UpscaleOptions {
  /** Long side target in px (default 512). */
  target?: number
  /** 1-px grid lines between texture pixels when the scale is at least 4 (default true). */
  grid?: boolean
  /** Axis labels in a margin (default true). */
  labels?: boolean
}

export interface Upscaled {
  image: RgbaImage
  /** Output px per texture pixel. */
  scale: number
  /** Where texture pixel (0, 0) starts in the output. */
  offsetX: number
  offsetY: number
  /** Font pixel size (1 or 2). */
  fontScale: number
  /** Every `labelStep`-th column/row is labeled. */
  labelStep: number
}

const MARGIN_BG: readonly [number, number, number] = [255, 255, 255]
const INK: readonly [number, number, number] = [32, 32, 32]
const CHECK_LIGHT = 255
const CHECK_DARK = 200
const NICE_STEPS = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096]

function textWidth(text: string, f: number): number {
  return text.length * GLYPH_W * f + (text.length - 1) * f
}

export function renderUpscaled(src: RgbaImage, opts: UpscaleOptions = {}): Upscaled {
  const target = opts.target ?? 512
  const { width: w, height: h } = src
  const scale = Math.max(1, Math.floor(target / Math.max(w, h, 1)))
  const f = scale >= 24 ? 2 : 1
  const labels = opts.labels ?? true
  const grid = (opts.grid ?? true) && scale >= 4

  const widest = Math.max(textWidth(String(Math.max(w - 1, 0)), f), GLYPH_H * f)
  const labelStep = NICE_STEPS.find((s) => s * scale >= widest + 2 * f) ?? NICE_STEPS.at(-1)!
  const offsetX = labels ? textWidth(String(Math.max(h - 1, 0)), f) + 3 * f : 0
  const offsetY = labels ? GLYPH_H * f + 3 * f : 0
  const outW = offsetX + w * scale
  const outH = offsetY + h * scale
  const out = new Uint8ClampedArray(outW * outH * 4)

  // Margin background.
  for (let i = 0; i < out.length; i += 4) {
    out[i] = MARGIN_BG[0]
    out[i + 1] = MARGIN_BG[1]
    out[i + 2] = MARGIN_BG[2]
    out[i + 3] = 255
  }

  // Texture pixels composited over a checkerboard (two checks per texture pixel when possible).
  const check = Math.max(1, Math.floor(scale / 2))
  const s = src.data
  for (let oy = 0; oy < h * scale; oy++) {
    const ty = Math.floor(oy / scale)
    for (let ox = 0; ox < w * scale; ox++) {
      const tx = Math.floor(ox / scale)
      const si = (ty * w + tx) * 4
      const a = s[si + 3] / 255
      const bg =
        ((Math.floor(ox / check) + Math.floor(oy / check)) & 1) === 0 ? CHECK_LIGHT : CHECK_DARK
      let r = s[si] * a + bg * (1 - a)
      let g = s[si + 1] * a + bg * (1 - a)
      let b = s[si + 2] * a + bg * (1 - a)
      if (grid && (ox % scale === 0 || oy % scale === 0)) {
        // Grid line: darken 35% (visible on light pixels, subtle on dark ones).
        r *= 0.65
        g *= 0.65
        b *= 0.65
      }
      const oi = ((oy + offsetY) * outW + ox + offsetX) * 4
      out[oi] = Math.round(r)
      out[oi + 1] = Math.round(g)
      out[oi + 2] = Math.round(b)
      out[oi + 3] = 255
    }
  }

  if (labels) {
    const draw = (text: string, x0: number, y0: number): void => {
      let x = x0
      for (const ch of text) {
        const glyph = DIGITS[ch.charCodeAt(0) - 48]
        for (let gy = 0; gy < GLYPH_H; gy++) {
          for (let gx = 0; gx < GLYPH_W; gx++) {
            if (glyph[gy][gx] !== '#') continue
            for (let dy = 0; dy < f; dy++) {
              for (let dx = 0; dx < f; dx++) {
                const px = x + gx * f + dx
                const py = y0 + gy * f + dy
                if (px < 0 || py < 0 || px >= outW || py >= outH) continue
                const oi = (py * outW + px) * 4
                out[oi] = INK[0]
                out[oi + 1] = INK[1]
                out[oi + 2] = INK[2]
              }
            }
          }
        }
        x += (GLYPH_W + 1) * f
      }
    }
    for (let c = 0; c < w; c += labelStep) {
      const text = String(c)
      const tw = textWidth(text, f)
      const x = Math.round(offsetX + c * scale + scale / 2 - tw / 2)
      draw(text, Math.min(Math.max(x, offsetX), outW - tw), f)
    }
    for (let r = 0; r < h; r += labelStep) {
      const text = String(r)
      const tw = textWidth(text, f)
      const y = Math.round(offsetY + r * scale + scale / 2 - (GLYPH_H * f) / 2)
      draw(text, offsetX - 2 * f - tw, Math.min(Math.max(y, offsetY), outH - GLYPH_H * f))
    }
  }

  return {
    image: { width: outW, height: outH, data: out },
    scale,
    offsetX,
    offsetY,
    fontScale: f,
    labelStep
  }
}
