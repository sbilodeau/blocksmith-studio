import { describe, expect, it, vi } from 'vitest'
import { createImage, decodePng, getPixel, setPixel, type RgbaImage } from '@shared/image'
import { encodeGrid } from '@shared/ai/tools'
import { emptyBrief } from '@shared/model/brief'
import type { ConversationTurn, ModelInfo } from '@shared/ai/types'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

const { buildSystemPrompt } = await import('../../src/main/services/ai/agent/prompts')
const { renderUpscaled, GLYPH_H } = await import('../../src/main/services/ai/agent/render')
const { buildUserMessage, historyMessages, latestImageOnly, planImages, sendsGrid, textureState } =
  await import('../../src/main/services/ai/agent/context')

function model(vision?: boolean): ModelInfo {
  return {
    id: 'm',
    providerId: 'p',
    label: 'm',
    capabilities: vision === undefined ? {} : { vision }
  }
}

describe('system prompt', () => {
  const brief = { ...emptyBrief(), theme: 'Dark medieval', rules: ['No pink'] }

  it('contains the conventions, the brief and the language', () => {
    const prompt = buildSystemPrompt({
      agent: 'editor',
      language: 'fr',
      brief,
      texture: { width: 16, height: 32 }
    })
    expect(prompt).toContain('TOP-LEFT')
    expect(prompt).toContain('x grows to the right, y grows downward')
    expect(prompt).toContain('"left"/"à gauche"/"anti-horaire" = counterclockwise')
    expect(prompt).toContain('"horizontal" mirrors left<->right')
    expect(prompt).toContain('#00000000')
    expect(prompt).toContain('Reply in French. If the user writes in another language')
    expect(prompt).toContain('"theme":"Dark medieval"')
    expect(prompt).toContain('"rules":["No pink"]')
    expect(prompt).toContain('Your scope is the open texture 16 x 32')
    expect(prompt).not.toContain('{{')
  })

  it('uses English for en', () => {
    expect(buildSystemPrompt({ agent: 'editor', language: 'en', brief })).toContain(
      'Reply in English.'
    )
  })
})

describe('grid encoding', () => {
  it('maps colors to palette chars by frequency and transparency to "."', () => {
    const img = createImage(3, 2)
    setPixel(img, 0, 0, [255, 0, 0, 255])
    setPixel(img, 1, 0, [255, 0, 0, 255])
    setPixel(img, 2, 0, [0, 0, 255, 128])
    // Hidden RGB under alpha 0 is still transparent.
    setPixel(img, 0, 1, [9, 9, 9, 0])
    expect(encodeGrid(img)).toEqual({
      w: 3,
      h: 2,
      origin: 'top-left',
      palette: { '.': '#00000000', a: '#ff0000ff', b: '#0000ff80' },
      rows: ['aab', '...']
    })
  })

  it('falls back to rows of hex arrays above 62 colors', () => {
    const img = createImage(8, 8)
    for (let i = 0; i < 63; i++) setPixel(img, i % 8, Math.floor(i / 8), [i, 0, 0, 255])
    const grid = encodeGrid(img)
    expect(grid.palette).toBeUndefined()
    expect(grid.rows[0]).toEqual([
      '#000000ff',
      '#010000ff',
      '#020000ff',
      '#030000ff',
      '#040000ff',
      '#050000ff',
      '#060000ff',
      '#070000ff'
    ])
    expect((grid.rows[7] as string[])[7]).toBe('#00000000')
  })

  it('uses up to 62 palette chars', () => {
    const img = createImage(62, 1)
    for (let i = 0; i < 62; i++) setPixel(img, i, 0, [i, 1, 0, 255])
    const grid = encodeGrid(img)
    expect(Object.keys(grid.palette!)).toHaveLength(63)
    expect((grid.rows[0] as string).length).toBe(62)
  })
})

