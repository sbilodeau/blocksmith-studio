import { describe, expect, it, vi } from 'vitest'
import { emptyBrief } from '@shared/model/brief'
import type { DataEntry } from '@shared/model/data'
import type { AgentSettings, CreationAgentRequest } from '@shared/ai/types'
import { DONE_END, DONE_TOOLS, fakeProvider, seqIds, text, toolCall } from './ai-agent-fakes'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

const { creationTools, runCreationAgent } =
  await import('../../src/main/services/ai/agent/creation')
const { buildSystemPrompt } = await import('../../src/main/services/ai/agent/prompts')

const LOOT = 'data/minecraft/loot_table/blocks/diamond_ore.json'
const LOOT_TEXT = JSON.stringify({
  type: 'minecraft:block',
  pools: [{ rolls: 1, entries: [{ type: 'minecraft:item', name: 'minecraft:diamond' }] }]
})

const ENTRIES: DataEntry[] = [
  {
    path: LOOT,
    namespace: 'minecraft',
    kind: 'loot_table',
    id: 'minecraft:blocks/diamond_ore',
    status: 'vanilla'
  },
  {
    path: 'data/minecraft/recipe/oak_planks.json',
    namespace: 'minecraft',
    kind: 'recipe',
    id: 'minecraft:oak_planks',
    status: 'vanilla'
  },
  {
    path: 'data/hot/recipe/ruby.json',
    namespace: 'hot',
    kind: 'recipe',
    id: 'hot:ruby',
    status: 'added'
  }
]

const SETTINGS: AgentSettings = { thinking: 'off', maxIterations: 8, imageMode: 'grid' }

function request(message: string): CreationAgentRequest {
  return { packId: 'p1', message, model: { providerId: 'fake', modelId: 'm1' }, language: 'en' }
}

async function run(
  scripts: Parameters<typeof fakeProvider>[0],
  kind: 'data' | 'combined' = 'data'
): Promise<{
  result: Awaited<ReturnType<typeof runCreationAgent>>
  fake: ReturnType<typeof fakeProvider>
}> {
  const fake = fakeProvider(scripts)
  const result = await runCreationAgent(
    {
      runId: 'r1',
      request: request('diamond ore drops two diamonds'),
      textures: [],
      samples: [],
      pack: { name: 'Hot data', description: '', kind },
      data: {
        entries: ENTRIES,
        ids: {
          items: ['minecraft:diamond', 'minecraft:saddle', 'minecraft:leather'],
          blocks: [],
          tags: {}
        },
        read: async (path) => (path === LOOT ? LOOT_TEXT : null)
      },
      settings: SETTINGS,
      brief: emptyBrief(),
      history: []
    },
    { providers: fake.providers, newId: seqIds(), now: () => new Date('2026-11-16T10:00:00Z') },
    () => undefined,
    new AbortController().signal
  )
  return { result, fake }
}

/** Tool results the model received, parsed. */
function toolResults(fake: ReturnType<typeof fakeProvider>, request: number): unknown[] {
  return fake.requests[request]!.messages.filter((m) => m.role === 'tool').map((m) =>
    JSON.parse(m.text!)
  )
}

