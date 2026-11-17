import { describe, expect, it } from 'vitest'
import { visibleSpan } from '@renderer/components/editor/geometry'

describe('visibleSpan', () => {
  it('clips the drawn image to the canvas', () => {
    // A 512 px texture at 32x (16384 px) panned so the canvas shows a small part of it.
    expect(visibleSpan(-8000, -4000, 16384, 16384, 800, 600)).toEqual({
      x0: 0,
      y0: 0,
      x1: 800,
      y1: 600
    })
    // Image smaller than the canvas, centered.
    expect(visibleSpan(144, 44, 512, 512, 800, 600)).toEqual({ x0: 144, y0: 44, x1: 656, y1: 556 })
    // Image panned out of view: empty span.
    const off = visibleSpan(900, 0, 512, 512, 800, 600)
    expect(off.x1).toBeLessThanOrEqual(off.x0)
  })
})
