import { describe, expect, it } from 'vitest'
import {
  FALLBACK_VIEWPORT,
  OVERSCAN_ROWS,
  TILE_CHROME,
  gridLayout,
  rowRange,
  scrollToReveal
} from '@renderer/components/pack/grid-layout'

describe('virtual grid layout', () => {
  it('fits as many fixed-size tiles per row as the width allows', () => {
    // zoom 64: tiles 80 x 102, pitch 84 x 106.
    const layout = gridLayout(10_000, 64, 844)
    expect(layout).toMatchObject({ columns: 10, tileWidth: 80, tileHeight: 102, rowPitch: 106 })
    expect(layout.rows).toBe(1000)
    expect(layout.totalHeight).toBe(1000 * 106 - TILE_CHROME.gap)
    expect(gridLayout(10_000, 64, 836).columns).toBe(10)
    expect(gridLayout(10_000, 64, 835).columns).toBe(9)
    expect(gridLayout(3, 160, 10).columns).toBe(1)
    expect(gridLayout(0, 64, 800)).toMatchObject({ rows: 0, totalHeight: 0 })
  })

  it('uses a fallback viewport before layout', () => {
    expect(gridLayout(100, 64, 0).columns).toBe(
      gridLayout(100, 64, FALLBACK_VIEWPORT.width).columns
    )
    const layout = gridLayout(10_000, 64, 0)
    const [first, last] = rowRange(layout, 0, 0)
    expect(first).toBe(0)
    expect(last).toBe(Math.floor(FALLBACK_VIEWPORT.height / layout.rowPitch) + OVERSCAN_ROWS)
  })

  it('renders the rows in view plus the overscan, clamped to the grid', () => {
    const layout = gridLayout(10_000, 64, 844) // 1000 rows of 106 px
    expect(rowRange(layout, 0, 530)).toEqual([0, 5 + OVERSCAN_ROWS])
    expect(rowRange(layout, 106 * 500, 530)).toEqual([500 - OVERSCAN_ROWS, 505 + OVERSCAN_ROWS])
    expect(rowRange(layout, layout.totalHeight, 530)).toEqual([999 - OVERSCAN_ROWS, 999])
    expect(rowRange(gridLayout(0, 64, 844), 0, 530)).toEqual([0, -1])
  })

  it('scrolls the least needed to reveal a tile', () => {
    const layout = gridLayout(10_000, 64, 844)
    // Row 50 starts at 5300 and ends at 5402.
    expect(scrollToReveal(layout, 505, 0, 530)).toBe(5402 - 530)
    expect(scrollToReveal(layout, 505, 9000, 530)).toBe(5300)
    expect(scrollToReveal(layout, 505, 5000, 530)).toBe(5000)
    expect(scrollToReveal(layout, 0, 0, 530)).toBe(0)
  })
})
