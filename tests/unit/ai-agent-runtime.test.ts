import { describe, expect, it, vi } from 'vitest'
import { createImage, decodePng, encodePng, getPixel, setPixel, toHex } from '@shared/image'
import { emptyBrief } from '@shared/model/brief'
import type { AgentEvent, AgentSettings, EditorAgentRequest } from '@shared/ai/types'
import {
  DONE_END,
  DONE_TOOLS,
  fakeProvider,
  seqIds,
  text,
  toolCall,
  type Script
} from './ai-agent-fakes'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

const { runEditorAgent, IMAGE_EVERY_STEPS } =
  await import('../../src/main/services/ai/agent/runtime')
const { AppErrorException } = await import('../../src/main/ipc/registry')

const PATH = 'assets/minecraft/textures/block/stone.png'

/** 2x1: red, green. */
function base(): ReturnType<typeof createImage> {
  const img = createImage(2, 1)
  setPixel(img, 0, 0, [255, 0, 0, 255])
  setPixel(img, 1, 0, [0, 255, 0, 255])
  return img
}

function request(): EditorAgentRequest {
  const img = base()
  return {
    packId: 'p1',
    message: 'tourne de 90° à gauche',
    model: { providerId: 'fake', modelId: 'm1' },
    texture: { path: PATH, png: encodePng(img) },
    language: 'fr'
  }
}

const SETTINGS: AgentSettings = { thinking: false, maxIterations: 6, imageMode: 'vision+grid' }

async function run(
  scripts: Script[],
  opts: {
    settings?: Partial<AgentSettings>
    vision?: boolean
    signal?: AbortSignal
    tokenBudget?: number
    vanilla?: ReturnType<typeof createImage> | null
  } = {}
): Promise<{
  result: Awaited<ReturnType<typeof runEditorAgent>>
  events: AgentEvent[]
  fake: ReturnType<typeof fakeProvider>
}> {
  const fake = fakeProvider(scripts, { vision: opts.vision })
  const events: AgentEvent[] = []
  const result = await runEditorAgent(
    {
      runId: 'r1',
      request: request(),
      base: base(),
      settings: { ...SETTINGS, ...opts.settings },
      brief: emptyBrief(),
      vanilla: opts.vanilla ?? null,
      history: []
    },
    {
      providers: fake.providers,
      newId: seqIds(),
      now: () => new Date('2026-11-15T10:00:00Z'),
      tokenBudget: opts.tokenBudget
    },
    (e) => events.push(e),
    opts.signal ?? new AbortController().signal
  )
  return { result, events, fake }
}

function toolMessages(fake: ReturnType<typeof fakeProvider>, request: number): unknown[] {
  return fake.requests[request].messages
    .filter((m) => m.role === 'tool')
    .map((m) => JSON.parse(m.text!))
}

