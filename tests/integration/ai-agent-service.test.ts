import { appendFile, mkdtemp, mkdir, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createImage, decodePng, encodePng, getPixel, setPixel, toHex } from '@shared/image'
import type { AgentEvent, AgentSettings, EditorAgentRequest, Proposal } from '@shared/ai/types'
import { DONE_END, fakeProvider, seqIds, text, toolCall, type Script } from '../unit/ai-agent-fakes'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

const { createEditorAgentService, createConversationStore } =
  await import('../../src/main/services/ai/agent')
const { createBriefService } = await import('../../src/main/services/brief')

const PATH = 'assets/minecraft/textures/block/stone.png'
const SETTINGS: AgentSettings = { thinking: 'off', maxIterations: 6, imageMode: 'vision+grid' }

function texture(): Uint8Array {
  const img = createImage(2, 1)
  setPixel(img, 0, 0, [255, 0, 0, 255])
  setPixel(img, 1, 0, [0, 255, 0, 255])
  return encodePng(img)
}

function request(
  message = 'tourne de 90° à gauche et ajoute des flammes au bout'
): EditorAgentRequest {
  return {
    packId: 'p1',
    message,
    model: { providerId: 'fake', modelId: 'm1' },
    texture: { path: PATH, png: texture() },
    language: 'fr'
  }
}

