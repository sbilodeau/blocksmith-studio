import { z } from 'zod'
import {
  CustomItemSchema,
  armorTexturePath,
  functionCommand,
  generatedPaths,
  itemRef,
  itemTexturePath,
  langPath,
  type CustomItem
} from '@shared/items'
import { decodePng } from '@shared/image'
import {
  MAX_GRID_PIXELS,
  encodeGrid,
  paletteSummary,
  toolJsonSchema,
  type AnyTool
} from '@shared/ai/tools'
import type {
  AgentSettings,
  ChatMessage,
  ConversationTurn,
  ItemAgentRequest,
  ModelInfo,
  ToolCall,
  ToolKind,
  ToolSpec
} from '@shared/ai/types'
import type { Language } from '@shared/model/settings'
import { historyMessages } from './context'
import {
  DataDraft,
  LIST_DATA_DESCRIPTION,
  ListDataSchema,
  READ_JSON_DESCRIPTION,
  ReadJsonSchema,
  type CreationData
} from './creation-data'
import { LANGUAGE_NAMES } from './explain'
import {
  ITEM_DEFINITION_GUIDE,
  LIST_ITEMS_DESCRIPTION,
  ListItemsSchema,
  READ_ITEM_DESCRIPTION,
  ReadItemSchema,
  catalogNames,
  checkDefinition,
  definitionJson,
  definitionProblems,
  itemLine,
  knownIdsOf,
  listItemsResult,
  presetReference,
  referencedItemIds,
  sameDefinition,
  unknownItemIds,
  type ItemAiDeps,
  type KnownIds
} from './item-ai'
import {
  argsOf,
  issues,
  runAgentLoop,
  unknownTool,
  type CallOutcome,
  type Emit,
  type LoopDeps,
  type RunReason
} from './loop'

/**
 * The item agent (M14): the chat of the item page, about the ONE custom item open there. Each request carries the
 * form's definition (unsaved edits included); main adds what the model needs to be right: the files the item
 * generates, the base item's vanilla recipe uses, the checks, the English names of the ids. edit_item proposes the
 * WHOLE new definition, checked against the schema; the proposal goes into the form (unsaved) only when the user
 * applies it, and the user's save writes it. "Explain" (no tools) describes the item in game from the same context.
 */

/** Tool calls per request (each edit_item attempt counts). */
export const ITEM_AGENT_MAX_ITERATIONS = 6
/** English names listed. */
const MAX_NAMES = 60

/** What the app knows about the open item, gathered in main (never from the renderer, except the definition). */
export interface ItemSources {
  version: string
  pack: { name: string }
  /** Id the item is saved under. */
  id: string
  /** The form's definition, unsaved edits included (may not be valid). */
  draft: Record<string, unknown>
  /** The draft once validated, or null. */
  item: CustomItem | null
  /** Why the draft is not valid (English), or null. */
  problems: string | null
  /** The saved definition, or null (not saved yet, or renamed in the form). */
  saved: CustomItem | null
  /** The pack's other items. */
  others: CustomItem[]
  /** Vanilla recipes using the base item as an ingredient. */
  baseRecipeUses: string[]
  /** English names of the ids involved ("minecraft:stone_sword" -> "Stone Sword"). */
  names: Record<string, string>
  /** Vanilla ids of the pack's version, or null when unknown. */
  known: KnownIds | null
  /** Ids of the draft this version does not have. */
  unknownIds: string[]
}

/** Gathers the sources of a request (the definition is the renderer's; everything else is read in main). */
export async function gatherItemSources(
  request: Pick<ItemAgentRequest, 'packId' | 'id' | 'item'>,
  deps: {
    items: ItemAiDeps
    meta(packId: string): Promise<{ name: string; authoringVersion: string }>
  }
): Promise<ItemSources> {
  const { packId } = request
  const parsed = CustomItemSchema.safeParse(request.item)
  const item = parsed.success ? parsed.data : null
  const [meta, all, catalog] = await Promise.all([
    deps.meta(packId),
    deps.items.all(packId).catch(() => [] as CustomItem[]),
    deps.items.catalog(packId).catch(() => null)
  ])
  const saved = all.find((i) => i.id === request.id) ?? null
  const base =
    item?.base ?? (typeof request.item['base'] === 'string' ? request.item['base'] : saved?.base)
  const uses = base
    ? await deps.items
        .context(packId, base)
        .then((c) => c.baseRecipeUses)
        .catch(() => [] as string[])
    : []
  const known = catalog ? knownIdsOf(catalog) : null
  const allNames = catalog ? catalogNames(catalog) : {}
  const names: Record<string, string> = {}
  const named = [...(item ? referencedItemIds(item) : base ? [base] : []), ...uses]
  for (const id of named) {
    if (Object.keys(names).length >= MAX_NAMES) break
    if (allNames[id]) names[id] = allNames[id]
  }
  return {
    version: meta.authoringVersion,
    pack: { name: meta.name },
    id: request.id,
    draft: request.item,
    item,
    problems: definitionProblems(request.item),
    saved,
    others: all.filter((i) => i.id !== request.id),
    baseRecipeUses: uses,
    names,
    known,
    unknownIds: item ? unknownItemIds(item, known) : []
  }
}