describe('editor agent runtime', () => {
  it('text-only answer: streams text and usage, no steps', async () => {
    const { result, events, fake } = await run([
      [
        { type: 'thinking', delta: 'hmm' },
        text('Bonjour '),
        text('!'),
        { type: 'usage', inputTokens: 10, outputTokens: 3 },
        DONE_END
      ]
    ])
    expect(result.reason).toBe('end')
    expect(result.steps).toEqual([])
    expect(result.iterations).toBe(1)
    expect(events).toEqual([
      { runId: 'r1', type: 'thinking', delta: 'hmm' },
      { runId: 'r1', type: 'text', delta: 'Bonjour ' },
      { runId: 'r1', type: 'text', delta: '!' },
      { runId: 'r1', type: 'usage', inputTokens: 10, outputTokens: 3 }
    ])
    expect(result.turns).toEqual([
      expect.objectContaining({
        role: 'assistant',
        text: 'Bonjour !',
        thinking: 'hmm',
        usage: { inputTokens: 10, outputTokens: 3 }
      })
    ])
    const req = fake.requests[0]
    expect(req.model).toBe('m1')
    expect(req.messages[0].role).toBe('system')
    expect(req.messages[0].text).toContain('Reply in French')
    expect(req.messages.at(-1)!.text).toContain(`[Open texture: ${PATH} (2 x 1 px)]`)
    expect(req.tools!.map((t) => t.name)).toContain('rotate')
    expect(req.think).toBeUndefined()
  })

  it('rotate then set_pixels across two iterations; the second request has the new grid', async () => {
    const { result, events, fake } = await run([
      [toolCall('rotate', { degrees: 90, direction: 'counterclockwise' }), DONE_TOOLS],
      [toolCall('set_pixels', { pixels: [{ x: 0, y: 1, color: '#0000ff' }] }), DONE_TOOLS],
      [text('Fait.'), DONE_END]
    ])
    expect(result.reason).toBe('end')
    expect(result.iterations).toBe(3)
    // After rotating 2x1 [r g] counterclockwise: 1x2 [g; r].
    expect(toolMessages(fake, 1)).toEqual([
      expect.objectContaining({
        ok: true,
        texture: {
          w: 1,
          h: 2,
          origin: 'top-left',
          palette: { '.': '#00000000', a: '#00ff00ff', b: '#ff0000ff' },
          rows: ['a', 'b']
        }
      })
    ])
    const second = toolMessages(fake, 2)[1] as {
      texture: { rows: string[]; palette: Record<string, string> }
    }
    // Equal counts sort by hex: blue (a) before green (b).
    expect(second.texture.palette).toEqual({ '.': '#00000000', a: '#0000ffff', b: '#00ff00ff' })
    expect(second.texture.rows).toEqual(['b', 'a'])
    expect(result.steps).toHaveLength(2)
    const [s1, s2] = result.steps
    expect(s1).toMatchObject({
      tool: 'rotate',
      kind: 'mutate',
      args: { degrees: 90, direction: 'counterclockwise' },
      description: { key: 'ops.rotate', params: { degrees: 90, direction: 'counterclockwise' } },
      dependsOn: []
    })
    expect(s2.dependsOn).toEqual([s1.id])
    const preview = decodePng(s2.previewPng!)
    expect([preview.width, preview.height]).toEqual([1, 2])
    expect(toHex(getPixel(preview, 0, 1))).toBe('#0000ffff')
    expect(events.filter((e) => e.type === 'tool_call').map((e) => e.iteration)).toEqual([1, 2])
    expect(events.filter((e) => e.type === 'tool_result')).toEqual([
      {
        runId: 'r1',
        type: 'tool_result',
        callId: s1.callId,
        ok: true,
        summary: expect.any(String)
      },
      { runId: 'r1', type: 'tool_result', callId: s2.callId, ok: true, summary: expect.any(String) }
    ])
    // The assistant tool calls are replayed to the model before their results.
    const msgs = fake.requests[1].messages
    expect(msgs.at(-2)).toMatchObject({ role: 'assistant', toolCalls: [{ name: 'rotate' }] })
    expect(msgs.at(-1)).toMatchObject({ role: 'tool', toolCallId: s1.callId, toolName: 'rotate' })
    expect(result.turns.map((t) => t.role)).toEqual([
      'assistant',
      'tool',
      'assistant',
      'tool',
      'assistant'
    ])
  })

  it('invalid args go back to the model as a tool error and create no step', async () => {
    const { result, events, fake } = await run([
      [toolCall('rotate', { degrees: 45 }), DONE_TOOLS],
      [text('Oops'), DONE_END]
    ])
    expect(result.steps).toEqual([])
    const [msg] = toolMessages(fake, 1) as { ok: boolean; error: string }[]
    expect(msg.ok).toBe(false)
    expect(msg.error).toMatch(/^Invalid arguments: degrees/)
    expect(events.find((e) => e.type === 'tool_result')).toMatchObject({ ok: false })
    expect(result.iterations).toBe(2)
  })

  it('unknown tools and tool errors are returned as error results', async () => {
    const { result, fake } = await run([
      [toolCall('teleport', {}), toolCall('get_texture', { source: 'vanilla' }), DONE_TOOLS],
      [DONE_END]
    ])
    const [unknown, noVanilla] = toolMessages(fake, 1) as { ok: boolean; error: string }[]
    expect(unknown.error).toContain('Unknown tool "teleport"')
    expect(noVanilla.error).toContain('no vanilla version')
    expect(result.reason).toBe('end')
  })

  it('accepts JSON-string arguments', async () => {
    const { result } = await run([
      [toolCall('flip', '{"axis":"horizontal"}'), DONE_TOOLS],
      [DONE_END]
    ])
    expect(result.steps[0]).toMatchObject({ tool: 'flip', args: { axis: 'horizontal' } })
  })

  it('stops at the iteration budget; the draft so far becomes the steps', async () => {
    const { result, fake } = await run(
      [
        [toolCall('flip', { axis: 'vertical' }), DONE_TOOLS],
        [toolCall('flip', { axis: 'horizontal' }), DONE_TOOLS],
        [toolCall('flip', { axis: 'vertical' }), DONE_TOOLS]
      ],
      { settings: { maxIterations: 2 } }
    )
    expect(result.reason).toBe('budget')
    expect(result.iterations).toBe(2)
    expect(fake.requests).toHaveLength(2)
    expect(result.steps).toHaveLength(2)
  })

  it('stops at the token budget', async () => {
    const { result } = await run(
      [
        [toolCall('get_palette', {}), { type: 'usage', inputTokens: 900, outputTokens: 200 }],
        [text('never')]
      ],
      { tokenBudget: 1000 }
    )
    expect(result.reason).toBe('budget')
    expect(result.iterations).toBe(1)
  })

  it('estimates tokens when the provider reports no usage', async () => {
    const { result } = await run([[toolCall('get_palette', {})], [text('never')]], {
      tokenBudget: 50
    })
    expect(result.reason).toBe('budget')
  })

  it('stops when aborted during streaming', async () => {
    const controller = new AbortController()
    const { result, events } = await run(
      [
        () => {
          controller.abort()
          return [text('partial'), toolCall('flip', { axis: 'vertical' })]
        }
      ],
      { signal: controller.signal }
    )
    expect(result.reason).toBe('stopped')
    expect(result.steps).toEqual([])
    expect(events.some((e) => e.type === 'tool_call')).toBe(false)
  })

  it('stops before the first call when already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const { result, fake } = await run([[text('x')]], { signal: controller.signal })
    expect(result.reason).toBe('stopped')
    expect(fake.requests).toHaveLength(0)
  })

  it('read tools execute immediately and create no steps', async () => {
    const { result, fake } = await run([
      [toolCall('get_pixels', {}), toolCall('get_palette', {}), toolCall('read_style_brief', {})],
      [DONE_END]
    ])
    expect(result.steps).toEqual([])
    const [pixels, palette, brief] = toolMessages(fake, 1) as { ok: boolean; result: unknown }[]
    expect(pixels.result).toMatchObject({ w: 2, h: 1, rows: ['ba'] })
    expect(palette.result).toMatchObject({ transparent: 0 })
    expect(brief.result).toEqual(emptyBrief())
  })

  it('get_texture reads the vanilla image when there is one', async () => {
    const { fake } = await run([[toolCall('get_texture', { source: 'vanilla' })], [DONE_END]], {
      vanilla: createImage(1, 1, [1, 2, 3, 255])
    })
    expect(toolMessages(fake, 1)[0]).toMatchObject({
      ok: true,
      result: { w: 1, h: 1, palette: { a: '#010203ff' } }
    })
  })

  it('memory tools create a step with the patch; later reads see the draft brief', async () => {
    const { result, fake } = await run([
      [toolCall('update_style_brief', { patch: { theme: 'Dark', addDecision: 'Dark theme' } })],
      [toolCall('read_style_brief', {})],
      [DONE_END]
    ])
    expect(result.steps).toEqual([
      expect.objectContaining({
        kind: 'memory',
        tool: 'update_style_brief',
        briefPatch: { theme: 'Dark', addDecision: 'Dark theme' },
        dependsOn: [],
        description: { key: 'ops.updateStyleBrief', params: { fields: 'theme, addDecision' } }
      })
    ])
    expect(result.steps[0].previewPng).toBeUndefined()
    const read = toolMessages(fake, 2)[1] as { result: { theme: string } }
    expect(read.result.theme).toBe('Dark')
  })

  it('provider errors end the run with reason error and the AppError code', async () => {
    const err = Object.assign(new Error('boom'), { code: 'ai.http', params: { status: 500 } })
    const { result } = await run([err])
    expect(result).toMatchObject({
      reason: 'error',
      error: { code: 'ai.http', params: { status: 500 } }
    })
  })

  it('adapter lookup errors (no key) and unknown errors', async () => {
    const fake = fakeProvider([])
    fake.providers.getAdapter = async () => {
      throw new AppErrorException('ai.noApiKey', { providerId: 'fake' })
    }
    const out = await runEditorAgent(
      {
        runId: 'r',
        request: request(),
        base: base(),
        settings: SETTINGS,
        brief: emptyBrief(),
        vanilla: null,
        history: []
      },
      { providers: fake.providers, newId: seqIds(), now: () => new Date() },
      () => undefined,
      new AbortController().signal
    )
    expect(out.error).toEqual({ code: 'ai.noApiKey', params: { providerId: 'fake' } })
    expect((await run([new Error('weird')])).result.error).toEqual({ code: 'ai.agentFailed' })
  })

  it('asks for thinking when enabled', async () => {
    const { fake } = await run([[DONE_END]], { settings: { thinking: true } })
    expect(fake.requests[0].think).toBe(true)
  })

  it('without vision no image is sent', async () => {
    const { fake } = await run([[toolCall('flip', { axis: 'vertical' })], [DONE_END]])
    expect(fake.requests.every((r) => r.messages.every((m) => !m.images))).toBe(true)
  })

  it(`with vision: the first message has the image, a fresh one every ${IMAGE_EVERY_STEPS} mutate steps, only the latest is sent`, async () => {
    const flips = Array.from({ length: IMAGE_EVERY_STEPS }, () =>
      toolCall('flip', { axis: 'vertical' })
    )
    const { fake } = await run([[...flips], [toolCall('flip', { axis: 'vertical' })], [DONE_END]], {
      vision: true
    })
    const first = fake.requests[0].messages
    expect(first.at(-1)!.images).toHaveLength(1)
    const second = fake.requests[1].messages
    const withImages = second.filter((m) => m.images?.length)
    expect(withImages).toHaveLength(1)
    expect(withImages[0].text).toMatch(/^\[App note\] Current texture after your changes/)
    expect(second.at(-1)).toBe(second.find((m) => m.images?.length))
    // One more mutate step: below K, no new image; the previous one is still the only one.
    const third = fake.requests[2].messages
    expect(third.filter((m) => m.images?.length)).toHaveLength(1)
  })
})
