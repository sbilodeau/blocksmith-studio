import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, ItemAgentRequest, ItemDefinitionProposal } from '@shared/ai/types'
import { CustomItemSchema, type CustomItem } from '@shared/items'
import { createImage, encodePng, setPixel } from '@shared/image'
import { itemChangesBetween } from '@shared/ai/item-changes'
import { DONE_END, DONE_TOOLS, fakeProvider, seqIds, text, toolCall } from './ai-agent-fakes'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

const { createEditorAgentService, createConversationStore, ITEM_AGENT_TOOLS, checkDefinition } =
  await import('../../src/main/services/ai/agent')
const { createBriefService } = await import('../../src/main/services/brief')

const SWORD: CustomItem = CustomItemSchema.parse({
  schemaVersion: 1,
  id: 'ruby_sword',
  namespace: 'gems',
  kind: 'weapon',
  base: 'minecraft:stone_sword',
  names: { en_us: 'Ruby Sword', fr_fr: 'Épée en rubis' },
  handheld: true,
  durability: 1561,
  weapon: { attackDamage: 7, attackSpeed: 1.6 },
  recipe: {
    type: 'shaped',
    grid: [
      null,
      'minecraft:redstone',
      null,
      null,
      'minecraft:redstone',
      null,
      null,
      'minecraft:stick',
      null
    ],
    count: 1
  }
})
const RUBY: CustomItem = CustomItemSchema.parse({
  schemaVersion: 1,
  id: 'ruby',
  namespace: 'gems',
  kind: 'simple',
  base: 'minecraft:poisonous_potato',
  names: { en_us: 'Ruby', fr_fr: 'Rubis' }
})

const TEXTURE = 'assets/gems/textures/item/ruby_sword.png'
const png = (() => {
  const img = createImage(2, 2, [0, 0, 0, 0])
  setPixel(img, 0, 0, [255, 0, 0, 255])
  return encodePng(img)
})()

const items = {
  all: async () => [SWORD, RUBY],
  catalog: async () => ({
    version: '26.3',
    items: [
      { id: 'minecraft:stone_sword', name: 'Stone Sword' },
      { id: 'minecraft:redstone', name: 'Redstone Dust' },
      { id: 'minecraft:stick', name: 'Stick' },
      { id: 'minecraft:emerald', name: 'Emerald' }
    ],
    tags: ['#minecraft:planks']
  }),
  context: async (_p: string, base: string) => ({
    baseRecipeUses: base === 'minecraft:stone_sword' ? ['minecraft:example_recipe'] : []
  }),
  forTexture: async (_p: string, path: string) => (path === TEXTURE ? SWORD : null),
  readPng: async (_p: string, path: string) => (path === TEXTURE ? png : null)
}

const dataAi = {
  meta: async () => ({ name: 'Gems', kind: 'combined' as const, authoringVersion: '26.3' }),
  vanillaText: async () => null,
  packText: async () => null,
  ids: async () => ({ items: ['minecraft:stick'], blocks: [], tags: {} }),
  names: async () => ({}),
  entries: async () => []
}

function request(message: string, item: Record<string, unknown> = { ...SWORD }): ItemAgentRequest {
  return {
    packId: 'p1',
    id: 'ruby_sword',
    item,
    message,
    model: { providerId: 'fake', modelId: 'm1' },
    language: 'fr'
  }
}

const strongSword = { ...SWORD, weapon: { attackDamage: 9, attackSpeed: 1.6 } }

