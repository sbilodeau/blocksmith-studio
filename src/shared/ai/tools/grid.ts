import { cropImage, extractPalette, toHex, type Rect, type RgbaImage } from '../../image'

/** Characters used for palette indices (62), transparent pixels are always '.'. */
export const GRID_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

export const TRANSPARENT_HEX = '#00000000'

/**
 * Compact pixel grid sent to models (PLAN 6.6): one character per pixel indexed into `palette`, '.' for fully
 * transparent pixels. With more than 62 visible colors, `palette` is omitted and each row is an array of
 * "#rrggbbaa" strings instead. `x`/`y` give the offset of a sub-rectangle (get_pixels with a rect).
 */
export interface PaletteGrid {
  w: number
  h: number
  origin: 'top-left'
  x?: number
  y?: number
  palette?: Record<string, string>
  rows: string[] | string[][]
}

/** Encodes the whole image, or `rect` (clamped to it) with its offset. */
export function encodeGrid(img: RgbaImage, rect?: Rect): PaletteGrid {
  const src = rect ? cropImage(img, rect) : img
  const { width: w, height: h, data } = src
  const base: PaletteGrid = { w, h, origin: 'top-left', rows: [] }
  if (rect) {
    base.x = Math.max(0, Math.floor(rect.x))
    base.y = Math.max(0, Math.floor(rect.y))
  }
  const palette = extractPalette(src)
  if (palette.length > GRID_CHARS.length) {
    const rows: string[][] = []
    for (let y = 0; y < h; y++) {
      const row: string[] = []
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        row.push(
          data[i + 3] === 0
            ? TRANSPARENT_HEX
            : toHex([data[i], data[i + 1], data[i + 2], data[i + 3]])
        )
      }
      rows.push(row)
    }
    return { ...base, rows }
  }
  const map: Record<string, string> = { '.': TRANSPARENT_HEX }
  const charOf = new Map<string, string>()
  palette.forEach((entry, k) => {
    const hex = toHex(entry.color)
    map[GRID_CHARS[k]] = hex
    charOf.set(hex, GRID_CHARS[k])
  })
  const rows: string[] = []
  for (let y = 0; y < h; y++) {
    let row = ''
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      row +=
        data[i + 3] === 0
          ? '.'
          : (charOf.get(toHex([data[i], data[i + 1], data[i + 2], data[i + 3]])) ?? '.')
    }
    rows.push(row)
  }
  return { ...base, palette: map, rows }
}

/** Number of distinct visible colors and transparent pixels. */
export function paletteSummary(img: RgbaImage): {
  colors: { hex: string; count: number }[]
  transparent: number
} {
  const colors = extractPalette(img).map((e) => ({ hex: toHex(e.color), count: e.count }))
  const visible = colors.reduce((n, c) => n + c.count, 0)
  return { colors, transparent: img.width * img.height - visible }
}
