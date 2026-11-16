import { describe, expect, it, vi } from 'vitest'
import { createImage, decodePng, getPixel, setPixel, toHex } from '@shared/image'
import { emptyBrief } from '@shared/model/brief'
import type { AgentEvent, AgentSettings, NavigationAgentRequest } from '@shared/ai/types'
import { DONE_END, DONE_TOOLS, fakeProvider, seqIds, text, toolCall } from './ai-agent-fakes'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

const {
  buildNavigationMessage,
  navigationTools,
  replayTargets,
  resolveTargets,
  runNavigationAgent,
  MAX_LISTED_TEXTURES
} = await import('../../src/main/services/ai/agent/navigation')
const { renderContactSheet, contactSheetPngs, TILE, TILES_PER_SHEET, MAX_SHEETS } =
  await import('../../src/main/services/ai/agent/contact-sheet')
const { buildSystemPrompt } = await import('../../src/main/services/ai/agent/prompts')

const T = (
  name: string,
  color: [number, number, number, number] = [120, 120, 120, 255]
): { path: string; image: ReturnType<typeof createImage> } => ({
  path: `assets/minecraft/textures/block/${name}.png`,
  image: createImage(16, 16, color)
})

const SELECTION = [T('stone'), T('iron_ore', [150, 120, 100, 255]), T('gold_ore'), T('oak_planks')]

const SETTINGS: AgentSettings = { thinking: 'off', maxIterations: 6, imageMode: 'vision+grid' }

function request(message = 'mets tout plus rouge'): NavigationAgentRequest {
  return {
    packId: 'p1',
    message,
    model: { providerId: 'fake', modelId: 'm1' },
    paths: SELECTION.map((t) => t.path),
    language: 'fr'
  }
}

describe('contact sheets', () => {
  it('lays tiles out 6 per row with a label strip, and caps the number of sheets', () => {
    const sheet = renderContactSheet(
      Array.from({ length: 8 }, (_, i) => ({
        index: i + 1,
        image: createImage(16, 16, [255, 0, 0, 255])
      }))
    )
    expect(sheet.width).toBe(6 * (TILE + 4) + 4)
    expect(sheet.height).toBeGreaterThan(2 * TILE)
    // The first tile's picture is red (upscaled 16 -> 64).
    expect(toHex(getPixel(sheet, 4 + 10, 4 + 9 + 10))).toBe('#ff0000ff')
    const many = Array.from({ length: TILES_PER_SHEET * MAX_SHEETS + 5 }, (_, i) => ({
      index: i + 1,
      image: createImage(1, 1, [0, 0, 0, 255])
    }))
    expect(contactSheetPngs(many)).toHaveLength(MAX_SHEETS)
  })

  it('shows only the first frame of animated strips', () => {
    const img = createImage(16, 32, [0, 0, 255, 255])
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) setPixel(img, x, y, [0, 255, 0, 255])
    const sheet = renderContactSheet([{ index: 1, image: img, frameHeight: 16 }])
    expect(toHex(getPixel(sheet, 4 + 32, 4 + 9 + 32))).toBe('#00ff00ff')
  })
})

describe('navigation scope', () => {
  it('extends color and transform tools with a "textures" filter, read tools with an index', () => {
    const tools = Object.fromEntries(navigationTools().map((t) => [t.spec.name, t]))
    expect(tools['hue_shift']!.mode).toBe('bulk')
    expect(JSON.stringify(tools['hue_shift']!.spec.parameters)).toContain('"textures"')
    expect(tools['get_palette']!.mode).toBe('inspect')
    expect((tools['get_palette']!.spec.parameters as { required: string[] }).required).toContain(
      'index'
    )
    expect(tools['update_style_brief']!.mode).toBe('plain')
    // No per-pixel drawing in this scope.
    expect(tools['set_pixels']).toBeUndefined()
    expect(tools['get_texture']).toBeUndefined()
  })

  it('resolves "textures" by number or by glob (name or folder/name)', () => {
    expect(resolveTargets(SELECTION, undefined)).toEqual([0, 1, 2, 3])
    expect(resolveTargets(SELECTION, { indices: [1, 4] })).toEqual([0, 3])
    expect(resolveTargets(SELECTION, { match: '*_ore' })).toEqual([1, 2])
    expect(resolveTargets(SELECTION, { match: 'block/oak_*' })).toEqual([3])
    expect(resolveTargets(SELECTION, { indices: [1], match: '*_ore' })).toEqual([0, 1, 2])
    expect(resolveTargets(SELECTION, { match: 'item/*' })).toEqual([])
  })

  it('lists the selection with numbers and colors, and attaches sheets for vision models', () => {
    const msg = buildNavigationMessage('rouge', SELECTION, {
      vision: true,
      image: true,
      grid: true
    })
    expect(msg.text).toContain('[Selection: 4 textures]')
    expect(msg.text).toContain('#2 block/iron_ore 16x16: #967864ff')
    expect(msg.text).toContain('User request:\nrouge')
    expect(msg.images).toHaveLength(1)
    const noVision = buildNavigationMessage('rouge', SELECTION, {
      vision: false,
      image: false,
      grid: true
    })
    expect(noVision.images).toBeUndefined()
    const big = Array.from({ length: MAX_LISTED_TEXTURES + 3 }, (_, i) => T(`t${i}`))
    expect(
      buildNavigationMessage('x', big, { vision: false, image: false, grid: true }).text
    ).toContain(
      `... and 3 more textures (#${MAX_LISTED_TEXTURES + 1}-#${MAX_LISTED_TEXTURES + 3}): block (3)`
    )
  })

  it('system prompt states the selection size and the scope rules', () => {
    const prompt = buildSystemPrompt({
      agent: 'navigation',
      language: 'en',
      brief: emptyBrief(),
      selection: { count: 42 }
    })
    expect(prompt).toContain('current selection of 42 textures')
    expect(prompt).toContain('applies to EVERY selected texture')
  })

  it('replays accepted steps only on accepted textures, in order', () => {
    const steps = [
      { id: 's1', kind: 'mutate', tool: 'hue_shift', args: { degrees: 10 }, targets: ['a', 'b'] },
      { id: 's2', kind: 'memory', tool: 'update_style_brief', args: {} },
      { id: 's3', kind: 'mutate', tool: 'flip', args: { axis: 'horizontal' }, targets: ['b'] }
    ] as never
    expect(replayTargets(steps, new Set(['s1', 's2', 's3']), new Set(['b']))).toEqual([
      {
        path: 'b',
        ops: [
          { tool: 'hue_shift', args: { degrees: 10 } },
          { tool: 'flip', args: { axis: 'horizontal' } }
        ]
      }
    ])
    expect(replayTargets(steps, new Set(['s3']), new Set(['a', 'b']))).toEqual([
      { path: 'b', ops: [{ tool: 'flip', args: { axis: 'horizontal' } }] }
    ])
  })
})

