import { describe, expect, it, vi } from 'vitest'
import { createImage, decodePng, getPixel, toHex } from '@shared/image'
import { emptyBrief } from '@shared/model/brief'
import type { TextureEntry } from '@shared/model/pack'
import type { AgentEvent, AgentSettings, CreationAgentRequest } from '@shared/ai/types'
import { DONE_END, DONE_TOOLS, fakeProvider, seqIds, text, toolCall } from './ai-agent-fakes'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

const {
  buildCreationMessage,
  creationTools,
  matchTextures,
  pickSamples,
  runCreationAgent,
  MAX_PLAN_STEPS,
  SAMPLES_PER_CATEGORY
} = await import('../../src/main/services/ai/agent/creation')
const { buildSystemPrompt } = await import('../../src/main/services/ai/agent/prompts')

function entry(
  folder: string,
  name: string,
  categories: string[],
  extra: Partial<TextureEntry> = {}
): TextureEntry {
  return {
    path: `assets/minecraft/textures/${folder}/${name}.png`,
    namespace: 'minecraft',
    folder,
    name,
    width: 16,
    height: 16,
    animated: false,
    status: 'vanilla',
    categories,
    url: '',
    ...extra
  }
}

const TEXTURES: TextureEntry[] = [
  entry('block', 'stone', ['blocks']),
  entry('block', 'iron_ore', ['blocks', 'ores']),
  entry('block', 'gold_ore', ['blocks', 'ores'], { status: 'modified' }),
  entry('block', 'oak_planks', ['blocks']),
  entry('item', 'iron_pickaxe', ['tools']),
  entry('item', 'diamond_sword', ['weapons']),
  entry('entity/zombie', 'zombie', ['entities'], { width: 64, height: 64 }),
  entry('gui', 'widgets', ['gui'], { width: 256, height: 256 })
]

const GRAY: [number, number, number, number] = [120, 120, 120, 255]
const SAMPLES = TEXTURES.filter((t) => t.width <= 64).map((t) => ({
  path: t.path,
  image: createImage(16, 16, t.name === 'iron_ore' ? [150, 120, 100, 255] : GRAY)
}))

const SETTINGS: AgentSettings = { thinking: 'off', maxIterations: 8, imageMode: 'vision+grid' }

function request(message = 'fais un pack de feu'): CreationAgentRequest {
  return { packId: 'p1', message, model: { providerId: 'fake', modelId: 'm1' }, language: 'fr' }
}

const names = (list: TextureEntry[]): string[] => list.map((t) => t.name)