/** What the app knows about the open item, as sections of a user message. */
export function itemContext(src: ItemSources): string[] {
  const { item, draft } = src
  const shown = item ?? draft
  const namespace = typeof shown['namespace'] === 'string' ? shown['namespace'] : '?'
  const id = typeof shown['id'] === 'string' ? shown['id'] : src.id
  const englishName = item?.names['en_us'] ?? id
  const state = !src.saved
    ? 'The item is not saved yet (or renamed in the form): the definition below is what the form holds.'
    : sameDefinition(src.saved, draft)
      ? 'Saved in the pack.'
      : 'The form has unsaved edits: the definition below is the edited version (the game has the saved one until the user saves).'
  const parts: string[] = [
    `Pack: "${src.pack.name}". Minecraft version: ${src.version}.`,
    `Item: "${englishName}" (${namespace}:${id}), saved as "${src.id}". ${state}`,
    `DEFINITION (as in the form):\n\`\`\`json\n${definitionJson(shown)}\n\`\`\``
  ]
  if (src.problems) {
    parts.push(
      `CHECKS (by the app): the definition is NOT valid, the item cannot be saved as it is: ${src.problems}`
    )
  } else if (src.unknownIds.length) {
    parts.push(
      `CHECKS (by the app): ids this Minecraft version does not have (the item or its recipe will not work): ${src.unknownIds.join(', ')}`
    )
  } else {
    parts.push('CHECKS (by the app): no problem found.')
  }
  if (item) {
    const files = [
      itemTexturePath(item),
      ...(armorTexturePath(item) ? [armorTexturePath(item)!] : []),
      ...generatedPaths(item),
      ...Object.keys(item.names).map((lang) => langPath(item.namespace, lang))
    ]
    parts.push(
      `FILES THE ITEM GENERATES when saved (the item texture and worn texture are drawn by the user):\n${files
        .map((f) => `- ${f}`)
        .join('\n')}`,
      `HOW TO GET IT: ${
        item.recipe ? `crafting (its recipe below, ${item.recipe.count} per craft), or ` : ''
      }the command ${functionCommand(item)} (cheats on); it is not in the creative inventory.`
    )
  }
  const base = item?.base ?? (typeof draft['base'] === 'string' ? draft['base'] : null)
  if (base) {
    parts.push(
      `BASE ITEM: ${base}${src.names[base] ? ` (${src.names[base]})` : ''}. ${
        src.baseRecipeUses.length
          ? `Vanilla recipes that use it as an ingredient, where the custom item ALSO works since Minecraft matches ingredients by id: ${src.baseRecipeUses.join(', ')}.`
          : 'No vanilla recipe uses it as an ingredient.'
      }`
    )
  }
  const reference = presetReference(item ?? (draft as Partial<CustomItem>))
  if (reference) {
    parts.push(
      `REFERENCE: the values Blocksmith gives a new item of this kind (diamond-like): ${reference}`
    )
  }
  const names = Object.entries(src.names)
  if (names.length) {
    parts.push(`ENGLISH IN-GAME NAMES:\n${names.map(([i, n]) => `- ${i} = ${n}`).join('\n')}`)
  }
  parts.push(
    src.others.length
      ? `OTHER ITEMS OF THE PACK:\n${src.others.map((i) => `- ${itemLine(i)}`).join('\n')}`
      : 'The pack has no other custom item.'
  )
  return parts
}