describe('runNavigationAgent', () => {
  async function run(
    scripts: Parameters<typeof fakeProvider>[0],
    vision = false
  ): Promise<{
    result: Awaited<ReturnType<typeof runNavigationAgent>>
    events: AgentEvent[]
    fake: ReturnType<typeof fakeProvider>
  }> {
    const fake = fakeProvider(scripts, { vision })
    const events: AgentEvent[] = []
    const result = await runNavigationAgent(
      {
        runId: 'r1',
        request: request(),
        textures: SELECTION,
        settings: SETTINGS,
        brief: emptyBrief(),
        history: []
      },
      { providers: fake.providers, newId: seqIds(), now: () => new Date('2026-11-15T10:00:00Z') },
      (e) => events.push(e),
      new AbortController().signal
    )
    return { result, events, fake }
  }

  it('applies a color tool to the whole selection, then to a subset, as two steps', async () => {
    const { result, fake } = await run([
      [toolCall('replace_color', { from: '#787878', to: '#c00000' }), DONE_TOOLS],
      [toolCall('brightness', { delta: -0.2, textures: { match: '*_ore' } }), DONE_TOOLS],
      [text('Fait.'), DONE_END]
    ])
    expect(result.reason).toBe('end')
    expect(result.steps.map((s) => [s.tool, s.targets?.length])).toEqual([
      ['replace_color', 4],
      ['brightness', 2]
    ])
    // replace_color changed stone, gold_ore and oak_planks (iron_ore has another color).
    expect([...result.changed.keys()].map((p) => p.split('/').pop())).toEqual(
      expect.arrayContaining(['stone.png', 'gold_ore.png', 'oak_planks.png', 'iron_ore.png'])
    )
    const stone = result.changed.get(SELECTION[0]!.path)!
    expect(toHex(getPixel(stone, 0, 0))).toBe('#c00000ff')
    // The step args sent to the replay do not include the filter (targets carry it).
    expect(result.steps[1]!.args).toEqual({ delta: -0.2 })
    const toolResult = fake.requests[1]!.messages.find((m) => m.role === 'tool')!
    expect(JSON.parse(toolResult.text!)).toMatchObject({ ok: true, changed: [1, 3, 4] })
  })

  it('reports a filter that matches nothing, and reads one texture by number', async () => {
    const { result, fake } = await run([
      [
        toolCall('flip', { axis: 'horizontal', textures: { match: 'item/*' } }),
        toolCall('get_palette', { index: 2 }),
        DONE_TOOLS
      ],
      [DONE_END]
    ])
    expect(result.steps).toEqual([])
    const tools = fake.requests[1]!.messages.filter((m) => m.role === 'tool').map((m) =>
      JSON.parse(m.text!)
    )
    expect(tools[0]).toMatchObject({ ok: false })
    expect(tools[1]).toMatchObject({ ok: true, texture: 2 })
  })

  it('sends contact sheets to vision models, and the changed textures after a step', async () => {
    const { fake } = await run(
      [
        [toolCall('hue_shift', { degrees: 30, textures: { indices: [2] } }), DONE_TOOLS],
        [DONE_END]
      ],
      true
    )
    const first = fake.requests[0]!.messages.at(-1)!
    expect(first.images).toHaveLength(1)
    const second = fake.requests[1]!.messages
    const note = second.find(
      (m) => m.role === 'user' && m.text?.startsWith('[App note] Textures after')
    )
    expect(note?.text).toContain('#2')
    expect(decodePng(note!.images![0]!).width).toBeGreaterThan(TILE)
  })
})
