import { describe, expect, it } from 'vitest'
import {
  createImage,
  getPixel,
  setPixel,
  toHex,
  cloneImage,
  imagesEqual,
  type Rgba,
  type RgbaImage
} from '@shared/image'
import { emptyBrief } from '@shared/model/brief'
import {
  TOOLS,
  ToolError,
  getTool,
  toolJsonSchema,
  toolSpecs,
  type DraftContext,
  type ToolOutput
} from '@shared/ai/tools'

const R: Rgba = [255, 0, 0, 255]
const G: Rgba = [0, 255, 0, 255]
const B: Rgba = [0, 0, 255, 255]
const W: Rgba = [255, 255, 255, 255]
const T: Rgba = [0, 0, 0, 0]

/** Builds an image from rows of chars mapped through `colors` ('.' = transparent). */
function img(rows: string[], colors: Record<string, Rgba> = { r: R, g: G, b: B, w: W }): RgbaImage {
  const out = createImage(rows[0].length, rows.length)
  rows.forEach((row, y) =>
    [...row].forEach((c, x) => setPixel(out, x, y, c === '.' ? T : colors[c]))
  )
  return out
}

/** Inverse of img(): unknown colors become '?'. */
function rows(
  image: RgbaImage,
  colors: Record<string, Rgba> = { r: R, g: G, b: B, w: W }
): string[] {
  const out: string[] = []
  for (let y = 0; y < image.height; y++) {
    let row = ''
    for (let x = 0; x < image.width; x++) {
      const p = getPixel(image, x, y)
      if (p[3] === 0) {
        row += '.'
        continue
      }
      const hit = Object.entries(colors).find(([, c]) => toHex(c) === toHex(p))
      row += hit ? hit[0] : '?'
    }
    out.push(row)
  }
  return out
}

function ctx(image: RgbaImage, vanilla: RgbaImage | null = null): DraftContext {
  return { image, vanilla, brief: emptyBrief() }
}

/** Parses args with the tool schema and executes; asserts the input image is left untouched. */
function run(
  name: string,
  image: RgbaImage,
  args: unknown,
  vanilla?: RgbaImage | null
): ToolOutput {
  const tool = getTool(name)!
  const parsed = tool.params.parse(args)
  const before = cloneImage(image)
  const out = tool.execute(ctx(image, vanilla), parsed)
  expect(imagesEqual(image, before)).toBe(true)
  return out
}

function accepts(name: string, args: unknown): boolean {
  return getTool(name)!.params.safeParse(args).success
}

const VALID: Record<string, unknown> = {
  rotate: { degrees: 90, direction: 'counterclockwise' },
  flip: { axis: 'horizontal' },
  shift: { dx: 1, dy: -2 },
  resize: { width: 32, height: 32 },
  set_pixels: { pixels: [{ x: 0, y: 0, color: '#ff0000' }] },
  draw_line: { x1: 0, y1: 0, x2: 3, y2: 3, color: '#000000' },
  draw_rect: { x: 0, y: 0, width: 4, height: 4, color: '#000000ff' },
  fill_rect: { x: 0, y: 0, width: 4, height: 4, color: '#00ff00' },
  fill: { x: 0, y: 0, color: '#0000ff' },
  erase: { rect: { x: 0, y: 0, width: 2, height: 2 } },
  replace_color: { from: '#ff0000', to: '#00ff00' },
  apply_palette: { palette: ['#000000', '#ffffff'] },
  hue_shift: { degrees: 120 },
  saturation: { delta: -0.5 },
  brightness: { delta: 0.2, region: { x: 0, y: 0, width: 2, height: 2 } },
  outline: { color: '#000000', mode: 'outside' },
  get_pixels: {},
  get_palette: {},
  get_texture: { source: 'vanilla' },
  read_style_brief: {},
  update_style_brief: { patch: { theme: 'Dark medieval' } }
}