describe('upscaled image', () => {
  function checker16(): RgbaImage {
    const img = createImage(16, 16, [100, 150, 200, 255])
    setPixel(img, 5, 5, [0, 0, 0, 0])
    return img
  }

  it('scales to about 512 px with label margins', () => {
    const up = renderUpscaled(checker16())
    expect(up.scale).toBe(32)
    expect(up.fontScale).toBe(2)
    expect(up.labelStep).toBe(1)
    expect(up.image.width).toBe(up.offsetX + 512)
    expect(up.image.height).toBe(up.offsetY + 512)
    expect(up.offsetX).toBeGreaterThan(0)
    expect(up.offsetY).toBeGreaterThanOrEqual(GLYPH_H * 2)
  })

  it('draws axis labels in the margin', () => {
    const up = renderUpscaled(checker16())
    const ink = (x0: number, y0: number, x1: number, y1: number): number => {
      let n = 0
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) if (getPixel(up.image, x, y)[0] === 32) n++
      return n
    }
    // Column 0 label "0" above the first column, column 15 label above the last one.
    expect(ink(up.offsetX, 0, up.offsetX + up.scale, up.offsetY)).toBeGreaterThan(0)
    expect(
      ink(up.offsetX + 15 * up.scale, 0, up.offsetX + 16 * up.scale, up.offsetY)
    ).toBeGreaterThan(0)
    // Row labels in the left margin.
    expect(ink(0, up.offsetY, up.offsetX, up.offsetY + up.scale)).toBeGreaterThan(0)
    // The "0" glyph has a hole in the middle: 2 x 3 ink rows of the 3x5 font scaled by 2 = 12 + 12 + ... pixels.
    expect(ink(up.offsetX, 0, up.offsetX + up.scale, up.offsetY)).toBe(12 * 4)
    // The corner of the margin stays blank.
    expect(getPixel(up.image, 0, 0)).toEqual([255, 255, 255, 255])
  })

  it('draws transparent pixels on a checkerboard and keeps opaque colors', () => {
    const up = renderUpscaled(checker16(), { grid: false })
    const cell = (tx: number, ty: number, dx: number, dy: number): readonly number[] =>
      getPixel(up.image, up.offsetX + tx * up.scale + dx, up.offsetY + ty * up.scale + dy)
    expect(cell(0, 0, 3, 3)).toEqual([100, 150, 200, 255])
    const a = cell(5, 5, 1, 1)
    const b = cell(5, 5, 17, 1)
    expect(a).not.toEqual(b)
    expect([a[0], b[0]].sort()).toEqual([200, 255])
  })

  it('draws grid lines at pixel boundaries', () => {
    const up = renderUpscaled(checker16())
    expect(getPixel(up.image, up.offsetX + 32, up.offsetY + 3)).toEqual([65, 98, 130, 255])
    expect(getPixel(up.image, up.offsetX + 33, up.offsetY + 3)).toEqual([100, 150, 200, 255])
  })

  it('labels every n-th column when cells are small', () => {
    const up = renderUpscaled(createImage(128, 128, [0, 0, 0, 255]))
    expect(up.scale).toBe(4)
    expect(up.labelStep).toBe(4)
    expect(up.image.width).toBe(up.offsetX + 512)
  })

  it('encodes to a PNG in the user message for vision models', () => {
    const msg = buildUserMessage(
      'rotate it',
      'assets/minecraft/textures/block/stone.png',
      checker16(),
      planImages(model(true), 'vision+grid')
    )
    expect(msg.images).toHaveLength(1)
    expect(decodePng(msg.images![0]).width).toBeGreaterThan(512)
    expect(msg.text).toContain(
      '[Open texture: assets/minecraft/textures/block/stone.png (16 x 16 px)]'
    )
    expect(msg.text).toContain('"origin":"top-left"')
    expect(msg.text).toContain('User request:\nrotate it')
  })
})