describe('item agent', () => {
  let folder: string
  let events: AgentEvent[]

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'blocksmith-item-agent-'))
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
      items,
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

  it('sends the item with its context, refuses an invalid definition, and proposes the fixed one', async () => {
    const { agent, fake } = service([
      [
        toolCall('get_texture', {}),
        toolCall('edit_item', { item: { ...SWORD, weapon: { attackDamage: 9 } } }),
        DONE_TOOLS
      ],
      [toolCall('edit_item', { item: strongSword }), DONE_TOOLS],
      [text("L'épée fait maintenant 9 de dégâts."), DONE_END]
    ])
    const { runId } = await agent.sendItem(request('fais 9 de dégâts'))
    await agent.idle()

    const first = fake.requests[0]!
    expect(first.tools!.map((t) => t.name)).toEqual(ITEM_AGENT_TOOLS)
    expect(first.messages[0]!.text).toContain('Reply in French')
    expect(first.messages[0]!.text).toContain('Custom item definition')
    const user = first.messages.at(-1)!.text!
    expect(user).toContain('[Open item]')
    expect(user).toContain(
      'Item: "Ruby Sword" (gems:ruby_sword), saved as "ruby_sword". Saved in the pack.'
    )
    expect(user).toContain('"attackDamage": 7')
    expect(user).toContain('CHECKS (by the app): no problem found.')
    expect(user).toContain('- data/gems/recipe/ruby_sword.json')
    expect(user).toContain('/function gems:give/ruby_sword')
    expect(user).toContain('BASE ITEM: minecraft:stone_sword (Stone Sword)')
    expect(user).toContain('minecraft:example_recipe')
    expect(user).toContain('- minecraft:redstone = Redstone Dust')
    expect(user).toContain('- ruby: Ruby (simple, base minecraft:poisonous_potato)')
    expect(user).toMatch(/User request:\nfais 9 de dégâts$/)

    const [texture, refused] = results(fake, 1)
    expect(texture!.result).toMatchObject({
      path: TEXTURE,
      grid: { w: 2, h: 2, rows: ['a.', '..'] }
    })
    expect(refused).toMatchObject({ ok: false })
    expect(refused!.error).toContain('weapon.attackSpeed')

    const proposal = events.find((e) => e.type === 'proposal')
    expect(proposal).toMatchObject({ runId, type: 'proposal' })
    const p = (proposal as { proposal: ItemDefinitionProposal }).proposal
    expect(p).toMatchObject({
      agent: 'item',
      kind: 'item',
      packId: 'p1',
      itemId: 'ruby_sword',
      after: strongSword,
      unknownIds: [],
      status: 'pending'
    })
    expect(itemChangesBetween(p.before, p.after)).toEqual([
      { field: 'attackDamage', before: 7, after: 9 }
    ])
    expect(events.at(-1)).toEqual({ runId, type: 'done', reason: 'end' })

    // The conversation is kept per pack, each message tagged with its item.
    const lines = (
      await readFile(join(folder, '.blocksmith', 'conversations', 'item.jsonl'), 'utf8')
    )
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l))
    expect(lines[0]).toMatchObject({ role: 'user', itemId: 'ruby_sword' })
    expect(lines.at(-1)).toMatchObject({ role: 'assistant', proposalId: p.id })
  })

  it('reports unsaved and invalid drafts, keeps history, and checks renames and names', async () => {
    const draft = { ...SWORD, weapon: { attackDamage: 7 } }
    const { agent, fake } = service([
      [text("L'épée fait 7 de dégâts."), DONE_END],
      [
        toolCall('edit_item', {
          item: { ...SWORD, id: 'ruby', names: { en_us: 'Ruby', fr_fr: 'Rubis' } }
        }),
        toolCall('edit_item', {
          item: { ...SWORD, id: 'ruby_blade', names: { en_us: 'Ruby Blade' } }
        }),
        toolCall('edit_item', { item: { ...SWORD, namespace: 'other' } }),
        // The definition itself instead of {"item": ...} is accepted.
        toolCall('edit_item', {
          ...SWORD,
          id: 'ruby_blade',
          names: { en_us: 'Ruby Blade', fr_fr: 'Lame de rubis' },
          recipe: { type: 'shapeless', ingredients: ['minecraft:ruby'], count: 1 }
        }),
        DONE_TOOLS
      ],
      [text('Renommée.'), DONE_END]
    ])
    await agent.sendItem(request('combien de dégâts ?', draft))
    await agent.idle()
    const user = fake.requests[0]!.messages.at(-1)!.text!
    expect(user).toContain('The form has unsaved edits')
    expect(user).toContain('the definition is NOT valid')
    expect(user).toContain('weapon.attackSpeed')
    expect(events.some((e) => e.type === 'proposal')).toBe(false)

    events = []
    await agent.sendItem(request('renomme-le en Lame de rubis'))
    await agent.idle()
    const [taken, noFrench, namespace] = results(fake, 2)
    expect(taken!.error).toContain('already has another item "ruby"')
    expect(noFrench!.error).toContain('fr_fr')
    expect(namespace!.error).toContain('namespace')
    const p = events.find((e) => e.type === 'proposal') as { proposal: ItemDefinitionProposal }
    expect(p.proposal.after).toMatchObject({ id: 'ruby_blade' })
    expect(p.proposal.unknownIds).toEqual(['minecraft:ruby'])
    // The earlier exchange is replayed, tagged with its item.
    expect(fake.requests[1]!.messages[1]).toMatchObject({
      role: 'user',
      text: '[Item: ruby_sword] combien de dégâts ?'
    })
  })

  it('makes no proposal when the definition does not change, and refuses unknown packs', async () => {
    const { agent } = service([
      [toolCall('edit_item', { item: { ...SWORD } }), DONE_TOOLS],
      [DONE_END]
    ])
    await agent.sendItem(request('reformate'))
    await agent.idle()
    expect(events.some((e) => e.type === 'proposal')).toBe(false)
    await expect(agent.sendItem({ ...request('x'), packId: 'nope' })).rejects.toMatchObject({
      code: 'packs.notFound'
    })
  })

  it('explains the item in one answer without tools', async () => {
    const { agent, fake } = service([
      [text('Une épée un peu plus forte que le diamant.'), DONE_END]
    ])
    const { runId } = await agent.sendItemExplain({
      packId: 'p1',
      id: 'ruby_sword',
      item: { ...SWORD },
      model: { providerId: 'fake', modelId: 'm1' },
      language: 'en'
    })
    await agent.idle()
    expect(fake.requests).toHaveLength(1)
    expect(fake.requests[0]!.tools).toEqual([])
    expect(fake.requests[0]!.messages[0]!.text).toContain('Reply in English')
    expect(fake.requests[0]!.messages[1]!.text).toContain('HOW TO GET IT: crafting')
    expect(fake.requests[0]!.messages[1]!.text).toMatch(/Explain this item in English/)
    expect(events[0]).toMatchObject({ runId, type: 'started', agent: 'explain' })
    expect(events.at(-1)).toEqual({ runId, type: 'done', reason: 'end' })
  })

  it('names the custom item of the open texture to the editor agent', async () => {
    const { agent, fake } = service([[text('ok'), DONE_END]])
    await agent.send({
      packId: 'p1',
      message: 'plus rouge',
      model: { providerId: 'fake', modelId: 'm1' },
      texture: { path: TEXTURE, png },
      language: 'fr'
    })
    await agent.idle()
    expect(fake.requests[0]!.messages.at(-1)!.text).toContain(
      `[Open texture: ${TEXTURE} (2 x 2 px)]\n[Custom item: Ruby Sword (weapon, base minecraft:stone_sword)]`
    )
  })
})

