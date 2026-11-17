import { describe, expect, it, vi } from 'vitest'
import { formatChanges, jsonChanges, pathText, referencedIds, tagEffect } from '@shared/datapack'
import type { AgentEvent, DataExplainRequest } from '@shared/ai/types'
import { DONE_END, DONE_TOOLS, fakeProvider, seqIds, text, toolCall } from './ai-agent-fakes'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

const { buildExplainMessages, gatherExplainSources } =
  await import('../../src/main/services/ai/agent/explain')
const { createEditorAgentService, createConversationStore } =
  await import('../../src/main/services/ai/agent')
const { createBriefService } = await import('../../src/main/services/brief')
const { namesFromLang } = await import('../../src/main/services/packs/data')

const RECIPE = 'data/minecraft/recipe/stone_slab.json'
const TAG = 'data/minecraft/tags/item/stone_tool_materials.json'
const LOOT = 'data/minecraft/loot_table/blocks/diamond_ore.json'

const vanillaRecipe = {
  type: 'minecraft:crafting_shaped',
  key: { '#': 'minecraft:stone' },
  pattern: ['###'],
  result: { count: 6, id: 'minecraft:stone_slab' }
}
const vanillaTag = { values: ['minecraft:cobblestone', 'minecraft:blackstone'] }

/** Vanilla files and pack files of a fake data pack on 26.3. */
const VANILLA: Record<string, string> = {
  [RECIPE]: JSON.stringify(vanillaRecipe, null, 2),
  [TAG]: JSON.stringify(vanillaTag, null, 2),
  'data/minecraft/tags/item/planks.json': JSON.stringify({
    values: ['minecraft:oak_planks', 'minecraft:spruce_planks']
  })
}
const PACK: Record<string, string> = {
  // The pack adds one more plank to the vanilla tag.
  'data/minecraft/tags/item/planks.json': JSON.stringify({ values: ['minecraft:bamboo_planks'] })
}

const deps = {
  meta: async () => ({ name: 'Slabs', kind: 'data' as const, authoringVersion: '26.3' }),
  vanillaText: async (_: string, path: string) => VANILLA[path] ?? null,
  packText: async (_: string, path: string) => PACK[path] ?? null,
  ids: async () => ({
    items: ['minecraft:stone', 'minecraft:stone_slab', 'minecraft:oak_planks'],
    blocks: [],
    tags: { item: ['minecraft:planks', 'minecraft:stone_tool_materials'] }
  }),
  names: async () => ({
    'minecraft:stone': 'Stone',
    'minecraft:stone_slab': 'Stone Slab',
    'minecraft:oak_planks': 'Oak Planks',
    'minecraft:bamboo_planks': 'Bamboo Planks'
  })
}

function request(path: string, json: unknown, language: 'en' | 'fr' = 'fr'): DataExplainRequest {
  return {
    packId: 'p1',
    path,
    text: typeof json === 'string' ? json : JSON.stringify(json),
    model: { providerId: 'fake', modelId: 'm1' },
    language
  }
}

async function messagesFor(req: DataExplainRequest): Promise<{ system: string; user: string }> {
  const [system, user] = buildExplainMessages(await gatherExplainSources(req, deps), req.language)
  return { system: system!.text!, user: user!.text! }
}

