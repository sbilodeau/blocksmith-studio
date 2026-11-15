import { describe, expect, it } from 'vitest'
import {
  createImage,
  drawLine,
  drawRect,
  fillRect,
  floodFill,
  getPixel,
  linePoints,
  mirrorPoints,
  setPixel,
  type Point,
  type Rgba,
  type RgbaImage
} from '@shared/image'

const RED: Rgba = [255, 0, 0, 255]
const BLUE: Rgba = [0, 0, 255, 255]
const GREEN: Rgba = [0, 255, 0, 255]

/** Rows of '#' (pixel equals `color`) and '.' (anything else). */
function mask(img: RgbaImage, color: Rgba): string[] {
  const rows: string[] = []
  for (let y = 0; y < img.height; y++) {
    let row = ''
    for (let x = 0; x < img.width; x++) {
      const p = getPixel(img, x, y)
      row +=
        p[0] === color[0] && p[1] === color[1] && p[2] === color[2] && p[3] === color[3] ? '#' : '.'
    }
    rows.push(row)
  }
  return rows
}

/** Builds an image from rows of characters mapped to colors. */
function fromRows(rows: string[], colors: Record<string, Rgba>): RgbaImage {
  const img = createImage(rows[0].length, rows.length)
  rows.forEach((row, y) => [...row].forEach((ch, x) => setPixel(img, x, y, colors[ch])))
  return img
}

const xy = (pts: Point[]): number[][] => pts.map((p) => [p.x, p.y])

describe('linePoints', () => {
  it('returns a single point when both ends are equal', () => {
    expect(xy(linePoints({ x: 2, y: 3 }, { x: 2, y: 3 }))).toEqual([[2, 3]])
  })

  it('draws horizontal, vertical and diagonal lines inclusive of both ends', () => {
    expect(xy(linePoints({ x: 0, y: 1 }, { x: 3, y: 1 }))).toEqual([
      [0, 1],
      [1, 1],
      [2, 1],
      [3, 1]
    ])
    expect(xy(linePoints({ x: 1, y: 2 }, { x: 1, y: 0 }))).toEqual([
      [1, 2],
      [1, 1],
      [1, 0]
    ])
    expect(xy(linePoints({ x: 3, y: 0 }, { x: 0, y: 3 }))).toEqual([
      [3, 0],
      [2, 1],
      [1, 2],
      [0, 3]
    ])
  })

  it('draws a shallow line exactly', () => {
    expect(xy(linePoints({ x: 0, y: 0 }, { x: 4, y: 2 }))).toEqual([
      [0, 0],
      [1, 1],
      [2, 1],
      [3, 2],
      [4, 2]
    ])
  })

  it('floors non-integer coordinates', () => {
    expect(xy(linePoints({ x: 0.9, y: 0.2 }, { x: 2.7, y: 0.99 }))).toEqual([
      [0, 0],
      [1, 0],
      [2, 0]
    ])
  })

  it('returns nothing for non-finite coordinates', () => {
    expect(linePoints({ x: Number.NaN, y: 0 }, { x: 3, y: 0 })).toEqual([])
  })

  // One target per octant, from (10, 10).
  it.each([
    [15, 12],
    [12, 15],
    [8, 15],
    [5, 12],
    [5, 8],
    [8, 5],
    [12, 5],
    [15, 8],
    [17, 11],
    [3, 9]
  ])('is a proper Bresenham line in every octant (to %i,%i)', (tx, ty) => {
    const a = { x: 10, y: 10 }
    const b = { x: tx, y: ty }
    const pts = linePoints(a, b)
    const dx = b.x - a.x
    const dy = b.y - a.y
    expect(pts[0]).toEqual(a)
    expect(pts[pts.length - 1]).toEqual(b)
    expect(pts.length).toBe(Math.max(Math.abs(dx), Math.abs(dy)) + 1)
    const xMajor = Math.abs(dx) >= Math.abs(dy)
    for (let i = 1; i < pts.length; i++) {
      // Steps of exactly one pixel along the major axis, at most one along the minor axis.
      const sx = pts[i].x - pts[i - 1].x
      const sy = pts[i].y - pts[i - 1].y
      expect(Math.abs(xMajor ? sx : sy)).toBe(1)
      expect(Math.abs(xMajor ? sy : sx)).toBeLessThanOrEqual(1)
    }
    for (const p of pts) {
      // Every pixel is within half a pixel of the ideal line on the minor axis.
      const err = xMajor
        ? Math.abs(p.y - (a.y + ((p.x - a.x) * dy) / dx))
        : Math.abs(p.x - (a.x + ((p.y - a.y) * dx) / dy))
      expect(err).toBeLessThanOrEqual(0.5)
    }
  })
})

