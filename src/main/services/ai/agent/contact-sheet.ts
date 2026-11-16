import { createImage, cropImage, encodePng, type RgbaImage } from '@shared/image'
import { drawNumber, GLYPH_H, numberWidth } from './render'

/**
 * Contact sheets for the navigation agent (PLAN 6.6 point 4): many textures in one image, each in its own tile with
 * its index number, so a vision model can see a whole selection and refer to textures by number.
 */

/** Textures per sheet (6 x 6) and sheets per request. */
export const SHEET_COLUMNS = 6
export const SHEET_ROWS = 6
export const TILES_PER_SHEET = SHEET_COLUMNS * SHEET_ROWS
export const MAX_SHEETS = 3
/** Tile picture size in px (textures are scaled with nearest-neighbor to fit). */
export const TILE = 64
const LABEL_H = GLYPH_H + 4
const GAP = 4

export interface SheetTexture {
  /** 1-based index shown on the tile and used by the tools. */
  index: number
  image: RgbaImage
  /** Animated strips: only the first frame is drawn. */
  frameHeight?: number
}

/** Nearest-neighbor scale of `src` into a `size` x `size` box (aspect kept), on a checkerboard. */
function fitTile(src: RgbaImage, size: number): RgbaImage {
  const out = createImage(size, size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const light = ((x >> 3) + (y >> 3)) % 2 === 0
      const v = light ? 235 : 205
      const i = (y * size + x) * 4
      out.data[i] = v
      out.data[i + 1] = v
      out.data[i + 2] = v
      out.data[i + 3] = 255
    }
  }
  const long = Math.max(src.width, src.height, 1)
  const scale = size / long
  const w = Math.max(1, Math.round(src.width * scale))
  const h = Math.max(1, Math.round(src.height * scale))
  const ox = Math.floor((size - w) / 2)
  const oy = Math.floor((size - h) / 2)
  for (let y = 0; y < h; y++) {
    const sy = Math.min(src.height - 1, Math.floor(y / scale))
    for (let x = 0; x < w; x++) {
      const sx = Math.min(src.width - 1, Math.floor(x / scale))
      const si = (sy * src.width + sx) * 4
      const a = src.data[si + 3]! / 255
      if (a === 0) continue
      const di = ((oy + y) * size + ox + x) * 4
      for (let c = 0; c < 3; c++) {
        out.data[di + c] = Math.round(src.data[si + c]! * a + out.data[di + c]! * (1 - a))
      }
    }
  }
  return out
}

/** One sheet image for up to TILES_PER_SHEET textures. */
export function renderContactSheet(textures: readonly SheetTexture[]): RgbaImage {
  const cols = Math.min(SHEET_COLUMNS, Math.max(1, textures.length))
  const rows = Math.ceil(textures.length / cols) || 1
  const cellW = TILE + GAP
  const cellH = TILE + LABEL_H + GAP
  const out = createImage(cols * cellW + GAP, rows * cellH + GAP, [255, 255, 255, 255])
  textures.forEach((t, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    const x = GAP + col * cellW
    const y = GAP + row * cellH
    const frame =
      t.frameHeight && t.frameHeight < t.image.height
        ? cropImage(t.image, { x: 0, y: 0, width: t.image.width, height: t.frameHeight })
        : t.image
    const tile = fitTile(frame, TILE)
    for (let ty = 0; ty < TILE; ty++) {
      const src = ty * TILE * 4
      out.data.set(
        tile.data.subarray(src, src + TILE * 4),
        ((y + LABEL_H + ty) * out.width + x) * 4
      )
    }
    const label = String(t.index)
    drawNumber(out, label, x + Math.floor((TILE - numberWidth(label)) / 2), y + 1)
  })
  return out
}

/** PNG sheets for the first MAX_SHEETS x TILES_PER_SHEET textures. */
export function contactSheetPngs(textures: readonly SheetTexture[]): Uint8Array[] {
  const sheets: Uint8Array[] = []
  for (let i = 0; i < textures.length && sheets.length < MAX_SHEETS; i += TILES_PER_SHEET) {
    sheets.push(encodePng(renderContactSheet(textures.slice(i, i + TILES_PER_SHEET))))
  }
  return sheets
}