describe('data diff helpers', () => {
  it('lists changes key by key, plain lists as sets', () => {
    const changes = jsonChanges(vanillaRecipe, {
      ...vanillaRecipe,
      pattern: ['## '],
      result: { id: 'minecraft:stone_slab', count: 3 },
      group: 'slabs'
    })
    expect(formatChanges(changes).split('\n')).toEqual([
      '- pattern[0]: "###" -> "## "',
      '- result.count: 6 -> 3',
      '- group: added "slabs"'
    ])
    expect(
      jsonChanges({ values: ['a:x', 'a:y'] }, { values: ['a:y', 'a:z', 'a:w'] }).map((c) => [
        c.kind,
        c.before ?? c.after
      ])
    ).toEqual([
      ['removed', 'a:x'],
      ['added', 'a:z'],
      ['added', 'a:w']
    ])
    expect(jsonChanges({ a: 1 }, { a: 1 })).toEqual([])
    expect(pathText([])).toBe('(whole file)')
    expect(pathText(['pools', 0, 'entries', 1, 'name'])).toBe('pools[0].entries[1].name')
  })

  it('works out what a tag file really changes in game', () => {
    // Without replace, deleting a vanilla value changes nothing.
    expect(
      tagEffect(vanillaTag, { values: ['minecraft:cobblestone', 'minecraft:andesite'] })
    ).toEqual({
      replace: false,
      effective: ['minecraft:cobblestone', 'minecraft:blackstone', 'minecraft:andesite'],
      added: ['minecraft:andesite'],
      removed: [],
      stillIncluded: ['minecraft:blackstone']
    })
    expect(
      tagEffect(vanillaTag, { replace: true, values: [{ id: 'minecraft:cobblestone' }] })
    ).toMatchObject({ effective: ['minecraft:cobblestone'], removed: ['minecraft:blackstone'] })
  })

  it('finds the ids and tags a file names, and English names in en_us.json', () => {
    expect(
      referencedIds({
        key: { '#': '#minecraft:planks' },
        result: { id: 'minecraft:stick' },
        x: 'not an id'
      })
    ).toEqual(['#minecraft:planks', 'minecraft:stick'])
    expect(
      namesFromLang({
        'block.minecraft.stone': 'Stone',
        'item.minecraft.wheat_seeds': 'Wheat Seeds',
        'block.minecraft.wheat_seeds': 'ignored',
        'block.minecraft.stone.desc': 'not a name',
        'gui.done': 'Done'
      })
    ).toEqual({ 'minecraft:wheat_seeds': 'Wheat Seeds', 'minecraft:stone': 'Stone' })
  })
})

describe('explanation context', () => {
  it('sends a changed vanilla recipe with both texts, the changes, the checks and the names', async () => {
    const { system, user } = await messagesFor(
      request(RECIPE, { ...vanillaRecipe, result: { id: 'minecraft:stone_slab', count: 3 } })
    )
    expect(system).toContain('Reply in French')
    expect(system).toContain('"crafting_shaped": "pattern" rows')
    expect(system).not.toContain('Loot tables:')
    expect(user).toContain('Minecraft version: 26.3')
    expect(user).toContain('This file REPLACES the vanilla recipe minecraft:stone_slab')
    expect(user).toContain('ORIGINAL (vanilla 26.3) FILE:')
    expect(user).toContain('"count": 6')
    expect(user).toContain('- result.count: 6 -> 3')
    expect(user).toContain('CHECKS (by the app): no problem found.')
    expect(user).toContain('- minecraft:stone_slab = Stone Slab')
    expect(user).toContain('The edits are not saved yet')
  })

  it('reports errors, says when the file equals vanilla, and handles new files', async () => {
    const broken = await messagesFor(
      request(RECIPE, { type: 'minecraft:crafting_shaped', pattern: ['###'], key: {} })
    )
    expect(broken.user).toContain('Minecraft will not load the file')
    expect(broken.user).toContain('required {"key":"result"} at result')

    const same = await messagesFor(request(RECIPE, vanillaRecipe, 'en'))
    expect(same.system).toContain('Reply in English')
    expect(same.user).toContain('IDENTICAL to vanilla')
    expect(same.user).not.toContain('CHANGES FROM THE ORIGINAL')

    const added = await messagesFor(
      request('data/slabs/recipe/ruby.json', {
        type: 'minecraft:crafting_shapeless',
        ingredients: ['#minecraft:planks'],
        result: { id: 'minecraft:stone' }
      })
    )
    expect(added.user).toContain('NEW file in the pack\'s own namespace "slabs"')
    expect(added.user).not.toContain('ORIGINAL')
    // The tag's content in game: vanilla's values plus the pack's addition.
    expect(added.user).toContain(
      '- #minecraft:planks (item, 3 ids): minecraft:oak_planks, minecraft:spruce_planks, minecraft:bamboo_planks'
    )
    expect(added.user).toContain('- minecraft:bamboo_planks = Bamboo Planks')

    const syntax = await messagesFor(request(RECIPE, '{"type": '))
    expect(syntax.user).toContain('syntax')
    expect(syntax.user).toContain('{"type": ')
  })

  it('tells the model when a tag edit has no effect in game', async () => {
    const { user, system } = await messagesFor(
      request(TAG, { values: ['minecraft:cobblestone', 'minecraft:andesite'] })
    )
    expect(system).toContain('Tags:')
    expect(user).toContain('Id: #minecraft:stone_tool_materials')
    expect(user).toContain('- Ids the game gains: minecraft:andesite')
    expect(user).toContain(
      'Removed from the file but STILL in the tag in game (no "replace": true, so vanilla\'s values stay): minecraft:blackstone'
    )
  })

  it('sends function files as text, unchecked', async () => {
    const { user, system } = await messagesFor(
      request('data/slabs/function/start.mcfunction', 'say hi\n')
    )
    expect(system).toContain('Functions (.mcfunction)')
    expect(user).toContain('```mcfunction\nsay hi')
    expect(user).toContain('function files are not checked')
  })
})