describe('checkDefinition', () => {
  it('fills defaults, warns about unknown ids and requires both names for a new item', () => {
    const known = { items: new Set(['minecraft:stone_sword']), tags: new Set(['minecraft:planks']) }
    const raw = {
      schemaVersion: 1,
      id: 'oak_club',
      namespace: 'gems',
      kind: 'weapon',
      base: 'minecraft:stone_sword',
      names: { en_us: 'Oak Club' },
      weapon: { attackDamage: 5, attackSpeed: 1 },
      recipe: { type: 'shapeless', ingredients: ['#minecraft:planks', '#minecraft:logs'] }
    }
    expect(checkDefinition(raw, { previous: null, taken: new Set(), known }).error).toContain(
      'fr_fr'
    )
    const ok = checkDefinition(
      { ...raw, names: { en_us: 'Oak Club', fr_fr: 'Massue en chêne' } },
      { previous: null, taken: new Set(), known }
    )
    expect(ok.item).toMatchObject({ handheld: false, lore: [], recipe: { count: 1 } })
    expect(ok.unknownIds).toEqual(['#minecraft:logs'])
    // An English-only item keeps working when the change does not touch its name.
    const english = { ...raw, names: { en_us: 'Oak Club' } }
    expect(
      checkDefinition(
        { ...english, weapon: { attackDamage: 6, attackSpeed: 1 } },
        { previous: CustomItemSchema.parse(english), taken: new Set(), known: null }
      ).item
    ).toBeDefined()
  })
})