const INVALID: Record<string, unknown[]> = {
  rotate: [{ degrees: 45 }, { degrees: 90, direction: 'left' }, {}],
  flip: [{ axis: 'diagonal' }, {}],
  shift: [{ dx: 1.5, dy: 0 }, { dx: 1 }],
  resize: [
    { width: 0, height: 16 },
    { width: 2000, height: 16 }
  ],
  set_pixels: [
    { pixels: [] },
    { pixels: [{ x: 0, y: 0, color: 'red' }] },
    { pixels: [{ x: 0.5, y: 0, color: '#ff0000' }] },
    { pixels: Array.from({ length: 4097 }, () => ({ x: 0, y: 0, color: '#ff0000' })) }
  ],
  draw_line: [{ x1: 0, y1: 0, x2: 3, color: '#000000' }],
  draw_rect: [{ x: 0, y: 0, width: 0, height: 4, color: '#000000' }],
  fill_rect: [{ x: 0, y: 0, width: 4, height: 4, color: '#00ff0' }],
  fill: [{ x: 0, y: 0, color: '#0000ff', tolerance: 300 }],
  erase: [{}, { pixels: [] }],
  replace_color: [{ from: '#ff0000' }, { from: '#ff0000', to: '#00ff00', tolerance: -1 }],
  apply_palette: [{ palette: [] }, { palette: ['#zzzzzz'] }],
  hue_shift: [{ degrees: 400 }, {}],
  saturation: [{ delta: 2 }],
  brightness: [{ delta: -1.5 }],
  outline: [{ color: '#000000', mode: 'around' }],
  get_pixels: [{ rect: { x: 0, y: 0, width: 0, height: 1 } }, { extra: 1 }],
  get_palette: [{ extra: 1 }],
  get_texture: [{ source: 'pack' }, {}],
  read_style_brief: [{ extra: 1 }],
  update_style_brief: [{ patch: { color: 'red' } }, { theme: 'x' }]
}

