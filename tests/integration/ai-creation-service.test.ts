import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createImage, decodePng, encodePng, getPixel, toHex } from '@shared/image'
import type { AgentEvent, AgentSettings, CreationProposal, PackMetaPatch } from '@shared/ai/types'
import type { TextureEntry } from '@shared/model/pack'
import { DONE_END, DONE_TOOLS, fakeProvider, seqIds, text, toolCall } from '../unit/ai-agent-fakes'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

const { createBulkService } = await import('../../src/main/services/bulk/service')
const { inProcessBulkRunner } = await import('../../src/main/services/bulk/runner')
const { createEditorAgentService, createConversationStore } =
  await import('../../src/main/services/ai/agent')
const { createBriefService } = await import('../../src/main/services/brief')

const P = (folder: string, name: string): string =>
  `assets/minecraft/textures/${folder}/${name}.png`

function entry(folder: string, name: string, categories: string[]): TextureEntry {
  return {
    path: P(folder, name),
    namespace: 'minecraft',
    folder,
    name,
    width: 2,
    height: 2,
    animated: false,
    status: 'vanilla',
    categories,
    url: ''
  }
}

const ENTRIES = [
  entry('block', 'stone', ['blocks']),
  entry('block', 'iron_ore', ['blocks', 'ores']),
  entry('item', 'iron_pickaxe', ['tools'])
]

const SETTINGS: AgentSettings = { thinking: 'off', maxIterations: 6, imageMode: 'grid' }

const PLAN = [
  [toolCall('update_style_brief', { patch: { theme: 'Fire' } }), DONE_TOOLS],
  [
    toolCall('apply_to_all', {
      operation: { tool: 'replace_color', args: { from: '#808080', to: '#c00000' } },
      filter: { categories: ['blocks'] }
    }),
    toolCall('apply_to_all', {
      operation: { tool: 'replace_color', args: { from: '#808080', to: '#ffaa00' } },
      filter: { categories: ['tools'] }
    }),
    toolCall('set_pack_meta', { name: 'Fire Pack' }),
    DONE_TOOLS
  ],
  [text('Voici le plan.'), DONE_END]
] as Parameters<typeof fakeProvider>[0]

