import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, DataAgentRequest, DataFileProposal } from '@shared/ai/types'
import type { DataEntry } from '@shared/model/data'
import { DONE_END, DONE_TOOLS, fakeProvider, seqIds, text, toolCall } from './ai-agent-fakes'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

const { createEditorAgentService, createConversationStore, DATA_AGENT_TOOLS } =
  await import('../../src/main/services/ai/agent')
const { createBriefService } = await import('../../src/main/services/brief')

const LOOT = 'data/minecraft/loot_table/entities/skeleton.json'
const TAG = 'data/minecraft/tags/item/arrows.json'

const vanillaLoot = {
  type: 'minecraft:entity',
  pools: [
    {
      rolls: 1,
      entries: [
        {
          type: 'minecraft:item',
          name: 'minecraft:arrow',
          functions: [
            {
              function: 'minecraft:set_count',
              count: { type: 'minecraft:uniform', min: 0, max: 2 }
            }
          ]
        }
      ]
    }
  ]
}
const moreArrows = structuredClone(vanillaLoot)
moreArrows.pools[0]!.entries[0]!.functions[0]!.count = { type: 'minecraft:uniform', min: 2, max: 4 }

const ENTRIES: DataEntry[] = [
  {
    path: LOOT,
    namespace: 'minecraft',
    kind: 'loot_table',
    id: 'minecraft:entities/skeleton',
    status: 'vanilla'
  },
  { path: TAG, namespace: 'minecraft', kind: 'tag', id: 'minecraft:arrows', status: 'vanilla' }
]
const VANILLA: Record<string, string> = {
  [LOOT]: JSON.stringify(vanillaLoot, null, 2),
  [TAG]: JSON.stringify({ values: ['minecraft:arrow', 'minecraft:tipped_arrow'] })
}

const dataAi = {
  meta: async () => ({ name: 'Bones', kind: 'data' as const, authoringVersion: '26.3' }),
  vanillaText: async (_: string, path: string) => VANILLA[path] ?? null,
  packText: async () => null,
  ids: async () => ({ items: ['minecraft:arrow', 'minecraft:bone'], blocks: [], tags: {} }),
  names: async () => ({ 'minecraft:arrow': 'Arrow' }),
  entries: async () => ENTRIES
}

function request(message: string, path = LOOT, body = VANILLA[LOOT]!): DataAgentRequest {
  return {
    packId: 'p1',
    message,
    model: { providerId: 'fake', modelId: 'm1' },
    path,
    text: body,
    language: 'fr'
  }
}

