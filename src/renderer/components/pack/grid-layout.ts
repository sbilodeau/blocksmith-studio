/**
 * Layout math of the virtual texture grid (TextureGrid.vue): fixed-size tiles in rows, only the rows in view
 * rendered. Pure functions so they are tested without a DOM.
 */

/** Tile size around the image (TextureTile.vue): padding, border, gap and the name line; space between tiles. */
export const TILE_CHROME = { width: 16, height: 38, gap: 4 } as const

/** Rows rendered above and below the viewport, so fast scrolling does not show empty space. */
export const OVERSCAN_ROWS = 3

/** Viewport size used when the element has no layout yet (first frame, tests without layout). */
export const FALLBACK_VIEWPORT = { width: 1024, height: 768 } as const

export interface GridLayout {
  columns: number
  rows: number
  tileWidth: number
  tileHeight: number
  /** Tile height plus the gap. */
  rowPitch: number
  totalHeight: number
}

export function gridLayout(count: number, zoom: number, viewportWidth: number): GridLayout {
  const tileWidth = zoom + TILE_CHROME.width
  const tileHeight = zoom + TILE_CHROME.height
  const width = viewportWidth > 0 ? viewportWidth : FALLBACK_VIEWPORT.width
  const columns = Math.max(1, Math.floor((width + TILE_CHROME.gap) / (tileWidth + TILE_CHROME.gap)))
  const rows = Math.ceil(count / columns)
  const rowPitch = tileHeight + TILE_CHROME.gap
  return {
    columns,
    rows,
    tileWidth,
    tileHeight,
    rowPitch,
    totalHeight: rows > 0 ? rows * rowPitch - TILE_CHROME.gap : 0
  }
}

/** First and last row to render (inclusive) for a scroll position, overscan included. */
export function rowRange(
  layout: GridLayout,
  scrollTop: number,
  viewportHeight: number
): [number, number] {
  if (layout.rows === 0) return [0, -1]
  const height = viewportHeight > 0 ? viewportHeight : FALLBACK_VIEWPORT.height
  const top = Math.max(0, scrollTop)
  const first = Math.max(0, Math.floor(top / layout.rowPitch) - OVERSCAN_ROWS)
  const last = Math.min(
    layout.rows - 1,
    Math.floor((top + height) / layout.rowPitch) + OVERSCAN_ROWS
  )
  return [Math.min(first, last), last]
}

/** Scroll position that shows the tile at `index` with the least movement (like block: 'nearest'). */
export function scrollToReveal(
  layout: GridLayout,
  index: number,
  scrollTop: number,
  viewportHeight: number
): number {
  const top = Math.floor(index / layout.columns) * layout.rowPitch
  const bottom = top + layout.tileHeight
  if (top < scrollTop) return top
  if (bottom > scrollTop + viewportHeight) return Math.max(0, bottom - viewportHeight)
  return scrollTop
}