describe('creation scope', () => {
  it('offers apply_to_all, list_textures, set_pack_meta and update_style_brief only', () => {
    const tools = creationTools()
    expect(tools.map((t) => t.name)).toEqual([
      'apply_to_all',
      'list_textures',
      'set_pack_meta',
      'update_style_brief'
    ])
    const apply = JSON.stringify(tools[0]!.spec.parameters)
    // The operation is one of the bulk (color / transform) tools, never a drawing tool.
    expect(apply).toContain('hue_shift')
    expect(apply).not.toContain('set_pixels')
    expect(apply).toContain('"filter"')
  })

  it('matches textures by category, folder (with subfolders) and name glob, all together', () => {
    expect(names(matchTextures(TEXTURES, {}))).toHaveLength(TEXTURES.length)
    expect(names(matchTextures(TEXTURES, { categories: ['ores'] }))).toEqual([
      'iron_ore',
      'gold_ore'
    ])
    expect(names(matchTextures(TEXTURES, { categories: ['tools', 'weapons'] }))).toEqual([
      'iron_pickaxe',
      'diamond_sword'
    ])
    expect(names(matchTextures(TEXTURES, { folders: ['entity'] }))).toEqual(['zombie'])
    expect(names(matchTextures(TEXTURES, { folders: ['/item/'] }))).toEqual([
      'iron_pickaxe',
      'diamond_sword'
    ])
    expect(names(matchTextures(TEXTURES, { match: 'iron_*' }))).toEqual([
      'iron_ore',
      'iron_pickaxe'
    ])
    expect(names(matchTextures(TEXTURES, { match: 'block/*_ore' }))).toEqual([
      'iron_ore',
      'gold_ore'
    ])
    expect(names(matchTextures(TEXTURES, { categories: ['blocks'], match: 'iron_*' }))).toEqual([
      'iron_ore'
    ])
    expect(matchTextures(TEXTURES, { categories: ['nope'] })).toEqual([])
  })

  it('picks representative textures per category, modified first, skipping large ones', () => {
    const picked = pickSamples(TEXTURES)
    expect(names(picked)).not.toContain('widgets')
    expect(names(picked)[0]).toBe('gold_ore')
    const many = Array.from({ length: 10 }, (_, i) => entry('block', `b${i}`, ['blocks']))
    expect(pickSamples(many)).toHaveLength(SAMPLES_PER_CATEGORY)
    expect(pickSamples(TEXTURES, 2)).toHaveLength(2)
  })

  it('describes the pack, its categories and samples, with a contact sheet for vision models', () => {
    const pack = { name: 'Fire', description: 'Hot' }
    const msg = buildCreationMessage({ textures: TEXTURES, samples: SAMPLES, pack }, 'feu', true)
    expect(msg.text).toContain('[Pack: "Fire" - Hot]')
    expect(msg.text).toContain('8 textures, 1 already modified or added.')
    expect(msg.text).toContain('- blocks: 4, 1 modified')
    expect(msg.text).toContain('- ores: 2, 1 modified')
    expect(msg.text).toContain('#2 block/iron_ore 16x16: #967864ff')
    expect(msg.text).toContain('User request:\nfeu')
    expect(msg.images).toHaveLength(1)
    expect(
      buildCreationMessage({ textures: TEXTURES, samples: SAMPLES, pack }, 'feu', false).images
    ).toBeUndefined()
  })

  it('shows the label of custom categories next to their id', () => {
    const textures = [...TEXTURES, entry('item', 'fire_sword', ['weapons', 'fire_gear'])]
    const msg = buildCreationMessage(
      {
        textures,
        samples: SAMPLES,
        pack: { name: 'Fire', description: '' },
        categoryLabels: { fire_gear: 'Fire "gear"' }
      },
      'feu',
      false
    )
    expect(msg.text).toContain('- fire_gear ("Fire \\"gear\\"", custom): 1')
    expect(msg.text).toContain('- weapons: 2')
  })

  it('system prompt states the pack size and asks for a brief, then category steps', () => {
    const prompt = buildSystemPrompt({
      agent: 'creation',
      language: 'fr',
      brief: emptyBrief(),
      pack: { count: 1234 }
    })
    expect(prompt).toContain('whole pack (1234 textures)')
    expect(prompt).toContain('update_style_brief')
    expect(prompt).toContain('apply_to_all')
    expect(prompt).toContain('Reply in French')
  })
})

