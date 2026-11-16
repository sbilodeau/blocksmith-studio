import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createImage, decodePng, encodePng, getPixel, toHex } from '@shared/image'
import type { AgentEvent, AgentSettings, BulkProposal } from '@shared/ai/types'
import type { TextureEntry } from '@shared/model/pack'
import { DONE_END, DONE_TOOLS, fakeProvider, seqIds, text, toolCall } from '../unit/ai-agent-fakes'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

const { createBulkService } = await import('../../src/main/services/bulk/service')
const { inProcessBulkRunner } = await import('../../src/main/services/bulk/runner')
const { createEditorAgentService, createConversationStore } =
  await import('../../src/main/services/ai/agent')
const { createBriefService } = await import('../../src/main/services/brief')

const P = (name: string): string => `assets/minecraft/textures/block/${name}.png`

function entry(name: string, extra: Partial<TextureEntry> = {}): TextureEntry {
  return {
    path: P(name),
    namespace: 'minecraft',
    folder: 'block',
    name,
    width: 2,
    height: 2,
    animated: false,
    status: 'vanilla',
    categories: ['blocks'],
    url: '',
    ...extra
  }
}

/** A small fake pack: stone and dirt are gray, glass is transparent (unchanged by a hue shift). */
interface FakePack {
  files: Map<string, Uint8Array>
  saves: Array<{ items: Array<{ path: string; png: Uint8Array }>; change: unknown }>
  packs: { textures(): Promise<TextureEntry[]> }
  textures: {
    read(packId: string, path: string): Promise<{ png: Uint8Array | null }>
    saveMany(
      packId: string,
      items: ReadonlyArray<{ path: string; png: Uint8Array }>,
      change: unknown
    ): Promise<null>
  }
}

function fakePack(): FakePack {
  const files = new Map<string, Uint8Array>([
    [P('stone'), encodePng(createImage(2, 2, [128, 128, 128, 255]))],
    [P('dirt'), encodePng(createImage(2, 2, [128, 128, 128, 255]))],
    [P('glass'), encodePng(createImage(2, 2, [0, 0, 0, 0]))]
  ])
  const saves: FakePack['saves'] = []
  return {
    files,
    saves,
    packs: { textures: async () => [entry('stone'), entry('dirt'), entry('glass')] },
    textures: {
      read: async (_packId: string, path: string) => ({ png: files.get(path) ?? null }),
      saveMany: async (
        _packId: string,
        items: ReadonlyArray<{ path: string; png: Uint8Array }>,
        change: unknown
      ) => {
        saves.push({ items: [...items], change })
        for (const i of items) files.set(i.path, i.png)
        return null
      }
    }
  }
}

describe('bulk service', () => {
  it('previews an operation on a selection, then writes the ticked textures as one entry', async () => {
    const pack = fakePack()
    const progress: Array<[string, number, number]> = []
    const bulk = createBulkService({
      ...pack,
      run: inProcessBulkRunner,
      jobs: { start: () => (phase, done, total) => progress.push([phase, done, total]) }
    })
    const preview = await bulk.preview(
      'p1',
      [P('stone'), P('dirt'), P('glass'), P('missing'), P('stone')],
      [{ tool: 'replace_color', args: { from: '#808080', to: '#c00000' } }]
    )
    expect(preview.items.map((i) => i.name)).toEqual(['stone', 'dirt'])
    expect(preview.unchanged).toEqual([P('glass')])
    expect(preview.failed).toEqual([{ path: P('missing'), error: 'not a texture of this pack' }])
    expect(toHex(getPixel(decodePng(preview.items[0]!.afterPng), 0, 0))).toBe('#c00000ff')
    expect(progress.at(-1)).toEqual(['compute', 3, 3])

    expect(await bulk.apply(preview.id, [P('dirt')])).toEqual({ applied: 1 })
    expect(pack.saves).toHaveLength(1)
    expect(pack.saves[0]!.items.map((i) => i.path)).toEqual([P('dirt')])
    expect(pack.saves[0]!.change).toEqual({
      source: 'bulk',
      label: { key: 'bulk', params: { count: 1 } }
    })
    // A preview is applied once.
    await expect(bulk.apply(preview.id, [P('dirt')])).rejects.toMatchObject({
      code: 'bulk.previewExpired'
    })
  })

  it('previews expire and can be discarded', async () => {
    let now = 0
    const bulk = createBulkService({
      ...fakePack(),
      run: inProcessBulkRunner,
      now: () => now,
      ttlMs: 1000
    })
    const op = [{ tool: 'flip', args: { axis: 'horizontal' } }]
    const a = await bulk.preview('p1', [P('stone')], op)
    now = 5000
    await expect(bulk.apply(a.id, [])).rejects.toMatchObject({ code: 'bulk.previewExpired' })
    const b = await bulk.preview('p1', [P('stone')], op)
    bulk.discard(b.id)
    await expect(bulk.apply(b.id, [])).rejects.toMatchObject({ code: 'bulk.previewExpired' })
  })
})

