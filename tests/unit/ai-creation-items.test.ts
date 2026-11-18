import { describe, expect, it, vi } from 'vitest'
import { emptyBrief } from '@shared/model/brief'
import type { TextureEntry } from '@shared/model/pack'
import type { AgentSettings, ChatMessage } from '@shared/ai/types'
import { CustomItemSchema, type CustomItem } from '@shared/items'
import { createImage, decodePng, encodePng, getPixel, toHex } from '@shared/image'
import { DONE_END, DONE_TOOLS, fakeProvider, seqIds, text, toolCall } from './ai-agent-fakes'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

const { runCreationAgent } = await import('../../src/main/services/ai/agent/creation')
const { buildSystemPrompt } = await import('../../src/main/services/ai/agent/prompts')

const SETTINGS: AgentSettings = { thinking: 'off', maxIterations: 8, imageMode: 'grid' }
const STONE = 'assets/minecraft/textures/block/stone.png'
const DIAMOND_SWORD = 'assets/minecraft/textures/item/diamond_sword.png'
const SWORD_TEXTURE = 'assets/gems/textures/item/ruby_sword.png'

const RUBY: CustomItem = CustomItemSchema.parse({
  schemaVersion: 1,
  id: 'ruby',
  namespace: 'gems',
  kind: 'simple',
  base: 'minecraft:poisonous_potato',
  names: { en_us: 'Ruby', fr_fr: 'Rubis' }
})

const SWORD = {
  schemaVersion: 1,
  id: 'ruby_sword',
  namespace: 'gems',
  kind: 'weapon',
  base: 'minecraft:stone_sword',
  names: { en_us: 'Ruby Sword', fr_fr: 'Épée en rubis' },
  handheld: true,
  durability: 1561,
  weapon: { attackDamage: 9, attackSpeed: 1.6 }
}

const stoneEntry: TextureEntry = {
  path: STONE,
  namespace: 'minecraft',
  folder: 'block',
  name: 'stone',
  width: 2,
  height: 2,
  animated: false,
  status: 'vanilla',
  categories: ['blocks'],
  url: ''
}

/** Vanilla textures: 2x2 gray (the sword is cyan, like a diamond sword). */
const vanilla = new Map<string, Uint8Array>([
  [STONE, encodePng(createImage(2, 2, [128, 128, 128, 255]))],
  [DIAMOND_SWORD, encodePng(createImage(2, 2, [74, 237, 217, 255]))],
  [
    'assets/minecraft/textures/entity/equipment/humanoid/diamond.png',
    encodePng(createImage(64, 32, [74, 237, 217, 255]))
  ]
])

async function run(
  scripts: Parameters<typeof fakeProvider>[0],
  kind: 'resource' | 'combined' = 'combined'
): Promise<{
  result: Awaited<ReturnType<typeof runCreationAgent>>
  fake: ReturnType<typeof fakeProvider>
}> {
  const fake = fakeProvider(scripts)
  const result = await runCreationAgent(
    {
      runId: 'r1',
      request: {
        packId: 'p1',
        message: 'crée une épée en rubis qui fait 9 de dégâts',
        model: { providerId: 'fake', modelId: 'm1' },
        language: 'fr'
      },
      textures: [stoneEntry],
      samples: [{ path: STONE, image: decodePng(vanilla.get(STONE)!) }],
      pack: { name: 'Gems', description: '', kind },
      ...(kind === 'combined'
        ? {
            items: {
              list: [RUBY],
              namespace: 'gems',
              known: {
                items: new Set(['minecraft:stone_sword', 'minecraft:poisonous_potato']),
                tags: new Set<string>()
              },
              readPng: async (path: string) => vanilla.get(path) ?? null
            }
          }
        : {}),
      settings: SETTINGS,
      brief: emptyBrief(),
      history: []
    },
    { providers: fake.providers, newId: seqIds(), now: () => new Date('2026-11-17T10:00:00Z') },
    () => undefined,
    new AbortController().signal
  )
  return { result, fake }
}

function toolResults(fake: ReturnType<typeof fakeProvider>, n: number): unknown[] {
  return fake.requests[n]!.messages.filter((m: ChatMessage) => m.role === 'tool').map((m) =>
    JSON.parse(m.text!)
  )
}