describe('tool registry', () => {
  it('has the M3 editor tools', () => {
    expect(TOOLS.map((t) => t.name).sort()).toEqual(Object.keys(VALID).sort())
    expect(
      toolSpecs('editor')
        .map((s) => s.name)
        .sort()
    ).toEqual(Object.keys(VALID).sort())
    expect(getTool('nope')).toBeUndefined()
  })

  it.each(Object.keys(VALID))('%s accepts valid args and rejects invalid ones', (name) => {
    expect(accepts(name, VALID[name])).toBe(true)
    for (const bad of INVALID[name]) expect(accepts(name, bad)).toBe(false)
  })

  it.each(TOOLS.map((t) => t.name))('%s generates a JSON Schema object without $schema', (name) => {
    const schema = toolJsonSchema(getTool(name)!)
    expect(schema['$schema']).toBeUndefined()
    expect(schema['type']).toBe('object')
    expect(typeof schema['properties']).toBe('object')
    expect(() => JSON.stringify(schema)).not.toThrow()
  })

  it('marks fields with defaults as optional in the JSON Schema', () => {
    const schema = toolJsonSchema(getTool('rotate')!)
    expect(schema['required']).toEqual(['degrees'])
    expect(schema['additionalProperties']).toBe(false)
  })

  it('gives each tool an English description with FR and EN examples', () => {
    for (const t of TOOLS) {
      expect(t.description.length).toBeGreaterThan(80)
      expect(t.description).toMatch(/Examples?:/)
      expect(t.description).toMatch(/"[^"]*[éèàçêù'][^"]*"|" \/ "/)
    }
    expect(getTool('rotate')!.description).toContain('à gauche')
    expect(getTool('rotate')!.description).toContain('counterclockwise')
    expect(getTool('flip')!.description).toContain('miroir horizontal')
  })

  it('kinds: read, mutate and memory', () => {
    const kinds = Object.fromEntries(TOOLS.map((t) => [t.name, t.kind]))
    expect(kinds['get_pixels']).toBe('read')
    expect(kinds['read_style_brief']).toBe('read')
    expect(kinds['update_style_brief']).toBe('memory')
    expect(kinds['rotate']).toBe('mutate')
  })
})

describe('describe()', () => {
  const cases: [string, unknown, string, Record<string, string | number>][] = [
    [
      'rotate',
      { degrees: 90, direction: 'counterclockwise' },
      'ops.rotate',
      { degrees: 90, direction: 'counterclockwise' }
    ],
    ['rotate', { degrees: 180 }, 'ops.rotate', { degrees: 180, direction: 'clockwise' }],
    ['flip', { axis: 'vertical' }, 'ops.flip', { axis: 'vertical' }],
    ['shift', { dx: 2, dy: 0 }, 'ops.shiftWrap', { dx: 2, dy: 0 }],
    ['shift', { dx: 2, dy: 0, wrap: false }, 'ops.shift', { dx: 2, dy: 0 }],
    ['resize', { width: 32, height: 16 }, 'ops.resize', { width: 32, height: 16 }],
    ['set_pixels', VALID['set_pixels'], 'ops.setPixels', { count: 1 }],
    [
      'draw_line',
      VALID['draw_line'],
      'ops.drawLine',
      { x1: 0, y1: 0, x2: 3, y2: 3, color: '#000000' }
    ],
    [
      'draw_rect',
      { x: 1, y: 2, width: 3, height: 4, color: '#FF0000' },
      'ops.drawRect',
      { x: 1, y: 2, width: 3, height: 4, color: '#ff0000' }
    ],
    [
      'fill_rect',
      VALID['fill_rect'],
      'ops.fillRect',
      { x: 0, y: 0, width: 4, height: 4, color: '#00ff00' }
    ],
    ['fill', VALID['fill'], 'ops.fill', { x: 0, y: 0, color: '#0000ff', tolerance: 0 }],
    [
      'fill',
      { x: 1, y: 1, color: '#0000ff', contiguous: false, tolerance: 5 },
      'ops.fillAll',
      { x: 1, y: 1, color: '#0000ff', tolerance: 5 }
    ],
    ['erase', { pixels: [{ x: 0, y: 0 }] }, 'ops.erasePixels', { count: 1 }],
    ['erase', VALID['erase'], 'ops.eraseRect', { x: 0, y: 0, width: 2, height: 2 }],
    [
      'erase',
      { pixels: [{ x: 0, y: 0 }], rect: { x: 1, y: 1, width: 1, height: 1 } },
      'ops.erasePixelsAndRect',
      { count: 1, x: 1, y: 1, width: 1, height: 1 }
    ],
    [
      'replace_color',
      VALID['replace_color'],
      'ops.replaceColor',
      { from: '#ff0000', to: '#00ff00', tolerance: 0 }
    ],
    ['apply_palette', VALID['apply_palette'], 'ops.applyPalette', { count: 2 }],
    [
      'apply_palette',
      { palette: ['#000000'], region: { x: 0, y: 0, width: 2, height: 2 } },
      'ops.applyPaletteRegion',
      { count: 1, x: 0, y: 0, width: 2, height: 2 }
    ],
    ['hue_shift', { degrees: 120 }, 'ops.hueShift', { degrees: '+120' }],
    [
      'hue_shift',
      { degrees: -30, region: { x: 1, y: 1, width: 2, height: 2 } },
      'ops.hueShiftRegion',
      { degrees: '-30', x: 1, y: 1, width: 2, height: 2 }
    ],
    ['saturation', { delta: -0.5 }, 'ops.saturation', { percent: '-50' }],
    [
      'brightness',
      VALID['brightness'],
      'ops.brightnessRegion',
      { percent: '+20', x: 0, y: 0, width: 2, height: 2 }
    ],
    ['brightness', { delta: 0 }, 'ops.brightness', { percent: '0' }],
    ['outline', VALID['outline'], 'ops.outline', { color: '#000000', mode: 'outside' }],
    ['get_pixels', {}, 'ops.getPixels', {}],
    [
      'get_pixels',
      { rect: { x: 0, y: 0, width: 4, height: 4 } },
      'ops.getPixelsRect',
      { x: 0, y: 0, width: 4, height: 4 }
    ],
    ['get_palette', {}, 'ops.getPalette', {}],
    ['get_texture', VALID['get_texture'], 'ops.getTexture', { source: 'vanilla' }],
    ['read_style_brief', {}, 'ops.readStyleBrief', {}],
    [
      'update_style_brief',
      { patch: { theme: 'x', rules: [] } },
      'ops.updateStyleBrief',
      { fields: 'theme, rules' }
    ]
  ]

  it.each(cases)('%s %j -> %s', (name, args, key, params) => {
    const tool = getTool(name)!
    expect(tool.describe(tool.params.parse(args))).toEqual({ key, params })
  })
})

describe('transform tools', () => {
  const base = img(['rg', 'bw', '..'])

  it('rotate 90 counterclockwise and clockwise', () => {
    expect(
      rows(run('rotate', base, { degrees: 90, direction: 'counterclockwise' }).image!)
    ).toEqual(['gw.', 'rb.'])
    expect(rows(run('rotate', base, { degrees: 90, direction: 'clockwise' }).image!)).toEqual([
      '.br',
      '.wg'
    ])
    expect(rows(run('rotate', base, { degrees: 180 }).image!)).toEqual(['..', 'wb', 'gr'])
  })

  it('flip', () => {
    expect(rows(run('flip', base, { axis: 'horizontal' }).image!)).toEqual(['gr', 'wb', '..'])
    expect(rows(run('flip', base, { axis: 'vertical' }).image!)).toEqual(['..', 'bw', 'rg'])
  })

  it('shift with and without wrap', () => {
    expect(rows(run('shift', base, { dx: 1, dy: 0 }).image!)).toEqual(['gr', 'wb', '..'])
    expect(rows(run('shift', base, { dx: 0, dy: 1, wrap: false }).image!)).toEqual([
      '..',
      'rg',
      'bw'
    ])
  })

  it('resize nearest-neighbor', () => {
    const out = run('resize', img(['rg']), { width: 4, height: 2 })
    expect(rows(out.image!)).toEqual(['rrgg', 'rrgg'])
    expect(out.result).toEqual({ width: 4, height: 2 })
  })
})

describe('drawing tools', () => {
  const blank = (): RgbaImage => img(['....', '....', '....', '....'])

  it('set_pixels sets and skips out-of-bounds', () => {
    const out = run('set_pixels', blank(), {
      pixels: [
        { x: 0, y: 0, color: '#ff0000' },
        { x: 3, y: 3, color: '#0000ffff' },
        { x: 9, y: 0, color: '#ff0000' }
      ]
    })
    expect(rows(out.image!)).toEqual(['r...', '....', '....', '...b'])
    expect(out.result).toEqual({ set: 2, skipped: 1 })
  })

  it('set_pixels supports semi-transparent colors', () => {
    const out = run('set_pixels', blank(), { pixels: [{ x: 1, y: 1, color: '#ff000080' }] })
    expect(getPixel(out.image!, 1, 1)).toEqual([255, 0, 0, 128])
  })

  it('draw_line', () => {
    const out = run('draw_line', blank(), { x1: 0, y1: 0, x2: 3, y2: 3, color: '#ff0000' })
    expect(rows(out.image!)).toEqual(['r...', '.r..', '..r.', '...r'])
  })

  it('draw_rect and fill_rect', () => {
    expect(
      rows(run('draw_rect', blank(), { x: 0, y: 0, width: 4, height: 3, color: '#00ff00' }).image!)
    ).toEqual(['gggg', 'g..g', 'gggg', '....'])
    expect(
      rows(run('fill_rect', blank(), { x: 1, y: 1, width: 2, height: 9, color: '#0000ff' }).image!)
    ).toEqual(['....', '.bb.', '.bb.', '.bb.'])
  })

  it('fill contiguous and global', () => {
    const src = img(['r.r.', 'rrr.', '....', '.r..'])
    const c = run('fill', src, { x: 3, y: 0, color: '#0000ff' })
    expect(rows(c.image!)).toEqual(['r.rb', 'rrrb', 'bbbb', 'brbb'])
    expect(c.result).toEqual({ changed: 9 })
    const g = run('fill', src, { x: 0, y: 0, color: '#00ff00', contiguous: false })
    expect(rows(g.image!)).toEqual(['g.g.', 'ggg.', '....', '.g..'])
  })

  it('fill with tolerance', () => {
    const src = img(['ab'], { a: [100, 0, 0, 255], b: [110, 0, 0, 255] })
    const out = run('fill', src, { x: 0, y: 0, color: '#ffffff', tolerance: 10 })
    expect(rows(out.image!)).toEqual(['ww'])
  })

  it('erase pixels and rect', () => {
    const src = img(['rrrr', 'rrrr'])
    const out = run('erase', src, {
      pixels: [{ x: 3, y: 0 }],
      rect: { x: 0, y: 1, width: 2, height: 1 }
    })
    expect(rows(out.image!)).toEqual(['rrr.', '..rr'])
    expect(out.result).toEqual({ changed: true })
  })
})

describe('color tools', () => {
  it('replace_color with tolerance', () => {
    const src = img(['abg'], { a: [200, 0, 0, 255], b: [190, 0, 0, 255], g: G })
    const exact = run('replace_color', src, { from: '#c80000', to: '#0000ff' })
    expect(exact.result).toEqual({ changed: 1 })
    const near = run('replace_color', src, { from: '#c80000', to: '#0000ff', tolerance: 10 })
    expect(rows(near.image!)).toEqual(['bbg'])
  })

  it('apply_palette maps to nearest and respects region', () => {
    const src = img(['ab', 'ab'], { a: [250, 10, 10, 255], b: [10, 10, 240, 255] })
    const out = run('apply_palette', src, {
      palette: ['#ff0000', '#0000ff'],
      region: { x: 0, y: 0, width: 2, height: 1 }
    })
    expect(toHex(getPixel(out.image!, 0, 0))).toBe('#ff0000ff')
    expect(toHex(getPixel(out.image!, 1, 0))).toBe('#0000ffff')
    expect(toHex(getPixel(out.image!, 0, 1))).toBe('#fa0a0aff')
    expect(out.result).toEqual({ changed: 2 })
  })

  it('hue_shift: red +120 = green, region limited', () => {
    const out = run('hue_shift', img(['rr']), {
      degrees: 120,
      region: { x: 1, y: 0, width: 1, height: 1 }
    })
    expect(rows(out.image!)).toEqual(['rg'])
  })

  it('saturation -1 = gray', () => {
    const out = run('saturation', img(['r']), { delta: -1 })
    const [r, g, b] = getPixel(out.image!, 0, 0)
    expect(r).toBe(g)
    expect(g).toBe(b)
  })

  it('brightness +1 = white, -1 = black', () => {
    expect(rows(run('brightness', img(['r']), { delta: 1 }).image!)).toEqual(['w'])
    expect(toHex(getPixel(run('brightness', img(['r']), { delta: -1 }).image!, 0, 0))).toBe(
      '#000000ff'
    )
  })

  it('outline inside and outside', () => {
    const src = img(['....', '.rr.', '.rr.', '....'])
    expect(rows(run('outline', src, { color: '#0000ff', mode: 'outside' }).image!)).toEqual([
      '.bb.',
      'brrb',
      'brrb',
      '.bb.'
    ])
    expect(rows(run('outline', src, { color: '#0000ff', mode: 'inside' }).image!)).toEqual([
      '....',
      '.bb.',
      '.bb.',
      '....'
    ])
  })
})

describe('read and memory tools', () => {
  const src = img(['rg', 'r.'])

  it('get_pixels returns the palette grid, whole or rect', () => {
    const all = run('get_pixels', src, {})
    expect(all.image).toBeUndefined()
    expect(all.result).toEqual({
      w: 2,
      h: 2,
      origin: 'top-left',
      palette: { '.': '#00000000', a: '#ff0000ff', b: '#00ff00ff' },
      rows: ['ab', 'a.']
    })
    expect(run('get_pixels', src, { rect: { x: 1, y: 0, width: 5, height: 1 } }).result).toEqual({
      w: 1,
      h: 1,
      x: 1,
      y: 0,
      origin: 'top-left',
      palette: { '.': '#00000000', a: '#00ff00ff' },
      rows: ['a']
    })
  })

  it('get_pixels errors outside the texture or when too large', () => {
    expect(() => run('get_pixels', src, { rect: { x: 5, y: 5, width: 1, height: 1 } })).toThrow(
      ToolError
    )
    expect(() => run('get_pixels', createImage(256, 256), {})).toThrow(/at most/)
  })

  it('get_palette counts colors and transparency', () => {
    expect(run('get_palette', src, {}).result).toEqual({
      colors: [
        { hex: '#ff0000ff', count: 2 },
        { hex: '#00ff00ff', count: 1 }
      ],
      transparent: 1
    })
  })

  it('get_texture returns the vanilla grid or an explanatory error', () => {
    const vanilla = img(['bb'])
    expect(run('get_texture', src, { source: 'vanilla' }, vanilla).result).toMatchObject({
      w: 2,
      h: 1,
      rows: ['aa']
    })
    expect(() => run('get_texture', src, { source: 'vanilla' }, null)).toThrow(/no vanilla/)
  })

  it('read_style_brief returns the draft brief', () => {
    expect(run('read_style_brief', src, {}).result).toEqual(emptyBrief())
  })

  it('update_style_brief does not change the image and reports a proposal', () => {
    const out = run('update_style_brief', src, { patch: { theme: 'Dark' } })
    expect(out.image).toBeUndefined()
    expect(out.result).toMatchObject({ proposed: true })
  })
})
