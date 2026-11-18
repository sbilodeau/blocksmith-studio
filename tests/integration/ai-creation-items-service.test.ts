import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createImage, decodePng, encodePng, getPixel, toHex } from '@shared/image'
import type { AgentEvent, CreationProposal } from '@shared/ai/types'
import { CustomItemSchema, itemTexturePath, type CustomItem } from '@shared/items'
import type { TextureEntry } from '@shared/model/pack'
import { DONE_END, DONE_TOOLS, fakeProvider, seqIds, text, toolCall } from '../unit/ai-agent-fakes'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

const { createBulkService } = await import('../../src/main/services/bulk/service')
const { inProcessBulkRunner } = await import('../../src/main/services/bulk/runner')
const { createEditorAgentService, createConversationStore } =
  await import('../../src/main/services/ai/agent')
const { createBriefService } = await import('../../src/main/services/brief')
type ItemOperation = import('../../src/main/services/items').ItemOperation

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
  weapon: { attackDamage: 9, attackSpeed: 1.6 }
}

function entry(
  path: string,
  folder: string,
  name: string,
  status: TextureEntry['status']
): TextureEntry {
  return {
    path,
    namespace: path.split('/')[1]!,
    folder,
    name,
    width: 2,
    height: 2,
    animated: false,
    status,
    categories: [folder === 'block' ? 'blocks' : 'items'],
    url: ''
  }
}

const PLAN = [
  [
    toolCall('write_item', { item: SWORD }),
    toolCall('apply_to_all', {
      operation: { tool: 'replace_color', args: { from: '#4aedd9', to: '#c00000' } },
      filter: { match: 'ruby_sword' }
    }),
    toolCall('delete_item', { id: 'ruby' }),
    DONE_TOOLS
  ],
  [text("Voici l'épée en rubis."), DONE_END]
] as Parameters<typeof fakeProvider>[0]