describe('navigation agent service', () => {
  let root: string
  let folder: string
  let events: AgentEvent[]
  const SETTINGS: AgentSettings = { thinking: 'off', maxIterations: 6, imageMode: 'grid' }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'bs-nav-'))
    folder = join(root, 'pack')
    await mkdir(folder, { recursive: true })
    events = []
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  function setup(scripts: Parameters<typeof fakeProvider>[0]): {
    agent: ReturnType<typeof createEditorAgentService>
    pack: FakePack
    brief: ReturnType<typeof createBriefService>
    fake: ReturnType<typeof fakeProvider>
  } {
    const pack = fakePack()
    const locate = async (id: string): Promise<{ folder: string } | null> =>
      id === 'p1' ? { folder } : null
    const brief = createBriefService({ locate, now: () => new Date('2026-11-15T10:00:00Z') })
    const bulk = createBulkService({ ...pack, brief, run: inProcessBulkRunner })
    const fake = fakeProvider(scripts)
    const agent = createEditorAgentService({
      providers: fake.providers,
      getAgentSettings: () => SETTINGS,
      packs: { locate },
      brief,
      conversations: createConversationStore({ locate }),
      readVanillaPng: async () => null,
      navigation: {
        textures: pack.packs.textures,
        readPng: async (packId, path) => (await pack.textures.read(packId, path)).png,
        bulk
      },
      emit: (e) => events.push(e),
      newId: seqIds()
    })
    return { agent, pack, brief, fake }
  }

  const PLAN = [
    [toolCall('replace_color', { from: '#808080', to: '#c00000' }), DONE_TOOLS],
    [toolCall('update_style_brief', { patch: { rules: ['Stone is red'] } }), DONE_TOOLS],
    [text('Fait.'), DONE_END]
  ] as Parameters<typeof fakeProvider>[0]

  async function send(agent: ReturnType<typeof setup>['agent']): Promise<BulkProposal> {
    await agent.sendNavigation({
      packId: 'p1',
      message: 'mets tout en rouge',
      model: { providerId: 'fake', modelId: 'm1' },
      paths: [P('stone'), P('dirt'), P('glass'), P('unknown')],
      language: 'fr'
    })
    await agent.idle()
    const e = events.find((x) => x.type === 'proposal')
    if (e?.type !== 'proposal') throw new Error(`no proposal: ${JSON.stringify(events.at(-1))}`)
    return e.proposal as BulkProposal
  }

  it('produces a bulk proposal over the selection without writing anything', async () => {
    const { agent, pack } = setup(PLAN)
    const proposal = await send(agent)
    expect(proposal).toMatchObject({ kind: 'bulk', agent: 'navigation', status: 'pending' })
    expect(proposal.steps.map((s) => s.tool)).toEqual(['replace_color', 'update_style_brief'])
    expect(proposal.items.map((i) => i.name)).toEqual(['stone', 'dirt'])
    expect(pack.saves).toEqual([])
    expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'end' })
    const turns = await agent.conversation('p1', 'navigation')
    expect(turns[0]).toMatchObject({ role: 'user', text: 'mets tout en rouge' })
  })

  it('applies the accepted steps to the accepted textures as one AI entry, and logs it', async () => {
    const { agent, pack, brief } = setup(PLAN)
    const proposal = await send(agent)
    // The file changed after the agent looked: the replay uses the pixels the agent saw.
    pack.files.set(P('stone'), encodePng(createImage(2, 2, [1, 2, 3, 255])))
    const result = await agent.applyNavigation(
      proposal.id,
      proposal.steps.map((s) => s.id),
      [P('stone')]
    )
    expect(result).toMatchObject({ applied: 1, briefUpdated: true })
    expect(pack.saves).toHaveLength(1)
    const saved = pack.saves[0]!
    expect(saved.change).toEqual({ source: 'ai', label: { key: 'aiBulk', params: { count: 1 } } })
    expect(toHex(getPixel(decodePng(saved.items[0]!.png), 0, 0))).toBe('#c00000ff')
    const b = await brief.get('p1')
    expect(b.rules).toContain('Stone is red')
    expect(b.requestLog.at(-1)!.summary).toContain('1 selected textures')
    const note = (await agent.conversation('p1', 'navigation')).at(-1)!
    expect(note.text).toContain('1 of 2 changed textures were written')
    await expect(agent.applyNavigation(proposal.id, [], [])).rejects.toMatchObject({
      code: 'ai.proposalNotPending'
    })
  })

  it('reports an empty selection and refuses editor applies on a bulk proposal', async () => {
    const { agent } = setup(PLAN)
    await agent.sendNavigation({
      packId: 'p1',
      message: 'x',
      model: { providerId: 'fake', modelId: 'm1' },
      paths: [P('unknown')],
      language: 'en'
    })
    await agent.idle()
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      reason: 'error',
      error: { code: 'ai.emptySelection' }
    })
    events = []
    const proposal = await send(agent)
    await expect(agent.applyProposal(proposal.id, [])).rejects.toMatchObject({
      code: 'ai.proposalNotPending'
    })
  })
})
