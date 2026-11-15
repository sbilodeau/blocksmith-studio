import { describe, expect, it } from 'vitest'
import {
  adjustBrightness,
  adjustSaturation,
  applyPalette,
  cloneImage,
  colorDistance,
  createImage,
  extractPalette,
  getPixel,
  hueShift,
  imagesEqual,
  outline,
  parseHex,
  replaceColor,
  rgbaEquals,
  setPixel,
  toHex,
  type Rgba,
  type RgbaImage
} from '@shared/image'

const RED: Rgba = [255, 0, 0, 255]
const GREEN: Rgba = [0, 255, 0, 255]
const BLUE: Rgba = [0, 0, 255, 255]

/** 1-row image from a list of colors. */
function row(...colors: Rgba[]): RgbaImage {
  const img = createImage(colors.length, 1)
  colors.forEach((c, x) => setPixel(img, x, 0, c))
  return img
}

const pixels = (img: RgbaImage): Rgba[] =>
  Array.from({ length: img.width * img.height }, (_, p) =>
    getPixel(img, p % img.width, Math.floor(p / img.width))
  )

/** Deterministic pseudo-random image (all channels, alpha included). */
function noise(w: number, h: number, seed = 1): RgbaImage {
  const img = createImage(w, h)
  let s = seed
  for (let i = 0; i < img.data.length; i++) {
    s = (s * 1103515245 + 12345) >>> 0
    img.data[i] = s >>> 24
  }
  return img
}

function mask(img: RgbaImage, color: Rgba): string[] {
  const rows: string[] = []
  for (let y = 0; y < img.height; y++) {
    let r = ''
    for (let x = 0; x < img.width; x++) r += rgbaEquals(getPixel(img, x, y), color) ? '#' : '.'
    rows.push(r)
  }
  return rows
}

describe('parseHex / toHex', () => {
  it.each([
    ['#rgb', '#f80', [255, 136, 0, 255]],
    ['#rgba', '#f808', [255, 136, 0, 136]],
    ['#rrggbb', '#12ab9F', [0x12, 0xab, 0x9f, 255]],
    ['#rrggbbaa', '#12AB9F40', [0x12, 0xab, 0x9f, 0x40]],
    ['no #', '00ff00', [0, 255, 0, 255]],
    ['short, no #', 'FFF', [255, 255, 255, 255]],
    ['surrounding spaces', '  #000000ff ', [0, 0, 0, 255]]
  ])('parses %s', (_label, input, expected) => {
    expect(parseHex(input)).toEqual(expected)
  })

  it.each([
    '',
    '#',
    '#12',
    '#12345',
    '#1234567',
    '#123456789',
    '#ggg',
    'red',
    '#12 456',
    '##123456'
  ])('throws on %j', (input) => {
    expect(() => parseHex(input)).toThrow()
  })

  it('formats lowercase #rrggbbaa and round-trips', () => {
    expect(toHex([255, 136, 0, 255])).toBe('#ff8800ff')
    expect(toHex([0, 0, 0, 0])).toBe('#00000000')
    expect(toHex([1, 2, 3, 4])).toBe('#01020304')
    expect(parseHex(toHex([18, 171, 159, 64]))).toEqual([18, 171, 159, 64])
  })
})

describe('rgbaEquals / colorDistance', () => {
  it('compares all four channels', () => {
    expect(rgbaEquals([1, 2, 3, 4], [1, 2, 3, 4])).toBe(true)
    expect(rgbaEquals([1, 2, 3, 4], [1, 2, 3, 5])).toBe(false)
  })

  it('is the max absolute channel difference, alpha included', () => {
    expect(colorDistance([10, 20, 30, 255], [10, 20, 30, 255])).toBe(0)
    expect(colorDistance([10, 20, 30, 255], [15, 10, 33, 255])).toBe(10)
    expect(colorDistance([10, 20, 30, 255], [10, 20, 30, 0])).toBe(255)
  })
})

describe('extractPalette', () => {
  const img = row(
    RED,
    BLUE,
    RED,
    GREEN,
    [0, 0, 0, 0],
    GREEN,
    [255, 0, 0, 128],
    BLUE,
    [9, 9, 9, 0],
    RED
  )

  it('counts distinct colors, ignores transparent pixels, sorts by count then hex', () => {
    expect(extractPalette(img)).toEqual([
      { color: RED, count: 3 },
      { color: BLUE, count: 2 },
      { color: GREEN, count: 2 },
      { color: [255, 0, 0, 128], count: 1 }
    ])
  })

  it('limits the length with max', () => {
    expect(extractPalette(img, { max: 2 })).toEqual([
      { color: RED, count: 3 },
      { color: BLUE, count: 2 }
    ])
    expect(extractPalette(img, { max: 0 })).toEqual([])
    expect(extractPalette(createImage(2, 2))).toEqual([])
  })

  it('counts runs correctly', () => {
    const big = createImage(16, 16, GREEN)
    setPixel(big, 15, 15, RED)
    expect(extractPalette(big)).toEqual([
      { color: GREEN, count: 255 },
      { color: RED, count: 1 }
    ])
  })
})