describe('creation agent service with custom items', () => {
  let folder: string
  let events: AgentEvent[]

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'bs-creation-items-'))
    events = []
  })
  afterEach(async () => {
    await rm(folder, { recursive: true, force: true })
  })

  function setup(plan: Parameters<typeof fakeProvider>[0] = PLAN): {
    agent: ReturnType<typeof createEditorAgentService>
    files: Map<string, Uint8Array>
    log: string[]
    applied: Array<{ operations: readonly ItemOperation[]; change: unknown }>
  } {
    const vanilla = new Map<string, Uint8Array>([
      [STONE, encodePng(createImage(2, 2, [128, 128, 128, 255]))],
      [DIAMOND_SWORD, encodePng(createImage(2, 2, [74, 237, 217, 255]))]
    ])
    const files = new Map<string, Uint8Array>()
    const log: string[] = []
    const applied: Array<{ operations: readonly ItemOperation[]; change: unknown }> = []
    /** The pack's textures: vanilla stone, plus the item textures the pack has. */
    const catalog = (): TextureEntry[] => [
      entry(STONE, 'block', 'stone', 'vanilla'),
      ...(files.has(SWORD_TEXTURE) ? [entry(SWORD_TEXTURE, 'item', 'ruby_sword', 'added')] : [])
    ]
    const readPng = async (_p: string, path: string): Promise<Uint8Array | null> =>
      files.get(path) ?? vanilla.get(path) ?? null
    const locate = async (id: string): Promise<{ folder: string } | null> =>
      id === 'p1' ? { folder } : null
    const brief = createBriefService({ locate })
    const bulk = createBulkService({
      packs: { textures: async () => catalog() },
      textures: {
        read: async (_p, path) => ({ png: files.get(path) ?? null }),
        saveMany: async (_p, list) => {
          for (const i of list) files.set(i.path, i.png)
          return null
        }
      },
      brief,
      run: inProcessBulkRunner
    })
    const agent = createEditorAgentService({
      providers: fakeProvider(plan).providers,
      getAgentSettings: () => ({ thinking: 'off', maxIterations: 6, imageMode: 'grid' }),
      packs: { locate },
      brief,
      conversations: createConversationStore({ locate }),
      readVanillaPng: async () => null,
      navigation: { textures: async () => catalog(), readPng, bulk },
      creation: {
        catalog: async () => {
          log.push('catalog')
          return catalog()
        },
        readPng,
        meta: async () => ({ name: 'Gems', description: '', base: 'vanilla', kind: 'combined' }),
        setMeta: async () => undefined,
        items: {
          applyMany: async (_p, operations, change) => {
            log.push('items')
            applied.push({ operations, change })
            // What the item service does: a new item's texture is copied from textureFrom.
            for (const op of operations) {
              if (op.op === 'write' && op.textureFrom) {
                files.set(itemTexturePath(op.item), vanilla.get(op.textureFrom)!)
              }
            }
            return null
          }
        }
      },
      items: {
        all: async () => [RUBY],
        catalog: async () => ({
          version: '26.3',
          items: [{ id: 'minecraft:stone_sword' }, { id: 'minecraft:poisonous_potato' }],
          tags: []
        }),
        context: async () => ({ baseRecipeUses: [] }),
        forTexture: async () => null,
        readPng
      },
      emit: (e) => events.push(e),
      newId: seqIds()
    })
    return { agent, files, log, applied }
  }

  it('writes the items first, then recolors the new texture', async () => {
    const { agent, files, log, applied } = setup()
    await agent.sendCreation({
      packId: 'p1',
      message: 'crée une épée en rubis',
      model: { providerId: 'fake', modelId: 'm1' },
      language: 'fr'
    })
    await agent.idle()
    const e = events.find((x) => x.type === 'proposal')
    if (e?.type !== 'proposal') throw new Error(`no proposal: ${JSON.stringify(events.at(-1))}`)
    const proposal = e.proposal as CreationProposal
    expect(proposal.steps.map((s) => s.tool)).toEqual([
      'write_item',
      'replace_color',
      'delete_item'
    ])
    expect(proposal.steps[1]!.dependsOn).toEqual([proposal.steps[0]!.id])
    // Nothing is written by the run.
    expect(files.size).toBe(0)
    expect(log).toEqual(['catalog'])
    log.length = 0

    const result = await agent.applyCreation(
      proposal.id,
      proposal.steps.map((s) => s.id)
    )
    expect(result).toMatchObject({ itemsWritten: 2, texturesWritten: 1, checkpoints: 1 })
    expect(log).toEqual(['items', 'catalog'])
    expect(applied).toHaveLength(1)
    expect(applied[0]!.change).toEqual({
      source: 'ai',
      label: { key: 'aiItems', params: { count: 2 } }
    })
    expect(applied[0]!.operations).toEqual([
      {
        op: 'write',
        item: CustomItemSchema.parse(SWORD),
        textureFrom: DIAMOND_SWORD
      },
      { op: 'delete', id: 'ruby' }
    ])
    expect(toHex(getPixel(decodePng(files.get(SWORD_TEXTURE)!), 0, 0))).toBe('#c00000ff')
  })

  it('replaces an existing item under its id, and applies only the ticked item steps', async () => {
    const { agent, applied } = setup([
      [
        toolCall('write_item', { item: { ...RUBY, maxStack: 16 } }),
        toolCall('write_item', { item: SWORD }),
        DONE_TOOLS
      ],
      [text('ok'), DONE_END]
    ])
    await agent.sendCreation({
      packId: 'p1',
      message: 'le rubis se cumule par 16',
      model: { providerId: 'fake', modelId: 'm1' },
      language: 'fr'
    })
    await agent.idle()
    const e = events.find((x) => x.type === 'proposal')
    if (e?.type !== 'proposal') throw new Error('no proposal')
    const proposal = e.proposal as CreationProposal
    expect(proposal.steps.map((s) => s.item?.isNew)).toEqual([false, true])
    const result = await agent.applyCreation(proposal.id, [proposal.steps[0]!.id])
    expect(result).toMatchObject({ itemsWritten: 1, texturesWritten: 0, checkpoints: 0 })
    expect(applied[0]!.operations).toEqual([
      { op: 'write', item: { ...RUBY, maxStack: 16 }, previousId: 'ruby' }
    ])
  })
})