describe('creation agent custom items', () => {
  it('offers item tools on combined packs only, with the pack items in the request', async () => {
    const { fake } = await run([[text('ok'), DONE_END]])
    expect(fake.requests[0]!.tools!.map((t) => t.name)).toEqual(
      expect.arrayContaining(['list_items', 'read_item', 'write_item', 'delete_item'])
    )
    const user = fake.requests[0]!.messages.at(-1)!.text!
    expect(user).toContain('Custom items of the pack (namespace "gems"):')
    expect(user).toContain('- ruby: Ruby (simple, base minecraft:poisonous_potato)')
    expect(fake.requests[0]!.messages[0]!.text).toContain('can add CUSTOM ITEMS')

    const resource = await run([[text('ok'), DONE_END]], 'resource')
    expect(resource.fake.requests[0]!.tools!.map((t) => t.name)).not.toContain('write_item')
    expect(
      buildSystemPrompt({
        agent: 'creation',
        language: 'en',
        brief: emptyBrief(),
        pack: { count: 1, kind: 'resource' }
      })
    ).toContain('need a "Resource + data pack"')
    expect(
      buildSystemPrompt({
        agent: 'creation',
        language: 'en',
        brief: emptyBrief(),
        pack: { count: 0, kind: 'data' }
      })
    ).toContain('need a "Resource + data pack"')
  })

  it('plans a new item, previews a color step on its new texture, and links the two steps', async () => {
    const { result, fake } = await run([
      [
        toolCall('write_item', { item: { ...SWORD, names: { en_us: 'Ruby Sword' } } }),
        toolCall('write_item', {
          item: SWORD,
          textureFrom: 'assets/minecraft/textures/item/nope.png'
        }),
        // namespace and schemaVersion may be left out
        toolCall('write_item', {
          item: { ...SWORD, schemaVersion: undefined, namespace: undefined }
        }),
        DONE_TOOLS
      ],
      [
        toolCall('list_textures', { filter: { match: 'ruby_sword' } }),
        toolCall('apply_to_all', {
          operation: { tool: 'replace_color', args: { from: '#4aedd9', to: '#c00000' } },
          filter: { match: 'ruby_sword' }
        }),
        toolCall('apply_to_all', {
          operation: { tool: 'brightness', args: { delta: -0.1 } },
          filter: { categories: ['blocks'] }
        }),
        toolCall('list_items', {}),
        toolCall('read_item', { id: 'gems:ruby_sword' }),
        DONE_TOOLS
      ],
      [text("Voici l'épée."), DONE_END]
    ])
    const [noFrench, noTexture, written] = toolResults(fake, 1) as Array<{
      ok: boolean
      error?: string
      result?: unknown
    }>
    expect(noFrench!.error).toContain('fr_fr')
    expect(noTexture!.error).toContain('No texture at assets/minecraft/textures/item/nope.png')
    expect(written).toMatchObject({ ok: true, result: { texture: SWORD_TEXTURE } })

    const [listed, , , items, read] = toolResults(fake, 2).slice(3) as Array<{ result: unknown }>
    expect(listed!.result).toMatchObject({ count: 1, textures: ['item/ruby_sword 2x2 (added)'] })
    expect(items!.result).toMatchObject({ count: 2 })
    expect(read!.result).toMatchObject({ definition: { id: 'ruby_sword', kind: 'weapon' } })

    expect(result.steps.map((s) => s.tool)).toEqual(['write_item', 'replace_color', 'brightness'])
    const [item, color, brightness] = result.steps
    expect(item).toMatchObject({
      kind: 'mutate',
      description: { key: 'ops.writeItemNew', params: { name: 'Ruby Sword' } },
      dependsOn: [],
      item: {
        op: 'write',
        id: 'ruby_sword',
        isNew: true,
        textureFrom: DIAMOND_SWORD,
        item: { id: 'ruby_sword', weapon: { attackDamage: 9 }, lore: [] }
      }
    })
    // The color step covers the new texture, depends on the item that adds it, and previews on it.
    expect(color).toMatchObject({
      targets: [SWORD_TEXTURE],
      dependsOn: [item!.id],
      scope: { count: 1 }
    })
    expect(toHex(getPixel(decodePng(color!.samples![0]!.afterPng), 0, 0))).toBe('#c00000ff')
    // A step on other textures depends on the earlier texture step only.
    expect(brightness!.dependsOn).toEqual([color!.id])
  })

  it('replaces an item in place, deletes one, and refuses unknown items', async () => {
    const { result, fake } = await run([
      [
        toolCall('write_item', { item: { ...RUBY, maxStack: 16 } }),
        toolCall('write_item', { item: { ...RUBY, maxStack: 32 } }),
        toolCall('delete_item', { id: 'sapphire' }),
        DONE_TOOLS
      ],
      [toolCall('delete_item', { id: 'ruby' }), DONE_TOOLS],
      [text('ok'), DONE_END]
    ])
    expect((toolResults(fake, 1)[2] as { error: string }).error).toContain('no item "sapphire"')
    // The rewrite and then the delete replace the first step, keeping its id.
    expect(result.steps).toHaveLength(1)
    expect(result.steps[0]).toMatchObject({
      tool: 'delete_item',
      description: { key: 'ops.deleteItem', params: { name: 'Ruby' } },
      item: { op: 'delete', id: 'ruby' }
    })
  })

  it('plans an existing item rewrite as a change, and armor gets its worn texture', async () => {
    const helmet = {
      ...SWORD,
      id: 'ruby_helmet',
      kind: 'armor',
      base: 'minecraft:netherite_helmet',
      names: { en_us: 'Ruby Helmet', fr_fr: 'Casque en rubis' },
      weapon: undefined,
      handheld: false,
      durability: 363,
      armor: { slot: 'head', armor: 3, toughness: 2 }
    }
    const { result, fake } = await run([
      [
        toolCall('write_item', { item: { ...RUBY, maxStack: 16 } }),
        toolCall('write_item', { item: helmet, textureFrom: DIAMOND_SWORD }),
        DONE_TOOLS
      ],
      [toolCall('list_textures', { filter: { match: 'ruby*' } }), DONE_TOOLS],
      [text('ok'), DONE_END]
    ])
    expect(result.steps[0]).toMatchObject({
      description: { key: 'ops.writeItem' },
      item: { isNew: false, id: 'ruby' }
    })
    expect(result.steps[0]!.item!.textureFrom).toBeUndefined()
    const listed = (toolResults(fake, 2)[2] as { result: { textures: string[] } }).result.textures
    expect(listed).toEqual([
      'item/ruby 16x16 (added)',
      'item/ruby_helmet 2x2 (added)',
      'entity/equipment/humanoid/ruby_helmet 64x32 (added)'
    ])
  })
})