describe('data agent', () => {
  let folder: string
  let events: AgentEvent[]

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'blocksmith-data-agent-'))
    events = []
  })
  afterEach(() => rm(folder, { recursive: true, force: true }))

  function service(scripts: Parameters<typeof fakeProvider>[0]): {
    agent: ReturnType<typeof createEditorAgentService>
    fake: ReturnType<typeof fakeProvider>
  } {
    const fake = fakeProvider(scripts)
    const locate = async (id: string): Promise<{ folder: string } | null> =>
      id === 'p1' ? { folder } : null
    const agent = createEditorAgentService({
      providers: fake.providers,
      getAgentSettings: () => ({ thinking: 'off', maxIterations: 6, imageMode: 'grid' }),
      packs: { locate },
      brief: createBriefService({ locate }),
      conversations: createConversationStore({ locate }),
      readVanillaPng: async () => null,
      dataAi,
      emit: (e) => events.push(e),
      newId: seqIds()
    })
    return { agent, fake }
  }

  const results = (
    fake: ReturnType<typeof fakeProvider>,
    n: number
  ): Array<{ ok: boolean; error?: string; result?: Record<string, unknown> }> =>
    fake.requests[n]!.messages.filter((m) => m.role === 'tool').map((m) => JSON.parse(m.text!))

  it('sends the open file with its context, refuses an invalid edit, and proposes the fixed file', async () => {
    const { agent, fake } = service([
      [
        toolCall('read_json', { path: TAG }),
        toolCall('edit_file', { json: { type: 'minecraft:entity', pools: [{ rolls: 1 }] } }),
        DONE_TOOLS
      ],
      [toolCall('edit_file', { json: moreArrows }), DONE_TOOLS],
      [text('Le squelette laisse maintenant 2 à 4 flèches.'), DONE_END]
    ])
    const { runId } = await agent.sendData(request('fais tomber 2 à 4 flèches'))
    await agent.idle()

    const first = fake.requests[0]!
    expect(first.tools!.map((t) => t.name)).toEqual(DATA_AGENT_TOOLS)
    expect(first.messages[0]!.text).toContain('Reply in French')
    expect(first.messages[0]!.text).toContain('Loot tables:')
    const user = first.messages.at(-1)!.text!
    expect(user).toContain('[Open file]')
    expect(user).toContain(`File: ${LOOT}`)
    expect(user).toContain('IDENTICAL to vanilla')
    expect(user).toContain('- minecraft:arrow = Arrow')
    expect(user).toMatch(/User request:\nfais tomber 2 à 4 flèches$/)

    const [read, refused] = results(fake, 1)
    expect(read!.result).toMatchObject({ path: TAG })
    expect(refused).toMatchObject({ ok: false })
    expect(refused!.error).toContain('Minecraft would reject this file')
    expect(refused!.error).toContain('entries')

    const proposal = events.find((e) => e.type === 'proposal')
    expect(proposal).toMatchObject({ runId, type: 'proposal' })
    const p = (proposal as { proposal: DataFileProposal }).proposal
    expect(p).toMatchObject({
      agent: 'data',
      kind: 'file',
      packId: 'p1',
      path: LOOT,
      before: VANILLA[LOOT],
      after: `${JSON.stringify(moreArrows, null, 2)}\n`,
      warnings: 0,
      status: 'pending'
    })
    expect(events.at(-1)).toEqual({ runId, type: 'done', reason: 'end' })

    // The conversation is kept per pack, each message tagged with its file.
    const lines = (
      await readFile(join(folder, '.blocksmith', 'conversations', 'data.jsonl'), 'utf8')
    )
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l))
    expect(lines[0]).toMatchObject({ role: 'user', dataPath: LOOT })
    expect(lines.at(-1)).toMatchObject({ role: 'assistant', proposalId: p.id })
    expect(await agent.conversation('p1', 'data')).toHaveLength(lines.length)
  })

  it('answers questions without a proposal, edits function files as text, keeps history', async () => {
    const fn = 'data/bones/function/start.mcfunction'
    const { agent, fake } = service([
      [text('Elle laisse 0 à 2 flèches.'), DONE_END],
      [toolCall('edit_file', { json: {} }), toolCall('edit_file', { text: 'say hi' }), DONE_TOOLS],
      [text('Fait.'), DONE_END]
    ])
    await agent.sendData(request('combien de flèches ?'))
    await agent.idle()
    expect(events.some((e) => e.type === 'proposal')).toBe(false)

    events = []
    await agent.sendData(request('ajoute un message', fn, ''))
    await agent.idle()
    expect(results(fake, 2)[0]).toMatchObject({
      ok: false,
      error: expect.stringContaining('"text"')
    })
    const p = events.find((e) => e.type === 'proposal') as { proposal: DataFileProposal }
    expect(p.proposal).toMatchObject({ path: fn, after: 'say hi\n' })
    // The earlier exchange is replayed, tagged with its file.
    const messages = fake.requests[1]!.messages
    expect(messages[1]).toMatchObject({
      role: 'user',
      text: `[File: ${LOOT}] combien de flèches ?`
    })
    expect(messages[2]).toMatchObject({ role: 'assistant', text: 'Elle laisse 0 à 2 flèches.' })
  })

  it('makes no proposal when the edit equals the editor text, and refuses unknown packs', async () => {
    const { agent } = service([
      [toolCall('edit_file', { json: vanillaLoot }), DONE_TOOLS],
      [DONE_END]
    ])
    await agent.sendData(request('reformate', LOOT, `${JSON.stringify(vanillaLoot, null, 2)}\n`))
    await agent.idle()
    expect(events.some((e) => e.type === 'proposal')).toBe(false)
    await expect(agent.sendData({ ...request('x'), packId: 'nope' })).rejects.toMatchObject({
      code: 'packs.notFound'
    })
  })
})