describe('drawLine', () => {
  it('draws the line pixels and skips the ones out of bounds', () => {
    const img = createImage(4, 3)
    drawLine(img, { x: -2, y: 0 }, { x: 5, y: 0 }, RED)
    drawLine(img, { x: 1, y: 1 }, { x: 3, y: 2 }, BLUE)
    expect(mask(img, RED)).toEqual(['####', '....', '....'])
    expect(mask(img, BLUE)).toEqual(['....', '.#..', '..##'])
  })

  it('draws a single point', () => {
    const img = createImage(2, 2)
    drawLine(img, { x: 1, y: 1 }, { x: 1, y: 1 }, RED)
    expect(mask(img, RED)).toEqual(['..', '.#'])
  })
})

describe('drawRect / fillRect', () => {
  it('draws a 1-px outline', () => {
    const img = createImage(5, 5)
    drawRect(img, { x: 1, y: 1, width: 4, height: 3 }, RED)
    expect(mask(img, RED)).toEqual(['.....', '.####', '.#..#', '.####', '.....'])
  })

  it('draws thin rects as lines or a point', () => {
    const img = createImage(4, 4)
    drawRect(img, { x: 1, y: 0, width: 1, height: 3 }, RED)
    drawRect(img, { x: 3, y: 3, width: 1, height: 1 }, RED)
    expect(mask(img, RED)).toEqual(['.#..', '.#..', '.#..', '...#'])
  })

  it('clamps the rect to the image before drawing the outline', () => {
    const img = createImage(4, 4)
    drawRect(img, { x: 2, y: -3, width: 10, height: 5 }, RED)
    expect(mask(img, RED)).toEqual(['..##', '..##', '....', '....'])
    const full = createImage(3, 3)
    drawRect(full, { x: -1, y: -1, width: 9, height: 9 }, RED)
    expect(mask(full, RED)).toEqual(['###', '#.#', '###'])
  })

  it('fills a clamped rect', () => {
    const img = createImage(4, 3)
    fillRect(img, { x: 1, y: 1, width: 10, height: 10 }, RED)
    expect(mask(img, RED)).toEqual(['....', '.###', '.###'])
    fillRect(img, { x: -2, y: -2, width: 3, height: 3 }, BLUE)
    expect(mask(img, BLUE)).toEqual(['#...', '....', '....'])
  })

  it('is a no-op for empty or outside rects', () => {
    const img = createImage(3, 3)
    drawRect(img, { x: 0, y: 0, width: 0, height: 3 }, RED)
    fillRect(img, { x: 0, y: 0, width: 3, height: -1 }, RED)
    fillRect(img, { x: 5, y: 0, width: 3, height: 3 }, RED)
    drawRect(img, { x: 0, y: -4, width: 3, height: 3 }, RED)
    expect([...img.data].every((v) => v === 0)).toBe(true)
  })
})