describe('creation agent on data packs', () => {
  it('offers tools by pack kind', () => {
    expect(creationTools('resource').map((t) => t.name)).toEqual([
      'apply_to_all',
      'list_textures',
      'set_pack_meta',
      'update_style_brief'
    ])
    expect(creationTools('data').map((t) => t.name)).toEqual([
      'list_data',
      'read_json',
      'write_json',
      'set_pack_meta',
      'update_style_brief'
    ])
    expect(creationTools('combined').map((t) => t.name)).toEqual([
      'apply_to_all',
      'list_textures',
      'list_data',
      'read_json',
      'write_json',
      'list_items',
      'read_item',
      'write_item',
      'delete_item',
      'set_pack_meta',
      'update_style_brief'
    ])
    expect(
      buildSystemPrompt({
        agent: 'creation',
        language: 'fr',
        brief: emptyBrief(),
        pack: { count: 0, kind: 'data' }
      })
    ).toContain('This is a DATA PACK')
    expect(
      buildSystemPrompt({
        agent: 'creation',
        language: 'en',
        brief: emptyBrief(),
        pack: { count: 3, kind: 'combined' }
      })
    ).toContain('ALSO holds data files')
  })

  it('lists and reads data, then proposes a checked file as a plan step', async () => {
    const changed = {
      type: 'minecraft:block',
      pools: [
        {
          rolls: 1,
          entries: [
            {
              type: 'minecraft:item',
              name: 'minecraft:diamond',
              functions: [{ function: 'minecraft:set_count', count: 2 }]
            }
          ]
        }
      ]
    }
    const { result, fake } = await run([
      [
        toolCall('list_data', { kind: 'loot_table', match: '*diamond*' }),
        toolCall('read_json', { path: LOOT }),
        DONE_TOOLS
      ],
      [toolCall('write_json', { path: LOOT, json: changed }), DONE_TOOLS],
      [text('Done.'), DONE_END]
    ])
    // The user message describes the data pack, without textures.
    const user = fake.requests[0]!.messages.find((m) => m.role === 'user')!.text!
    expect(user).toContain('DATA PACK')
    expect(user).toContain('data/hot/recipe/ruby.json (added)')
    expect(fake.requests[0]!.tools!.map((t) => t.name)).not.toContain('apply_to_all')

    const [listed, read] = toolResults(fake, 1) as Array<{
      ok: boolean
      result: Record<string, unknown>
    }>
    expect(listed!.result).toEqual({ count: 1, files: [LOOT] })
    expect(read!.result).toEqual({ path: LOOT, text: LOOT_TEXT })

    expect(result.steps).toHaveLength(1)
    expect(result.steps[0]).toMatchObject({
      tool: 'write_json',
      kind: 'mutate',
      description: { key: 'ops.writeJson', params: { path: LOOT } },
      json: {
        path: LOOT,
        previous: LOOT_TEXT,
        warnings: 0,
        text: `${JSON.stringify(changed, null, 2)}\n`
      }
    })
  })

  it('refuses invalid files with the reasons, keeps warnings, and replaces a rewritten file', async () => {
    const path = 'data/hot/recipe/saddle.json'
    const { result, fake } = await run([
      [
        toolCall('write_json', {
          path,
          json: { type: 'minecraft:crafting_shaped', pattern: ['LL'], key: {} }
        }),
        toolCall('write_json', { path: 'data/hot/Recipe/x.json', json: {} }),
        toolCall('write_json', {
          path,
          json: {
            type: 'minecraft:crafting_shapeless',
            ingredients: ['minecraft:leatherr'],
            result: { id: 'minecraft:saddle' }
          }
        }),
        DONE_TOOLS
      ],
      [
        toolCall('write_json', {
          path,
          json: {
            type: 'minecraft:crafting_shapeless',
            ingredients: ['minecraft:leather'],
            result: { id: 'minecraft:saddle' }
          }
        }),
        toolCall('read_json', { path }),
        DONE_TOOLS
      ],
      [text('Done.'), DONE_END]
    ])
    const first = toolResults(fake, 1) as Array<{
      ok: boolean
      error?: string
      result?: { warnings?: string }
    }>
    expect(first[0]).toMatchObject({
      ok: false,
      error: expect.stringContaining('nothing was planned')
    })
    expect(first[0]!.error).toContain('required {"key":"result"} at result')
    expect(first[1]).toMatchObject({ ok: false, error: expect.stringContaining('Invalid path') })
    expect(first[2]).toMatchObject({
      ok: true,
      result: { warnings: expect.stringContaining('unknownItem') }
    })
    // The second valid write replaced the first step; read_json returns the planned text.
    expect(result.steps).toHaveLength(1)
    expect(result.steps[0]!.json).toMatchObject({ path, previous: null, warnings: 0 })
    expect(result.steps[0]!.description.key).toBe('ops.writeJsonNew')
    const read = toolResults(fake, 2).at(-1) as { result: { text: string } }
    expect(read.result.text).toContain('minecraft:leather"')
  })
})