describe('replaceColor', () => {
  it('replaces exact matches and counts them', () => {
    const img = row(RED, BLUE, RED)
    expect(replaceColor(img, RED, GREEN)).toBe(2)
    expect(pixels(img)).toEqual([GREEN, BLUE, GREEN])
  })

  it('applies the tolerance on every channel, alpha included', () => {
    const img = row(
      [100, 100, 100, 255],
      [105, 95, 100, 255],
      [100, 100, 100, 249],
      [111, 100, 100, 255]
    )
    expect(replaceColor(img, [100, 100, 100, 255], RED, 5)).toBe(2)
    expect(pixels(img)).toEqual([RED, RED, [100, 100, 100, 249], [111, 100, 100, 255]])
  })

  it('returns 0 when nothing changes', () => {
    const img = row(RED, BLUE)
    expect(replaceColor(img, RED, RED)).toBe(0)
    expect(replaceColor(img, GREEN, BLUE)).toBe(0)
  })

  it('matches every fully transparent pixel as [0, 0, 0, 0]', () => {
    const img = row([0, 0, 0, 0], [50, 60, 70, 0], RED)
    expect(replaceColor(img, [255, 255, 255, 0], BLUE)).toBe(2)
    expect(pixels(img)).toEqual([BLUE, BLUE, RED])
  })
})

describe('hueShift', () => {
  it('rotates pure hues', () => {
    const img = row(RED, GREEN, BLUE)
    hueShift(img, 120)
    expect(pixels(img)).toEqual([GREEN, BLUE, RED])
    hueShift(img, -120)
    expect(pixels(img)).toEqual([RED, GREEN, BLUE])
    const yellow = row(RED)
    hueShift(yellow, 60)
    expect(pixels(yellow)).toEqual([[255, 255, 0, 255]])
  })

  it('keeps saturation and value', () => {
    const img = row([200, 100, 100, 255])
    hueShift(img, 180)
    expect(pixels(img)).toEqual([[100, 200, 200, 255]])
    const wrapped = row([200, 100, 100, 255])
    hueShift(wrapped, -180)
    expect(pixels(wrapped)).toEqual([[100, 200, 200, 255]])
  })

  it('leaves grays and transparent pixels alone, keeps alpha', () => {
    const img = row([128, 128, 128, 255], [255, 0, 0, 0], [255, 0, 0, 100])
    hueShift(img, 120)
    expect(pixels(img)).toEqual([
      [128, 128, 128, 255],
      [255, 0, 0, 0],
      [0, 255, 0, 100]
    ])
  })

  it('is an exact no-op for 0 and multiples of 360', () => {
    const img = noise(32, 32)
    const copy = cloneImage(img)
    hueShift(copy, 0)
    hueShift(copy, 360)
    hueShift(copy, -360)
    expect(imagesEqual(copy, img)).toBe(true)
  })

  it('only touches the (clamped) region', () => {
    const img = row(RED, RED, RED)
    hueShift(img, 120, { x: 1, y: -1, width: 9, height: 9 })
    expect(pixels(img)).toEqual([RED, GREEN, GREEN])
    hueShift(img, 120, { x: 5, y: 0, width: 2, height: 1 })
    expect(pixels(img)).toEqual([RED, GREEN, GREEN])
  })
})

describe('adjustSaturation', () => {
  it('desaturates to gray at -1 (HSL lightness kept)', () => {
    const img = row([200, 100, 50, 255], RED)
    adjustSaturation(img, -1)
    expect(pixels(img)).toEqual([
      [125, 125, 125, 255],
      [128, 128, 128, 255]
    ])
  })

  it('scales or boosts saturation', () => {
    const half = row([150, 100, 100, 255])
    adjustSaturation(half, -0.5)
    expect(pixels(half)).toEqual([[138, 113, 113, 255]])
    const more = row([150, 100, 100, 255])
    adjustSaturation(more, 0.5)
    expect(pixels(more)).toEqual([[200, 50, 50, 255]])
    const full = row([150, 100, 100, 255])
    adjustSaturation(full, 1)
    expect(pixels(full)).toEqual([[250, 0, 0, 255]])
  })

  it('keeps grays and transparent pixels, respects the region, and is exact at 0', () => {
    const img = row(
      [90, 90, 90, 255],
      [150, 100, 100, 0],
      [150, 100, 100, 255],
      [150, 100, 100, 255]
    )
    adjustSaturation(img, 1, { x: 0, y: 0, width: 3, height: 1 })
    expect(pixels(img)).toEqual([
      [90, 90, 90, 255],
      [150, 100, 100, 0],
      [250, 0, 0, 255],
      [150, 100, 100, 255]
    ])
    const n = noise(32, 32, 7)
    const copy = cloneImage(n)
    adjustSaturation(copy, 0)
    expect(imagesEqual(copy, n)).toBe(true)
  })
})