describe('creation agent service', () => {
  let root: string
  let folder: string
  let events: AgentEvent[]

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'bs-creation-'))
    folder = join(root, 'pack')
    await mkdir(folder, { recursive: true })
    events = []
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  function setup(options: { stopAfterFirstStep?: boolean; empty?: boolean } = {}): {
    agent: ReturnType<typeof createEditorAgentService>
    files: Map<string, Uint8Array>
    saves: Array<{ paths: string[]; change: unknown }>
    meta: PackMetaPatch[]
    progress: Array<[string, number, number]>
    brief: ReturnType<typeof createBriefService>
  } {
    const gray = (): [string, Uint8Array][] =>
      ENTRIES.map((e) => [e.path, encodePng(createImage(2, 2, [128, 128, 128, 255]))])
    // An empty pack has no file: its textures come from vanilla until a step writes them.
    const files = new Map<string, Uint8Array>(options.empty ? [] : gray())
    const vanilla = new Map<string, Uint8Array>(gray())
    const saves: Array<{ paths: string[]; change: unknown }> = []
    const meta: PackMetaPatch[] = []
    const progress: Array<[string, number, number]> = []
    const locate = async (id: string): Promise<{ folder: string } | null> =>
      id === 'p1' ? { folder } : null
    const brief = createBriefService({ locate, now: () => new Date('2026-11-16T10:00:00Z') })
    const bulk = createBulkService({
      packs: { textures: async () => ENTRIES },
      textures: {
        read: async (_p, path) => ({ png: files.get(path) ?? null }),
        saveMany: async (_p, items, change) => {
          saves.push({ paths: items.map((i) => i.path), change })
          for (const i of items) files.set(i.path, i.png)
          return null
        }
      },
      brief,
      run: inProcessBulkRunner
    })
    const fake = fakeProvider(PLAN)
    const agent: ReturnType<typeof createEditorAgentService> = createEditorAgentService({
      providers: fake.providers,
      getAgentSettings: () => SETTINGS,
      packs: { locate },
      brief,
      conversations: createConversationStore({ locate }),
      readVanillaPng: async () => null,
      navigation: {
        textures: async () => ENTRIES,
        readPng: async (_p, path) => files.get(path) ?? null,
        bulk: {
          compute: async (...args) => {
            const out = await bulk.compute(...args)
            // Simulates the user pressing Stop while the first step runs.
            if (options.stopAfterFirstStep) agent.stopCreationApply(currentProposal)
            return out
          },
          write: (...args) => bulk.write(...args)
        }
      },
      creation: {
        catalog: async () => ENTRIES,
        readPng: async (_p, path) => files.get(path) ?? vanilla.get(path) ?? null,
        meta: async () => ({
          name: 'Pack',
          description: '',
          base: options.empty ? 'empty' : 'vanilla'
        }),
        setMeta: async (_p, patch) => {
          meta.push(patch)
        },
        jobs: { start: () => (phase, done, total) => progress.push([phase, done, total]) }
      },
      emit: (e) => events.push(e),
      newId: seqIds()
    })
    return { agent, files, saves, meta, progress, brief }
  }

  let currentProposal = ''

  async function send(agent: ReturnType<typeof setup>['agent']): Promise<CreationProposal> {
    await agent.sendCreation({
      packId: 'p1',
      message: 'fais un pack de feu',
      model: { providerId: 'fake', modelId: 'm1' },
      language: 'fr'
    })
    await agent.idle()
    const e = events.find((x) => x.type === 'proposal')
    if (e?.type !== 'proposal') throw new Error(`no proposal: ${JSON.stringify(events.at(-1))}`)
    currentProposal = e.proposal.id
    return e.proposal as CreationProposal
  }

  it('produces a plan over the whole pack without writing anything', async () => {
    const { agent, saves, meta } = setup()
    const proposal = await send(agent)
    expect(proposal).toMatchObject({ agent: 'creation', kind: 'plan', status: 'pending' })
    expect(proposal.steps.map((s) => s.tool)).toEqual([
      'update_style_brief',
      'replace_color',
      'replace_color',
      'set_pack_meta'
    ])
    expect(proposal.steps[1]!.scope).toMatchObject({ count: 2 })
    expect(saves).toEqual([])
    expect(meta).toEqual([])
    expect(await agent.conversation('p1', 'creation')).toHaveLength(8)
  })

  it('applies the accepted steps: meta and brief first, then one history entry per texture step', async () => {
    const { agent, files, saves, meta, progress, brief } = setup()
    const proposal = await send(agent)
    const ids = proposal.steps.map((s) => s.id)
    const result = await agent.applyCreation(proposal.id, ids)
    expect(result).toEqual({
      appliedStepIds: ids,
      texturesWritten: 3,
      checkpoints: 2,
      stopped: false,
      briefUpdated: true,
      metaUpdated: true
    })
    expect(meta).toEqual([{ name: 'Fire Pack' }])
    expect(saves.map((s) => s.paths.map((p) => p.split('/').pop()))).toEqual([
      ['stone.png', 'iron_ore.png'],
      ['iron_pickaxe.png']
    ])
    expect(saves[0]!.change).toEqual({
      source: 'ai',
      label: { key: 'aiPlanStep', params: { step: 1, total: 2, count: 2 } }
    })
    expect(toHex(getPixel(decodePng(files.get(P('item', 'iron_pickaxe'))!), 0, 0))).toBe(
      '#ffaa00ff'
    )
    expect(progress).toEqual([
      ['step', 0, 2],
      ['step', 1, 2],
      ['step', 2, 2]
    ])
    const b = await brief.get('p1')
    expect(b.theme).toBe('Fire')
    expect(b.requestLog.at(-1)).toMatchObject({ agent: 'creation' })
    expect(b.requestLog.at(-1)!.summary).toContain('whole pack (3 texture writes)')
    await expect(agent.applyCreation(proposal.id, ids)).rejects.toMatchObject({
      code: 'ai.proposalNotPending'
    })
  })

  it('applies only the ticked steps, on the current pixels', async () => {
    const { agent, saves, meta } = setup()
    const proposal = await send(agent)
    const result = await agent.applyCreation(proposal.id, [proposal.steps[2]!.id])
    expect(result).toMatchObject({
      texturesWritten: 1,
      checkpoints: 1,
      briefUpdated: false,
      metaUpdated: false
    })
    expect(saves).toHaveLength(1)
    expect(meta).toEqual([])
  })

  it('stops between steps when asked, keeping the steps already written', async () => {
    const { agent, saves } = setup({ stopAfterFirstStep: true })
    const proposal = await send(agent)
    const result = await agent.applyCreation(
      proposal.id,
      proposal.steps.map((s) => s.id)
    )
    expect(result).toMatchObject({ stopped: true, checkpoints: 1, texturesWritten: 2 })
    expect(saves).toHaveLength(1)
    const notes = (await agent.conversation('p1', 'creation')).filter(
      (t) => t.role === 'tool' && t.text
    )
    expect(notes.at(-1)!.text).toContain('stopped the plan')
  })

  it('creates textures in an empty pack from their vanilla pixels', async () => {
    const { agent, files, saves } = setup({ empty: true })
    const proposal = await send(agent)
    expect(proposal.steps[1]!.samples!.map((x) => x.name)).toEqual(['stone', 'iron_ore'])
    expect(files.size).toBe(0)
    const result = await agent.applyCreation(
      proposal.id,
      proposal.steps.map((x) => x.id)
    )
    expect(result).toMatchObject({ texturesWritten: 3, checkpoints: 2 })
    expect(saves).toHaveLength(2)
    expect([...files.keys()].map((p) => p.split('/').pop()).sort()).toEqual([
      'iron_ore.png',
      'iron_pickaxe.png',
      'stone.png'
    ])
    expect(toHex(getPixel(decodePng(files.get(P('block', 'stone'))!), 0, 0))).toBe('#c00000ff')
  })

  it('refuses an unknown pack and reports an empty pack', async () => {
    const { agent } = setup()
    await expect(
      agent.sendCreation({
        packId: 'nope',
        message: 'x',
        model: { providerId: 'fake', modelId: 'm1' },
        language: 'en'
      })
    ).rejects.toMatchObject({ code: 'packs.notFound' })
  })
})