describe('explain runs', () => {
  function service(scripts: Parameters<typeof fakeProvider>[0]): {
    agent: ReturnType<typeof createEditorAgentService>
    fake: ReturnType<typeof fakeProvider>
    events: AgentEvent[]
  } {
    const fake = fakeProvider(scripts)
    const events: AgentEvent[] = []
    const locate = async (id: string): Promise<{ folder: string } | null> =>
      id === 'p1' ? { folder: '/nowhere' } : null
    const agent = createEditorAgentService({
      providers: fake.providers,
      getAgentSettings: () => ({ thinking: 'off', maxIterations: 6, imageMode: 'grid' }),
      packs: { locate },
      brief: createBriefService({ locate }),
      conversations: createConversationStore({ locate }),
      readVanillaPng: async () => null,
      explain: deps,
      emit: (e) => events.push(e),
      newId: seqIds()
    })
    return { agent, fake, events }
  }

  it('streams one answer without tools', async () => {
    const { agent, fake, events } = service([
      [text('Une dalle de pierre '), text('donne 3 dalles.'), DONE_END]
    ])
    const { runId } = await agent.sendExplain(request(LOOT, { type: 'minecraft:block', pools: [] }))
    await agent.idle()
    expect(fake.requests).toHaveLength(1)
    expect(fake.requests[0]!.tools).toEqual([])
    expect(fake.requests[0]!.messages.map((m) => m.role)).toEqual(['system', 'user'])
    expect(fake.requests[0]!.messages[0]!.text).toContain('Loot tables:')
    expect(events.map((e) => e.type)).toEqual(['started', 'text', 'text', 'done'])
    expect(events[0]).toMatchObject({ runId, agent: 'explain' })
    expect(events.at(-1)).toEqual({ runId, type: 'done', reason: 'end' })
  })

  it('ends after one answer even when the model asks for a tool, and refuses unknown packs', async () => {
    const { agent, fake, events } = service([[toolCall('read_json', { path: RECIPE }), DONE_TOOLS]])
    await agent.sendExplain(request(RECIPE, vanillaRecipe))
    await agent.idle()
    expect(fake.requests).toHaveLength(1)
    expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'end' })
    await expect(
      agent.sendExplain({ ...request(RECIPE, {}), packId: 'nope' })
    ).rejects.toMatchObject({
      code: 'packs.notFound'
    })
  })
})