describe('editor agent service', () => {
  let root: string
  let folder: string
  let clock: number
  let events: AgentEvent[]
  let vanillaPng: Uint8Array | null

  const locate = async (id: string): Promise<{ folder: string } | null> =>
    id === 'p1' ? { folder } : null
  const conversationFile = (): string =>
    join(folder, '.blocksmith', 'conversations', 'editor.jsonl')

  function service(
    scripts: Script[],
    extra: { proposalTtlMs?: number } = {}
  ): {
    agent: ReturnType<typeof createEditorAgentService>
    brief: ReturnType<typeof createBriefService>
    fake: ReturnType<typeof fakeProvider>
  } {
    const fake = fakeProvider(scripts)
    const now = (): Date => new Date(clock)
    const brief = createBriefService({ locate, now })
    const agent = createEditorAgentService({
      providers: fake.providers,
      getAgentSettings: () => SETTINGS,
      packs: { locate },
      brief,
      conversations: createConversationStore({ locate }),
      readVanillaPng: async () => vanillaPng,
      emit: (e) => events.push(e),
      now,
      newId: seqIds(),
      ...extra
    })
    return { agent, brief, fake }
  }

  async function sendAndWait(
    agent: ReturnType<typeof createEditorAgentService>,
    req = request()
  ): Promise<{ runId: string; proposal?: Proposal }> {
    const { runId } = await agent.send(req)
    await agent.idle()
    const p = events.find((e) => e.type === 'proposal' && e.runId === runId)
    return { runId, proposal: p?.type === 'proposal' ? p.proposal : undefined }
  }

  const PLAN: Script[] = [
    [toolCall('rotate', { degrees: 90, direction: 'counterclockwise' })],
    [
      toolCall('set_pixels', { pixels: [{ x: 0, y: 0, color: '#ffa000' }] }),
      toolCall('update_style_brief', { patch: { rules: ['Flames are orange'] } })
    ],
    [text('Voilà.'), DONE_END]
  ]

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'bs-agent-'))
    folder = join(root, 'pack')
    await mkdir(folder, { recursive: true })
    clock = Date.parse('2026-11-15T10:00:00Z')
    events = []
    vanillaPng = null
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('send returns a run id and runs in the background: started, stream, proposal, done', async () => {
    const { agent } = service(PLAN)
    const { runId, proposal } = await sendAndWait(agent)
    expect(events[0]).toEqual({
      runId,
      type: 'started',
      agent: 'editor',
      model: { providerId: 'fake', modelId: 'm1' }
    })
    const types = events.map((e) => e.type)
    expect(types.slice(-2)).toEqual(['proposal', 'done'])
    expect(events.at(-1)).toEqual({ runId, type: 'done', reason: 'end' })
    expect(proposal).toMatchObject({
      runId,
      agent: 'editor',
      packId: 'p1',
      texturePath: PATH,
      status: 'pending'
    })
    expect(proposal!.steps.map((s) => s.tool)).toEqual([
      'rotate',
      'set_pixels',
      'update_style_brief'
    ])
    expect(proposal!.steps[1].dependsOn).toEqual([proposal!.steps[0].id])
  })

  it('persists the conversation (user, assistant, tool turns) with the proposal id', async () => {
    const { agent } = service(PLAN)
    const { proposal } = await sendAndWait(agent)
    const turns = await agent.conversation('p1', 'editor')
    expect(turns.map((t) => t.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'assistant',
      'tool',
      'tool',
      'assistant'
    ])
    expect(turns[0]).toMatchObject({ text: request().message, texturePath: PATH })
    expect(turns.at(-1)).toMatchObject({ text: 'Voilà.', proposalId: proposal!.id })
  })

  it('the next run sends the previous conversation as history', async () => {
    const { agent, fake } = service([...PLAN, [text('Ok'), DONE_END]])
    await sendAndWait(agent)
    await sendAndWait(agent, request('encore'))
    const last = fake.requests.at(-1)!.messages
    expect(last.some((m) => m.role === 'user' && m.text?.includes('ajoute des flammes'))).toBe(true)
    expect(last.some((m) => m.role === 'assistant' && m.text === 'Voilà.')).toBe(true)
  })

  it('apply all: replays the steps, updates the brief, logs the request and notes the decision', async () => {
    const { agent, brief } = service(PLAN)
    const { proposal } = await sendAndWait(agent)
    const ids = proposal!.steps.map((s) => s.id)
    const out = await agent.applyProposal(proposal!.id, ids)
    expect(out.appliedStepIds).toEqual(ids)
    expect(out.briefUpdated).toBe(true)
    const img = decodePng(out.png)
    expect([img.width, img.height]).toEqual([1, 2])
    expect(toHex(getPixel(img, 0, 0))).toBe('#ffa000ff')
    expect(toHex(getPixel(img, 0, 1))).toBe('#ff0000ff')
    const b = await brief.get('p1')
    expect(b.rules).toEqual(['Flames are orange'])
    expect(b.decisions).toEqual([
      expect.objectContaining({ by: 'editor', text: expect.stringContaining('rules') })
    ])
    expect(b.requestLog).toEqual([
      expect.objectContaining({
        agent: 'editor',
        summary: expect.stringContaining('block/stone.png')
      })
    ])
    expect(b.requestLog[0].summary).toContain('(3 of 3 steps)')
    const turns = await agent.conversation('p1', 'editor')
    expect(turns.at(-1)).toMatchObject({
      role: 'tool',
      proposalId: proposal!.id,
      text: expect.stringContaining('applied 3 of 3 steps')
    })
    // The texture file is never written by main.
    await expect(stat(join(folder, ...PATH.split('/')))).rejects.toThrow()
    await expect(agent.applyProposal(proposal!.id, ids)).rejects.toMatchObject({
      code: 'ai.proposalNotPending'
    })
  })

  it('apply a subset: only accepted steps are replayed; the brief is untouched', async () => {
    const { agent, brief } = service(PLAN)
    const { proposal } = await sendAndWait(agent)
    const [rotate, setPixels] = proposal!.steps
    const out = await agent.applyProposal(proposal!.id, [setPixels.id, 'unknown-step'])
    expect(out.appliedStepIds).toEqual([setPixels.id])
    expect(out.briefUpdated).toBe(false)
    const img = decodePng(out.png)
    // No rotation: still 2x1, (0,0) painted.
    expect([img.width, img.height]).toEqual([2, 1])
    expect(toHex(getPixel(img, 0, 0))).toBe('#ffa000ff')
    expect(rotate.id).not.toBe(setPixels.id)
    const b = await brief.get('p1')
    expect(b.rules).toEqual([])
    expect(b.requestLog[0].summary).toContain('(1 of 3 steps)')
    const turns = await agent.conversation('p1', 'editor')
    expect(turns.at(-1)!.text).toContain('applied 1 of 3 steps')
  })

  it('reject marks the proposal and notes it in the conversation', async () => {
    const { agent, brief } = service(PLAN)
    const { proposal } = await sendAndWait(agent)
    await agent.rejectProposal(proposal!.id)
    const turns = await agent.conversation('p1', 'editor')
    expect(turns.at(-1)!.text).toContain('rejected')
    expect((await brief.get('p1')).requestLog).toEqual([])
    await expect(agent.applyProposal(proposal!.id, [])).rejects.toMatchObject({
      code: 'ai.proposalNotPending'
    })
  })

  it('unknown and expired proposals', async () => {
    const { agent } = service(PLAN, { proposalTtlMs: 1000 })
    await expect(agent.applyProposal('nope', [])).rejects.toMatchObject({
      code: 'ai.proposalNotFound'
    })
    const { proposal } = await sendAndWait(agent)
    clock += 1001
    await expect(agent.applyProposal(proposal!.id, [])).rejects.toMatchObject({
      code: 'ai.proposalNotFound'
    })
  })

  it('a new run expires the previous pending proposal', async () => {
    const { agent } = service([...PLAN, [text('Ok'), DONE_END]])
    const { proposal } = await sendAndWait(agent)
    await sendAndWait(agent, request('merci'))
    await expect(agent.rejectProposal(proposal!.id)).rejects.toMatchObject({
      code: 'ai.proposalNotFound'
    })
  })

  it('text-only answers produce no proposal', async () => {
    const { agent } = service([[text('Salut'), DONE_END]])
    const { proposal } = await sendAndWait(agent)
    expect(proposal).toBeUndefined()
    expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'end' })
  })

  it('stop aborts the run (done: stopped) and keeps the steps so far as a proposal', async () => {
    let runId = ''
    const { agent } = service([
      [toolCall('flip', { axis: 'vertical' })],
      () => {
        agent.stop(runId)
        return [text('never')]
      }
    ])
    runId = (await agent.send(request())).runId
    await agent.idle()
    expect(events.at(-1)).toEqual({ runId, type: 'done', reason: 'stopped' })
    const p = events.find((e) => e.type === 'proposal')
    expect(p?.type === 'proposal' && p.proposal.steps.map((s) => s.tool)).toEqual(['flip'])
  })

  it('a new send stops the previous run of the same pack', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((r) => (release = r))
    const fake = fakeProvider([])
    const adapter = await fake.providers.getAdapter('fake')
    let first = true
    adapter.chat = async function* (_req, signal) {
      if (first) {
        first = false
        await gate
        if (signal.aborted) {
          const err = new Error('aborted')
          err.name = 'AbortError'
          throw err
        }
      }
      yield { type: 'text', delta: 'second' }
    }
    const agent = createEditorAgentService({
      providers: fake.providers,
      getAgentSettings: () => SETTINGS,
      packs: { locate },
      brief: createBriefService({ locate }),
      conversations: createConversationStore({ locate }),
      readVanillaPng: async () => null,
      emit: (e) => events.push(e),
      newId: seqIds()
    })
    const a = await agent.send(request())
    await new Promise((r) => setTimeout(r, 10))
    const b = await agent.send(request('autre'))
    release()
    await agent.idle()
    const dones = events.filter((e) => e.type === 'done')
    expect(dones).toEqual([
      { runId: a.runId, type: 'done', reason: 'stopped' },
      { runId: b.runId, type: 'done', reason: 'end' }
    ])
  })

  it('send fails fast on an undecodable texture or unknown pack', async () => {
    const { agent } = service([])
    await expect(
      agent.send({ ...request(), texture: { path: PATH, png: new Uint8Array([1, 2, 3]) } })
    ).rejects.toMatchObject({ code: 'ai.invalidTexture' })
    await expect(agent.send({ ...request(), packId: 'nope' })).rejects.toMatchObject({
      code: 'packs.notFound'
    })
  })

  it('provider errors end with done/error', async () => {
    const { agent } = service([Object.assign(new Error('x'), { code: 'ai.rateLimited' })])
    await sendAndWait(agent)
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      reason: 'error',
      error: { code: 'ai.rateLimited' }
    })
  })

  it('get_texture uses the injected vanilla reader', async () => {
    vanillaPng = encodePng(createImage(1, 1, [9, 9, 9, 255]))
    const { agent, fake } = service([[toolCall('get_texture', { source: 'vanilla' })], [DONE_END]])
    await sendAndWait(agent)
    const tool = fake.requests[1].messages.find((m) => m.role === 'tool')!
    expect(JSON.parse(tool.text!)).toMatchObject({ ok: true, result: { w: 1, h: 1 } })
  })

  it('conversation files skip corrupted lines and clear removes them', async () => {
    const { agent } = service([[text('Salut'), DONE_END]])
    await sendAndWait(agent)
    await appendFile(conversationFile(), '{not json\n{"id":1}\n')
    const turns = await agent.conversation('p1', 'editor')
    expect(turns.map((t) => t.role)).toEqual(['user', 'assistant'])
    // A cut last line (no newline) does not swallow the next append.
    await appendFile(conversationFile(), '{"id":"x","at":"t","ro')
    await createConversationStore({ locate }).append('p1', 'editor', [
      { id: 'n', at: 't', role: 'user', text: 'next' }
    ])
    expect((await agent.conversation('p1', 'editor')).at(-1)).toMatchObject({ text: 'next' })
    expect((await readFile(conversationFile(), 'utf8')).endsWith('\n')).toBe(true)
    await agent.clear('p1', 'editor')
    expect(await agent.conversation('p1', 'editor')).toEqual([])
  })
})