export const EDIT_ITEM_DESCRIPTION = `Propose the WHOLE new definition of the custom item open in the item page (the only item you can change). The
user reviews it before it goes into the form. Keep every field the user did not ask to change exactly as it is, and
keep "schemaVersion" and "namespace". Change "id" only when the user asks to rename the item. The definition is
checked: an invalid one is refused with the reasons, fix it and call edit_item again.
Examples (on a ruby sword {"kind":"weapon","weapon":{"attackDamage":7,"attackSpeed":1.6},...}):
- "fais 9 de dégâts" / "make it deal 9 damage" -> {"item":{...the same definition..., "weapon":{"attackDamage":9,
  "attackSpeed":1.6}}}
- "il doit se cumuler par 16" / "let it stack to 16" -> "maxStack": 16 (and no "durability")
- "renomme-le en Lame de rubis" / "rename it Ruby Blade" -> "id": "ruby_blade", "names": {"en_us": "Ruby Blade",
  "fr_fr": "Lame de rubis"}`

export const EditItemSchema = z
  .object({
    item: z
      .record(z.string(), z.unknown())
      .describe('The WHOLE new definition of the item, as a JSON object')
  })
  .strict()

export const GetItemTextureSchema = z
  .object({
    worn: z
      .boolean()
      .default(false)
      .describe('Armor: the texture drawn on the player instead of the inventory icon')
  })
  .strict()

const GET_TEXTURE_DESCRIPTION = `Look at the item's texture (read only: the user edits it in the texture editor). Returns a palette-indexed
grid: {"w","h","palette":{".":"#00000000","a":"#rrggbbaa",...},"rows":[...]}, rows[y][x], "." = transparent.
Example: {}`

export const ITEM_AGENT_INSTRUCTIONS = `You are the custom item assistant of Blocksmith Studio, a Minecraft Java Edition pack editor. You help the user
refine ONE custom item: the one open in the item page (described in the request). You never write files: edit_item
proposes the new definition, the user reviews it, puts it in the item form and saves it.

Reply in {{language}}. If the user writes in another language, reply in the user's language.
- When the user asks for a change, call edit_item with the WHOLE new definition, then reply in one to three short
  sentences saying what changes in game, in simple terms (no JSON in your reply).
- When the user asks a question, answer it in simple terms without calling edit_item.
- When the request is ambiguous (which effect? how many?), ask one short question instead of guessing.
- When you rename the item or change a name, give both "en_us" and "fr_fr".
- Use get_texture to see the item's texture, list_items and read_item for the pack's other items, list_data and
  read_json for data files (vanilla recipes and tags).
- Only the open item's definition can change. The texture is edited in the texture editor (its own AI chat can recolor
  or redraw it); other items and data files are changed where they are open. If a request needs that, say so.
- Plain text replies only: no headings, no bold, no tables.`

export const ITEM_EXPLAIN_INSTRUCTIONS = `You explain custom items to players inside Blocksmith Studio, a Minecraft Java Edition pack editor. The user
clicked "Explain" on one custom item of their pack. Explain IN SIMPLE TERMS what this item is in the game. You do not
edit anything.

Reply in {{language}}. Write for a player who does not read JSON:
- Start with one sentence that sums up the item (for example "A sword a bit stronger than diamond, crafted from
  emeralds.").
- Then at most 7 short lines starting with "- ", one fact each: how to get it (the recipe in words, or the command),
  its stats compared with its base item and with similar vanilla items (damage, attack speed, durability, armor,
  mining, hunger restored), what happens when it is eaten (effects with their duration in seconds and level), how it
  stacks, its name color or shimmer.
- When vanilla recipes use the base item, say plainly that the custom item also works in them (name them).
- If the CHECKS list problems, say first, plainly, what is wrong.
- Name items by their in-game names in {{language}} (English names are listed when known).
- Only state what the definition says, plus well-known vanilla values for comparisons.
- Plain text only: no headings, no bold, no tables, no code blocks. Do not restate or quote the JSON.`

export interface ItemAgentInput {
  runId: string
  request: ItemAgentRequest
  sources: ItemSources
  /** PNG of a pack texture (get_texture); null when the pack has none. */
  readPng(path: string): Promise<Uint8Array | null>
  /** The data files the agent can read (list_data, read_json); absent when the pack has none. */
  data?: CreationData
  settings: AgentSettings
  history: ConversationTurn[]
  modelInfo?: ModelInfo
}

export interface ItemAgentResult {
  reason: RunReason
  error?: { code: string; params?: Record<string, string | number> }
  turns: ConversationTurn[]
  /** The last valid edit_item, when it differs from the form's definition. */
  proposal?: { after: CustomItem; unknownIds: string[] }
}

function spec(name: string, description: string, schema: z.ZodType): ToolSpec {
  return {
    name,
    description,
    parameters: toolJsonSchema({ name, description, params: schema } as AnyTool)
  }
}