describe('adjustBrightness', () => {
  it('goes to white at +1 and black at -1', () => {
    const up = row([200, 100, 100, 255], [10, 20, 30, 128])
    adjustBrightness(up, 1)
    expect(pixels(up)).toEqual([
      [255, 255, 255, 255],
      [255, 255, 255, 128]
    ])
    const down = row([200, 100, 100, 255])
    adjustBrightness(down, -1)
    expect(pixels(down)).toEqual([[0, 0, 0, 255]])
  })

  it('changes HSL lightness keeping hue and saturation', () => {
    const red = row(RED)
    adjustBrightness(red, 0.5)
    expect(pixels(red)).toEqual([[255, 128, 128, 255]])
    const dark = row([200, 100, 100, 255])
    adjustBrightness(dark, -0.5)
    expect(pixels(dark)).toEqual([[111, 39, 39, 255]])
    const gray = row([100, 100, 100, 255])
    adjustBrightness(gray, 0.5)
    expect(pixels(gray)).toEqual([[178, 178, 178, 255]])
  })

  it('skips transparent pixels, respects the region, and is exact at 0', () => {
    const img = row([100, 100, 100, 0], [100, 100, 100, 255], [100, 100, 100, 255])
    adjustBrightness(img, -1, { x: 0, y: 0, width: 2, height: 1 })
    expect(pixels(img)).toEqual([
      [100, 100, 100, 0],
      [0, 0, 0, 255],
      [100, 100, 100, 255]
    ])
    const n = noise(32, 32, 3)
    const copy = cloneImage(n)
    adjustBrightness(copy, 0)
    expect(imagesEqual(copy, n)).toBe(true)
  })
})

describe('applyPalette', () => {
  const palette: Rgba[] = [
    [0, 0, 0, 255],
    [255, 255, 255, 255],
    [255, 0, 0, 255]
  ]

  it('maps each visible pixel to the nearest color (Euclidean RGB), keeping its alpha', () => {
    const img = row(
      [200, 30, 30, 255],
      [100, 100, 100, 255],
      [250, 250, 250, 77],
      [250, 250, 250, 0]
    )
    applyPalette(img, palette)
    expect(pixels(img)).toEqual([
      [255, 0, 0, 255],
      [0, 0, 0, 255],
      [255, 255, 255, 77],
      [250, 250, 250, 0]
    ])
  })

  it('breaks ties with the first palette entry', () => {
    const img = row([10, 0, 0, 255])
    applyPalette(img, [
      [20, 0, 0, 255],
      [0, 0, 0, 255]
    ])
    expect(pixels(img)).toEqual([[20, 0, 0, 255]])
  })

  it('respects the region and ignores an empty palette', () => {
    const img = row([200, 30, 30, 255], [200, 30, 30, 255])
    applyPalette(img, [], undefined)
    expect(pixels(img)).toEqual([
      [200, 30, 30, 255],
      [200, 30, 30, 255]
    ])
    applyPalette(img, palette, { x: 1, y: 0, width: 1, height: 1 })
    expect(pixels(img)).toEqual([
      [200, 30, 30, 255],
      [255, 0, 0, 255]
    ])
  })
})

describe('outline', () => {
  const C: Rgba = [1, 2, 3, 255]

  it("'outside' paints transparent 4-neighbours of opaque pixels, without cascading", () => {
    const img = createImage(5, 5)
    setPixel(img, 2, 2, RED)
    outline(img, C, 'outside')
    expect(mask(img, C)).toEqual(['.....', '..#..', '.#.#.', '..#..', '.....'])
    expect(getPixel(img, 2, 2)).toEqual(RED)
  })

  it("'outside' stops at the image border", () => {
    const img = createImage(3, 3)
    setPixel(img, 0, 0, [9, 9, 9, 10])
    outline(img, C, 'outside')
    expect(mask(img, C)).toEqual(['.#.', '#..', '...'])
  })

  it("'inside' paints opaque pixels touching transparency", () => {
    const img = createImage(5, 5)
    for (let y = 1; y < 4; y++) for (let x = 1; x < 4; x++) setPixel(img, x, y, RED)
    outline(img, C, 'inside')
    expect(mask(img, C)).toEqual(['.....', '.###.', '.#.#.', '.###.', '.....'])
    expect(getPixel(img, 2, 2)).toEqual(RED)
  })

  it("'inside' paints opaque pixels on the image border", () => {
    const img = createImage(4, 4, RED)
    outline(img, C, 'inside')
    expect(mask(img, C)).toEqual(['####', '#..#', '#..#', '####'])
  })
})
