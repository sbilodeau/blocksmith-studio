import { describe, expect, it, vi } from 'vitest'
import { createImage, decodePng, encodePng, getPixel, type RgbaImage } from '@shared/image'
import { emptyBrief } from '@shared/model/brief'
import type { EditorAgentRequest, Proposal } from '@shared/ai/types'
import {
  ToolError,
  executeOnFrames,
  getTool,
  takeFrame,
  toolSpecs,
  type AnyTool,
  type DraftContext
} from '@shared/ai/tools'
import { DONE_END, DONE_TOOLS, fakeProvider, seqIds, text, toolCall } from './ai-agent-fakes'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

const { runEditorAgent } = await import('../../src/main/services/ai/agent/runtime')
const { replayProposal } = await import('../../src/main/services/ai/agent/proposals')

const RED = [255, 0, 0, 255] as const
const BLUE = [0, 0, 255, 255] as const
const WHITE = '#ffffff'

/** 2x6 strip: three 2x2 frames, red / red / blue. */
function strip(): RgbaImage {
  const img = createImage(2, 6, [...RED])
  for (let y = 4; y < 6; y++) for (let x = 0; x < 2; x++) img.data.set(BLUE, (y * 2 + x) * 4)
  return img
}

const tool = (name: string): AnyTool => getTool(name)!
const ctx = (image: RgbaImage): DraftContext => ({ image, vanilla: null, brief: emptyBrief() })
const layout = { frameHeight: 2, current: 2 }

describe('frame-aware tool execution', () => {
  it('a change without frame applies to every frame; with frame, to that frame only', () => {
    const fill = { x: 0, y: 0, width: 1, height: 1, color: WHITE }
    const all = executeOnFrames(tool('fill_rect'), ctx(strip()), fill, layout, undefined)
    expect([0, 2, 4].map((y) => getPixel(all.image!, 0, y))).toEqual([
      [255, 255, 255, 255],
      [255, 255, 255, 255],
      [255, 255, 255, 255]
    ])
    expect(all.summary).toMatch(/every frame \(3\)/)
    const one = executeOnFrames(tool('fill_rect'), ctx(strip()), fill, layout, 1)
    expect(getPixel(one.image!, 0, 0)).toEqual([...RED])
    expect(getPixel(one.image!, 0, 2)).toEqual([255, 255, 255, 255])
    expect(one.result).toMatchObject({ frame: 1 })
  })

  it('reads the current frame by default, and refuses a change that resizes frames', () => {
    const palette = executeOnFrames(tool('get_palette'), ctx(strip()), {}, layout, undefined)
    expect(JSON.stringify(palette.result)).toContain('#0000ff')
    expect(JSON.stringify(palette.result)).not.toContain('#ff0000')
    expect(() =>
      executeOnFrames(tool('resize'), ctx(strip()), { width: 4, height: 4 }, layout, 0)
    ).toThrow(ToolError)
  })

  it('image tools get a frame parameter only on animated textures', () => {
    const plain = toolSpecs('editor').find((t) => t.name === 'rotate')!
    expect(JSON.stringify(plain.parameters)).not.toContain('"frame"')
    const specs = toolSpecs('editor', { frames: 3 })
    const rotate = specs.find((t) => t.name === 'rotate')!.parameters as {
      properties: Record<string, { maximum?: number }>
    }
    expect(rotate.properties['frame']).toMatchObject({ type: 'integer', minimum: 0, maximum: 2 })
    const brief = specs.find((t) => t.name === 'update_style_brief')!
    expect(JSON.stringify(brief.parameters)).not.toContain('"frame"')
    expect(takeFrame({ frame: 1, x: 2 })).toEqual({ frame: 1, rest: { x: 2 } })
    expect(takeFrame({ x: 2 })).toEqual({ rest: { x: 2 } })
  })
})

describe('editor agent on an animated texture', () => {
  function request(): EditorAgentRequest {
    return {
      packId: 'p1',
      message: 'mets un pixel blanc sur la 2e image',
      model: { providerId: 'fake', modelId: 'm1' },
      texture: {
        path: 'assets/minecraft/textures/block/fire_0.png',
        png: encodePng(strip()),
        animation: { frameHeight: 2, frame: 2 }
      },
      language: 'fr'
    }
  }

  it('shows the current frame, runs steps on the named frame and replays them the same way', async () => {
    const fake = fakeProvider([
      [
        toolCall('set_pixels', { pixels: [{ x: 1, y: 1, color: WHITE }], frame: 1 }),
        toolCall('fill_rect', { x: 0, y: 0, width: 1, height: 1, color: '#000000' }),
        toolCall('flip', { axis: 'horizontal', frame: 7 }),
        DONE_TOOLS
      ],
      [text('Fait.'), DONE_END]
    ])
    const result = await runEditorAgent(
      {
        runId: 'r1',
        request: request(),
        base: strip(),
        settings: { thinking: 'off', maxIterations: 6, imageMode: 'grid' },
        brief: emptyBrief(),
        vanilla: null,
        history: []
      },
      { providers: fake.providers, newId: seqIds(), now: () => new Date('2026-11-16T10:00:00Z') },
      () => undefined,
      new AbortController().signal
    )
    const first = fake.requests[0]!
    expect(first.messages[0]!.text).toContain('3 frames of 2 x 2 px')
    // The user message shows frame 2 (blue) only.
    const user = first.messages.find((m) => m.role === 'user')!.text!
    expect(user).toContain('editing frame 2')
    expect(user).toContain('2 x 2 px')
    expect(user).toContain('#0000ff')
    expect(user).not.toContain('#ff0000')
    expect(first.tools!.find((t) => t.name === 'set_pixels')!.parameters).toMatchObject({
      properties: { frame: { maximum: 2 } }
    })

    expect(result.steps.map((s) => [s.tool, s.frame])).toEqual([
      ['set_pixels', 1],
      ['fill_rect', 'all']
    ])
    // The out-of-range frame came back to the model as an error.
    const errors = fake.requests[1]!.messages.filter((m) => m.role === 'tool').map(
      (m) => JSON.parse(m.text!) as { ok: boolean; error?: string }
    )
    expect(errors[2]).toMatchObject({ ok: false, error: expect.stringContaining('from 0 to 2') })

    const last = decodePng(result.steps[1]!.previewPng!)
    expect(getPixel(last, 1, 3)).toEqual([255, 255, 255, 255]) // frame 1, (1, 1)
    expect([0, 2, 4].map((y) => getPixel(last, 0, y))).toEqual([
      [0, 0, 0, 255],
      [0, 0, 0, 255],
      [0, 0, 0, 255]
    ])

    const proposal: Proposal = {
      id: 'x',
      runId: 'r1',
      agent: 'editor',
      packId: 'p1',
      texturePath: request().texture.path,
      basePng: encodePng(strip()),
      animation: { frameHeight: 2, frame: 2 },
      steps: result.steps,
      status: 'pending'
    }
    const replayed = replayProposal(
      proposal,
      result.steps.map((s) => s.id),
      emptyBrief()
    )
    expect(replayed.image).toEqual(last)
    // Only the first step: frame 1 changed, the others untouched.
    const partial = replayProposal(proposal, [result.steps[0]!.id], emptyBrief()).image
    expect(getPixel(partial, 1, 3)).toEqual([255, 255, 255, 255])
    expect(getPixel(partial, 1, 1)).toEqual([...RED])
  })
})