interface ItemTool {
  name: string
  kind: ToolKind
  schema: z.ZodType
  spec: ToolSpec
}

const TOOLS: ItemTool[] = [
  {
    name: 'edit_item',
    kind: 'mutate',
    schema: EditItemSchema,
    spec: spec('edit_item', EDIT_ITEM_DESCRIPTION, EditItemSchema)
  },
  {
    name: 'get_texture',
    kind: 'read',
    schema: GetItemTextureSchema,
    spec: spec('get_texture', GET_TEXTURE_DESCRIPTION, GetItemTextureSchema)
  },
  {
    name: 'list_items',
    kind: 'read',
    schema: ListItemsSchema,
    spec: spec('list_items', LIST_ITEMS_DESCRIPTION, ListItemsSchema)
  },
  {
    name: 'read_item',
    kind: 'read',
    schema: ReadItemSchema,
    spec: spec('read_item', READ_ITEM_DESCRIPTION, ReadItemSchema)
  },
  {
    name: 'read_json',
    kind: 'read',
    schema: ReadJsonSchema,
    spec: spec('read_json', READ_JSON_DESCRIPTION, ReadJsonSchema)
  },
  {
    name: 'list_data',
    kind: 'read',
    schema: ListDataSchema,
    spec: spec('list_data', LIST_DATA_DESCRIPTION, ListDataSchema)
  }
]

/** Tool names of the item agent (tests, docs). */
export const ITEM_AGENT_TOOLS = TOOLS.map((t) => t.name)

/** Models sometimes pass the definition itself instead of {"item": ...}: accept both. */
function editArgs(args: unknown): unknown {
  if (args && typeof args === 'object' && !Array.isArray(args) && !('item' in args)) {
    const o = args as Record<string, unknown>
    if ('schemaVersion' in o || 'kind' in o || 'names' in o) return { item: o }
  }
  return args
}

/** System prompt and messages: instructions, history, then the open item's context and the request. */
export function buildItemAgentMessages(input: ItemAgentInput): ChatMessage[] {
  const { request, sources } = input
  const system = [
    ITEM_AGENT_INSTRUCTIONS.replaceAll('{{language}}', LANGUAGE_NAMES[request.language]),
    ITEM_DEFINITION_GUIDE
  ].join('\n\n')
  return [
    { role: 'system', text: system },
    ...historyMessages(input.history),
    {
      role: 'user',
      text: `[Open item]\n${itemContext(sources).join('\n\n')}\n\nUser request:\n${request.message}`
    }
  ]
}

/** System prompt and user message of an item explanation. */
export function buildItemExplainMessages(src: ItemSources, language: Language): ChatMessage[] {
  const system = [
    ITEM_EXPLAIN_INSTRUCTIONS.replaceAll('{{language}}', LANGUAGE_NAMES[language]),
    ITEM_DEFINITION_GUIDE
  ].join('\n\n')
  return [
    { role: 'system', text: system },
    {
      role: 'user',
      text: [
        ...itemContext(src),
        `Explain this item in ${LANGUAGE_NAMES[language]}, in simple terms.`
      ].join('\n\n')
    }
  ]
}