describe('runCreationAgent', () => {
  async function run(
    scripts: Parameters<typeof fakeProvider>[0],
    vision = false
  ): Promise<{
    result: Awaited<ReturnType<typeof runCreationAgent>>
    events: AgentEvent[]
    fake: ReturnType<typeof fakeProvider>
  }> {
    const fake = fakeProvider(scripts, { vision })
    const events: AgentEvent[] = []
    const result = await runCreationAgent(
      {
        runId: 'r1',
        request: request(),
        textures: TEXTURES,
        samples: SAMPLES,
        pack: { name: 'Pack', description: '' },
        settings: SETTINGS,
        brief: emptyBrief(),
        history: []
      },
      { providers: fake.providers, newId: seqIds(), now: () => new Date('2026-11-16T10:00:00Z') },
      (e) => events.push(e),
      new AbortController().signal
    )
    return { result, events, fake }
  }

  it('builds a plan: brief, category steps with scope and samples, and pack meta', async () => {
    const { result, fake } = await run([
      [
        toolCall('update_style_brief', {
          patch: { theme: 'Fire', palette: [{ hex: '#ff6a00', role: 'flames' }] }
        }),
        DONE_TOOLS
      ],
      [
        toolCall('apply_to_all', {
          operation: { tool: 'replace_color', args: { from: '#787878', to: '#c00000' } },
          filter: { categories: ['blocks'] }
        }),
        DONE_TOOLS
      ],
      [
        toolCall('apply_to_all', {
          operation: { tool: 'brightness', args: { delta: -0.2 } },
          filter: { categories: ['ores'] }
        }),
        toolCall('set_pack_meta', { name: 'Fire Pack', description: 'Volcanic' }),
        DONE_TOOLS
      ],
      [text('Voici le plan.'), DONE_END]
    ])
    expect(result.reason).toBe('end')
    expect(result.steps.map((s) => [s.tool, s.kind])).toEqual([
      ['update_style_brief', 'memory'],
      ['replace_color', 'mutate'],
      ['brightness', 'mutate'],
      ['set_pack_meta', 'memory']
    ])
    const blocks = result.steps[1]!
    expect(blocks.targets).toHaveLength(4)
    expect(blocks.scope).toEqual({
      categories: ['blocks'],
      count: 4,
      byCategory: { blocks: 4, ores: 2 }
    })
    expect(blocks.args).toMatchObject({ from: '#787878', to: '#c00000' })
    // Samples: stone, gold_ore and oak_planks turned red (iron_ore has another color).
    expect(blocks.samples!.map((s) => s.name)).toEqual(['stone', 'gold_ore', 'oak_planks'])
    expect(toHex(getPixel(decodePng(blocks.samples![0]!.afterPng), 0, 0))).toBe('#c00000ff')
    // The second step previews on top of the first one: gold_ore was red before getting darker.
    const ores = result.steps[2]!
    expect(ores.dependsOn).toEqual([blocks.id])
    expect(toHex(getPixel(decodePng(ores.samples![1]!.beforePng), 0, 0))).toBe('#c00000ff')
    expect(result.steps[3]!.packMeta).toEqual({ name: 'Fire Pack', description: 'Volcanic' })
    expect(result.steps[0]!.briefPatch).toMatchObject({ theme: 'Fire' })
    // The model gets the match count per category.
    const toolResult = fake.requests[2]!.messages.filter((m) => m.role === 'tool').at(-1)!
    expect(JSON.parse(toolResult.text!)).toMatchObject({
      ok: true,
      result: { matched: 4, byCategory: { blocks: 4, ores: 2 }, previewed: 3 }
    })
  })

  it('reports filters that match nothing, invalid operation args and lists textures', async () => {
    const { result, fake } = await run([
      [
        toolCall('apply_to_all', {
          operation: { tool: 'hue_shift', args: { degrees: 30 } },
          filter: { categories: ['nope'] }
        }),
        toolCall('apply_to_all', {
          operation: { tool: 'hue_shift', args: { degrees: 999 } },
          filter: {}
        }),
        toolCall('apply_to_all', { operation: { tool: 'set_pixels', args: {} } }),
        toolCall('list_textures', { filter: { match: '*_ore' }, limit: 1 }),
        toolCall('set_pack_meta', {}),
        DONE_TOOLS
      ],
      [text('ok'), DONE_END]
    ])
    expect(result.steps).toEqual([])
    const results = fake.requests[1]!.messages.filter((m) => m.role === 'tool').map(
      (m) => JSON.parse(m.text!) as { ok: boolean; error?: string; result?: unknown }
    )
    expect(results[0]).toMatchObject({ ok: false, error: expect.stringContaining('No texture') })
    expect(results[1]).toMatchObject({ ok: false, error: expect.stringContaining('hue_shift') })
    expect(results[2]).toMatchObject({
      ok: false,
      error: expect.stringContaining('operation.tool')
    })
    expect(results[3]).toMatchObject({
      ok: true,
      result: { count: 2, textures: ['block/iron_ore 16x16'], more: 1 }
    })
    expect(results[4]).toMatchObject({ ok: false })
  })

  it('caps the number of steps and shows vision models the samples after a step', async () => {
    const step = toolCall('apply_to_all', {
      operation: { tool: 'hue_shift', args: { degrees: 10 } },
      filter: { categories: ['ores'] }
    })
    const { result, fake } = await run(
      [
        [...Array.from({ length: MAX_PLAN_STEPS + 1 }, () => step), DONE_TOOLS],
        [text('ok'), DONE_END]
      ],
      true
    )
    expect(result.steps).toHaveLength(MAX_PLAN_STEPS)
    // The first request carries the contact sheet; later ones only the latest image (the note's).
    expect(fake.requests[0]!.messages[1]!.images).toHaveLength(1)
    const note = fake.requests[1]!.messages.at(-1)!
    expect(note.text).toContain('[App note] Representative textures after your last step')
    expect(note.images).toHaveLength(1)
  })
})