describe('floodFill', () => {
  const colors: Record<string, Rgba> = { r: RED, b: BLUE, g: GREEN, '.': [0, 0, 0, 0] }

  it('fills the contiguous 4-connected region only', () => {
    const img = fromRows(['rrbr', 'rbbr', 'brrr', 'rbbb'], colors)
    expect(floodFill(img, 0, 0, GREEN)).toBe(3)
    expect(mask(img, GREEN)).toEqual(['##..', '#...', '....', '....'])
  })

  it('does not leak through diagonals', () => {
    const img = fromRows(['rb', 'br'], colors)
    expect(floodFill(img, 0, 0, GREEN)).toBe(1)
    expect(mask(img, GREEN)).toEqual(['#.', '..'])
  })

  it('replaces every matching pixel when contiguous is false', () => {
    const img = fromRows(['rrbr', 'rbbr', 'brrr', 'rbbb'], colors)
    expect(floodFill(img, 0, 0, GREEN, { contiguous: false })).toBe(9)
    expect(mask(img, GREEN)).toEqual(['##.#', '#..#', '.###', '#...'])
  })

  it('uses the max channel distance (alpha included) for tolerance', () => {
    const build = (): RgbaImage => {
      const img = createImage(4, 1, [100, 100, 100, 255])
      setPixel(img, 1, 0, [110, 100, 100, 255])
      setPixel(img, 2, 0, [100, 100, 100, 240])
      setPixel(img, 3, 0, [100, 100, 100, 255])
      return img
    }
    let img = build()
    expect(floodFill(img, 0, 0, GREEN, { tolerance: 9 })).toBe(1)
    img = build()
    expect(floodFill(img, 0, 0, GREEN, { tolerance: 10 })).toBe(2)
    img = build()
    expect(floodFill(img, 0, 0, GREEN, { tolerance: 15 })).toBe(4)
    img = build()
    expect(floodFill(img, 0, 0, GREEN, { tolerance: 9, contiguous: false })).toBe(2)
    expect(mask(img, GREEN)).toEqual(['#..#'])
  })

  it('compares against the clicked pixel, not neighbour to neighbour', () => {
    const img = createImage(3, 1)
    setPixel(img, 0, 0, [0, 0, 0, 255])
    setPixel(img, 1, 0, [5, 0, 0, 255])
    setPixel(img, 2, 0, [10, 0, 0, 255])
    expect(floodFill(img, 0, 0, RED, { tolerance: 5 })).toBe(2)
    expect(mask(img, RED)).toEqual(['##.'])
  })

  it('returns 0 when filling with the same color or out of bounds', () => {
    const img = fromRows(['rr', 'rb'], colors)
    expect(floodFill(img, 0, 0, RED)).toBe(0)
    expect(floodFill(img, 0, 0, RED, { contiguous: false, tolerance: 0 })).toBe(0)
    expect(floodFill(img, -1, 0, GREEN)).toBe(0)
    expect(floodFill(img, 0, 2, GREEN)).toBe(0)
    expect(mask(img, RED)).toEqual(['##', '#.'])
  })

  it('treats every fully transparent pixel as the same color', () => {
    const img = createImage(3, 1)
    setPixel(img, 0, 0, [0, 0, 0, 0])
    setPixel(img, 1, 0, [200, 10, 30, 0])
    setPixel(img, 2, 0, RED)
    expect(floodFill(img, 1, 0, BLUE)).toBe(2)
    expect(mask(img, BLUE)).toEqual(['##.'])
  })

  it('erases a region (fill with transparent)', () => {
    const img = fromRows(['rrb'], colors)
    expect(floodFill(img, 0, 0, [0, 0, 0, 0])).toBe(2)
    expect(getPixel(img, 0, 0)).toEqual([0, 0, 0, 0])
    expect(getPixel(img, 2, 0)).toEqual(BLUE)
  })

  it('fills a whole 512x512 image and a 512x512 serpentine without recursion limits', () => {
    const big = createImage(512, 512)
    expect(floodFill(big, 100, 100, RED)).toBe(512 * 512)
    // Serpentine corridor: walls on every odd row, with a gap alternating between the ends.
    const maze = createImage(512, 512)
    let walls = 0
    for (let y = 1; y < 512; y += 2) {
      const gap = (y >> 1) % 2 === 0 ? 511 : 0
      for (let x = 0; x < 512; x++) {
        if (x !== gap) {
          setPixel(maze, x, y, BLUE)
          walls++
        }
      }
    }
    expect(floodFill(maze, 0, 0, RED)).toBe(512 * 512 - walls)
    expect(getPixel(maze, 0, 511)).toEqual(RED)
  })
})

describe('mirrorPoints', () => {
  const pts = (p: Point[]): string[] => p.map((q) => `${q.x},${q.y}`)

  it('returns the point alone without mirroring', () => {
    expect(pts(mirrorPoints({ x: 1, y: 2 }, 4, 4, { x: false, y: false }))).toEqual(['1,2'])
  })

  it('mirrors across the vertical center line (x = W-1-x)', () => {
    expect(pts(mirrorPoints({ x: 1, y: 2 }, 4, 4, { x: true, y: false }))).toEqual(['1,2', '2,2'])
    expect(pts(mirrorPoints({ x: 0, y: 0 }, 16, 16, { x: true, y: false }))).toEqual([
      '0,0',
      '15,0'
    ])
  })

  it('mirrors across the horizontal center line (y = H-1-y)', () => {
    expect(pts(mirrorPoints({ x: 1, y: 0 }, 4, 3, { x: false, y: true }))).toEqual(['1,0', '1,2'])
  })

  it('mirrors on both axes', () => {
    expect(pts(mirrorPoints({ x: 0, y: 1 }, 5, 4, { x: true, y: true }))).toEqual([
      '0,1',
      '4,1',
      '0,2',
      '4,2'
    ])
  })

  it('deduplicates the center column / row on odd sizes', () => {
    expect(pts(mirrorPoints({ x: 2, y: 1 }, 5, 4, { x: true, y: false }))).toEqual(['2,1'])
    expect(pts(mirrorPoints({ x: 2, y: 0 }, 5, 4, { x: true, y: true }))).toEqual(['2,0', '2,3'])
    expect(pts(mirrorPoints({ x: 2, y: 2 }, 5, 5, { x: true, y: true }))).toEqual(['2,2'])
  })
})