describe('image strategy', () => {
  it('grid only without (or with unknown) vision', () => {
    expect(planImages(undefined, 'vision+grid')).toEqual({
      vision: false,
      image: false,
      grid: true
    })
    expect(planImages(model(), 'image')).toEqual({ vision: false, image: false, grid: true })
    expect(planImages(model(false), 'vision+grid').image).toBe(false)
  })

  it('follows the image mode for vision models', () => {
    expect(planImages(model(true), 'vision+grid')).toEqual({
      vision: true,
      image: true,
      grid: true
    })
    expect(planImages(model(true), 'grid')).toEqual({ vision: true, image: false, grid: true })
    expect(planImages(model(true), 'image')).toEqual({ vision: true, image: true, grid: false })
  })

  it('large textures send the image plus a get_pixels note instead of the grid', () => {
    const big = createImage(128, 128, [1, 2, 3, 255])
    const plan = planImages(model(true), 'vision+grid')
    expect(sendsGrid(big, plan)).toBe(false)
    const state = textureState(big, plan)
    expect(state.grid).toBeUndefined()
    expect(state.png).toBeDefined()
    expect(state.text).toContain('get_pixels with a rect')
    // Without vision a 128x128 grid is still sent; 256x256 is not.
    expect(sendsGrid(big, planImages(undefined, 'grid'))).toBe(true)
    expect(sendsGrid(createImage(256, 256), planImages(undefined, 'grid'))).toBe(false)
  })

  it('image mode sends no grid', () => {
    const state = textureState(createImage(16, 16), planImages(model(true), 'image'))
    expect(state.grid).toBeUndefined()
    expect(state.png).toBeDefined()
  })
})

describe('conversation history', () => {
  const turn = (i: number, role: ConversationTurn['role'], extra = {}): ConversationTurn => ({
    id: `t${i}`,
    at: '2026-01-01T00:00:00Z',
    role,
    ...extra
  })

  it('converts turns and drops tool results', () => {
    const msgs = historyMessages([
      turn(1, 'user', { text: 'rotate', texturePath: 'assets/minecraft/textures/block/a.png' }),
      turn(2, 'assistant', { text: 'Done.', toolCalls: [{ id: 'c', name: 'rotate', args: {} }] }),
      turn(3, 'tool', { toolResult: { callId: 'c', ok: true, summary: 'Rotated' } }),
      turn(4, 'tool', { proposalId: 'p1', text: 'The user applied 1 of 1 steps' })
    ])
    expect(msgs).toEqual([
      { role: 'user', text: '[Texture: assets/minecraft/textures/block/a.png] rotate' },
      { role: 'assistant', text: 'Done.\n(Tools called: rotate)' },
      { role: 'user', text: '[App note] The user applied 1 of 1 steps' }
    ])
  })

  it('keeps the newest turns within the budget and summarizes the rest', () => {
    const turns = Array.from({ length: 20 }, (_, i) =>
      turn(i, i % 2 ? 'assistant' : 'user', { text: `message ${i} ${'x'.repeat(400)}` })
    )
    const msgs = historyMessages(turns, { budgetTokens: 600 })
    expect(msgs[0].text).toMatch(/^\[App note\] 15 earlier message\(s\) omitted/)
    expect(msgs[0].text).toContain('"message 14')
    expect(msgs.slice(1).map((m) => m.text!.split(' ')[1])).toEqual(['15', '16', '17', '18', '19'])
  })

  it('respects maxTurns', () => {
    const turns = Array.from({ length: 10 }, (_, i) => turn(i, 'user', { text: `m${i}` }))
    const msgs = historyMessages(turns, { maxTurns: 3 })
    expect(msgs).toHaveLength(4)
    expect(msgs.at(-1)!.text).toBe('m9')
  })

  it('only the latest image is ever sent', () => {
    const png = new Uint8Array([1])
    const out = latestImageOnly([
      { role: 'user', text: 'a', images: [png] },
      { role: 'tool', text: 'b' },
      { role: 'user', text: 'c', images: [png] }
    ])
    expect(out[0].images).toBeUndefined()
    expect(out[2].images).toEqual([png])
  })
})