export async function runItemAgent(
  input: ItemAgentInput,
  deps: LoopDeps,
  emit: Emit,
  signal: AbortSignal
): Promise<ItemAgentResult> {
  const { request, sources } = input
  const tools = TOOLS.filter((t) => input.data || !['read_json', 'list_data'].includes(t.name))
  const byName = new Map(tools.map((t) => [t.name, t]))
  const specs = tools.map((t) => t.spec)
  const dataDraft = input.data ? new DataDraft(input.data) : null
  let proposal: ItemAgentResult['proposal']
  /** The definition the item had before this run: the form's when valid, else the saved one. */
  const previous: Partial<CustomItem> = sources.item ?? sources.saved ?? sources.draft
  const taken = new Set(sources.others.map((i) => i.id))

  const fail = (kind: ToolKind, message: string): CallOutcome => ({
    ok: false,
    kind,
    summary: message,
    content: JSON.stringify({ ok: false, error: message })
  })
  const ok = (kind: ToolKind, summary: string, result: unknown, mutated = false): CallOutcome => ({
    ok: true,
    kind,
    summary,
    mutated,
    content: JSON.stringify({ ok: true, result })
  })

  function editItem(args: z.output<typeof EditItemSchema>): CallOutcome {
    const check = checkDefinition(args.item, { previous, taken, known: sources.known })
    if (!check.item) return fail('mutate', check.error ?? 'Invalid definition.')
    proposal = { after: check.item, unknownIds: check.unknownIds }
    const renamed = check.item.id !== sources.id ? ` (renamed to ${check.item.id})` : ''
    return ok(
      'mutate',
      `Proposed a new definition of ${sources.id}${renamed}`,
      {
        proposed: true,
        ...(check.unknownIds.length
          ? {
              warnings: `Ids this Minecraft version does not have: ${check.unknownIds.join(', ')}`
            }
          : {}),
        note: 'The user will review the definition before it goes into the form.'
      },
      true
    )
  }

  async function getTexture(args: z.output<typeof GetItemTextureSchema>): Promise<CallOutcome> {
    const item = (proposal?.after ?? sources.item ?? sources.saved) as CustomItem | null
    const path = item ? (args.worn ? armorTexturePath(item) : itemTexturePath(item)) : null
    if (!path) {
      return fail('read', args.worn ? 'This item is not armor.' : 'The definition is not valid.')
    }
    // A renamed item keeps its texture under the saved id until the user saves.
    const savedPath = sources.saved
      ? args.worn
        ? armorTexturePath(sources.saved)
        : itemTexturePath(sources.saved)
      : null
    const png =
      (await input.readPng(path).catch(() => null)) ??
      (savedPath && savedPath !== path ? await input.readPng(savedPath).catch(() => null) : null)
    if (!png) return fail('read', `The pack has no texture at ${path} yet.`)
    let img
    try {
      img = decodePng(png)
    } catch {
      return fail('read', `${path} is not a readable PNG.`)
    }
    if (img.width * img.height > MAX_GRID_PIXELS) {
      const { colors } = paletteSummary(img)
      return ok('read', `Read ${path}`, {
        path,
        width: img.width,
        height: img.height,
        mainColors: colors.slice(0, 16).map((c) => c.hex)
      })
    }
    return ok('read', `Read ${path}`, { path, grid: encodeGrid(img) })
  }

  async function execute(call: ToolCall): Promise<CallOutcome> {
    const tool = byName.get(call.name)
    if (!tool) return unknownTool(call, specs)
    const raw = tool.name === 'edit_item' ? editArgs(argsOf(call)) : argsOf(call)
    const parsed = tool.schema.safeParse(raw)
    if (!parsed.success) {
      return fail(tool.kind, `Invalid arguments for ${tool.name}: ${issues(parsed.error)}`)
    }
    switch (tool.name) {
      case 'edit_item':
        return editItem(parsed.data as z.output<typeof EditItemSchema>)
      case 'get_texture':
        return getTexture(parsed.data as z.output<typeof GetItemTextureSchema>)
      case 'list_items': {
        const all = [...sources.others, ...(sources.item ? [sources.item] : [])]
        return ok('read', `Listed ${all.length} item(s)`, listItemsResult(all))
      }
      case 'read_item': {
        const { id } = parsed.data as z.output<typeof ReadItemSchema>
        const plain = id.includes(':') ? id.slice(id.indexOf(':') + 1) : id
        const found =
          sources.others.find((i) => i.id === plain) ??
          (plain === sources.id ? (proposal?.after ?? sources.item) : null)
        if (!found) return fail('read', `The pack has no item "${id}" (use list_items).`)
        return ok('read', `Read ${itemRef(found)}`, { definition: found })
      }
      case 'read_json': {
        const { path } = parsed.data as z.output<typeof ReadJsonSchema>
        const file = await dataDraft!.read(path)
        if (!file) return fail('read', `No data file at ${path} (use list_data to find it).`)
        return ok('read', `Read ${path}`, file)
      }
      default: {
        const listed = dataDraft!.list(parsed.data as z.output<typeof ListDataSchema>)
        return ok('read', `Listed ${listed.files.length} of ${listed.count} file(s)`, listed)
      }
    }
  }

  const result = await runAgentLoop(
    {
      agent: 'item',
      tools: specs,
      messages: buildItemAgentMessages(input),
      execute,
      kindOf: (name) => byName.get(name)?.kind ?? 'read'
    },
    {
      runId: input.runId,
      model: request.model,
      ...(input.modelInfo ? { modelInfo: input.modelInfo } : {}),
      thinking: request.thinking ?? input.settings.thinking,
      maxIterations: Math.min(input.settings.maxIterations, ITEM_AGENT_MAX_ITERATIONS)
    },
    deps,
    emit,
    signal
  )
  const changed = proposal && !sameDefinition(proposal.after, request.item) ? proposal : undefined
  return { ...result, ...(changed ? { proposal: changed } : {}) }
}
