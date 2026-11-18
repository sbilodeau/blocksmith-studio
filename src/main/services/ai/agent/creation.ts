import { z } from 'zod'
import { createImage, decodePng, encodePng, imagesEqual, type RgbaImage } from '@shared/image'
import { applyParsed, bulkTools } from '@shared/bulk/operations'
import { globToRegExp } from '@shared/categories/glob'
import { splitTexturePath } from '@shared/categories/engine'
import { getDefaultCategoryEngine } from '@shared/categories/defaults'
import {
  armorTexturePath,
  itemPreset,
  itemTexturePath,
  wornTexturePreset,
  type CustomItem,
  type ItemVariant
} from '@shared/items'
import { ToolError, getTool, paletteSummary, toolJsonSchema, type AnyTool } from '@shared/ai/tools'
import { updateStyleBrief } from '@shared/ai/tools/memory'
import type {
  AgentSettings,
  ChatMessage,
  ConversationTurn,
  CreationAgentRequest,
  PackMetaPatch,
  PlanScope,
  ProposalStep,
  ToolCall,
  ToolKind,
  ToolSpec
} from '@shared/ai/types'
import type { BulkItem } from '@shared/model/bulk'
import type { StyleBrief, StyleBriefPatch } from '@shared/model/brief'
import type { PackKind, TextureEntry } from '@shared/model/pack'
import { applyBriefPatch } from '../../brief'
import { buildSystemPrompt } from './prompts'
import { historyMessages, planImages } from './context'
import { contactSheetPngs, TILES_PER_SHEET, type SheetTexture } from './contact-sheet'
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
import { shortTexturePath } from './proposals'
import {
  DataDraft,
  LIST_DATA_DESCRIPTION,
  ListDataSchema,
  MAX_JSON_STEPS,
  READ_JSON_DESCRIPTION,
  ReadJsonSchema,
  WRITE_JSON_DESCRIPTION,
  WriteJsonSchema,
  dataToolsFor,
  issuesForModel,
  type CreationData
} from './creation-data'
import {
  ITEM_DEFINITION_GUIDE,
  LIST_ITEMS_DESCRIPTION,
  ListItemsSchema,
  READ_ITEM_DESCRIPTION,
  ReadItemSchema,
  checkDefinition,
  itemLine,
  listItemsResult,
  type KnownIds
} from './item-ai'

/**
 * The creation agent (PLAN 6.3, M6): works on the whole pack. It builds the style brief with the user, then proposes
 * category-by-category operations with apply_to_all. The pack can hold thousands of textures, so the run never
 * touches them all: a step records its filter and the matched paths, and previews the operation on a few
 * representative textures ("samples"). Applying the plan runs each step on every matched texture in the bulk worker,
 * one history entry per step (checkpoints).
 */

/** Steps per plan (the user reviews each one). */
export const MAX_PLAN_STEPS = 24
/** Representative textures loaded for the contact sheet and the step previews. */
export const MAX_SAMPLES = TILES_PER_SHEET
/** Samples per category. */
export const SAMPLES_PER_CATEGORY = 3
/** Sample before / after pairs kept per step. */
export const SAMPLES_PER_STEP = 6
/** Names returned by list_textures. */
export const MAX_LISTED = 200
/** Custom items written or deleted per plan. */
export const MAX_ITEM_STEPS = 12
/** Size of a blank item texture, and of a worn armor texture sheet. */
const BLANK_ITEM = { width: 16, height: 16 }
const BLANK_WORN = { width: 64, height: 32 }

export interface CreationSample {
  path: string
  image: RgbaImage
  frameHeight?: number
}

export interface CreationRunInput {
  runId: string
  request: CreationAgentRequest
  /** Every texture of the pack (vanilla, modified and added), with its categories. */
  textures: TextureEntry[]
  /** Plain-text names of the user's custom categories, by id (shown next to the id in the category list). */
  categoryLabels?: Record<string, string>
  /** Representative textures, decoded (contact sheet and previews). */
  samples: CreationSample[]
  pack: { name: string; description: string; base?: 'vanilla' | 'empty'; kind?: PackKind }
  /** Data packs and combined packs: the data files the agent can read and change (write_json). */
  data?: CreationData
  /** Combined packs (M14): the custom items the agent can read, create, replace and delete. */
  items?: CreationItems
  settings: AgentSettings
  brief: StyleBrief
  history: ConversationTurn[]
}

/** The pack's custom items as the creation agent sees them. */
export interface CreationItems {
  list: CustomItem[]
  /** Namespace of new items. */
  namespace: string
  /** Vanilla ids of the pack's version (warnings), or null when unknown. */
  known: KnownIds | null
  /** PNG of a pack texture, else vanilla's; null when neither has it. */
  readPng(path: string): Promise<Uint8Array | null>
}

export interface CreationRunResult {
  reason: RunReason
  error?: { code: string; params?: Record<string, string | number> }
  steps: ProposalStep[]
  turns: ConversationTurn[]
  iterations: number
}

const FilterSchema = z
  .object({
    categories: z
      .array(z.string().min(1).max(40))
      .max(20)
      .optional()
      .describe('Category ids from the category list (a texture matches if it is in ANY of them)'),
    folders: z
      .array(z.string().min(1).max(80))
      .max(20)
      .optional()
      .describe('Texture folders such as "block", "item" or "entity/zombie" (subfolders included)'),
    match: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('Glob on "folder/name" (e.g. "block/*_planks") or on the name alone (e.g. "*_ore")')
  })
  .strict()
  .describe(
    'Which textures of the pack: those matching ALL the given fields. An empty filter means every texture of the pack.'
  )

export type CreationFilter = z.output<typeof FilterSchema>

const BULK_TOOL_NAMES = bulkTools().map((t) => t.name) as [string, ...string[]]

const OperationSchema = z
  .object({
    tool: z.enum(BULK_TOOL_NAMES).describe('A color or transform tool name'),
    args: z.record(z.string(), z.unknown()).default({}).describe("That tool's arguments")
  })
  .strict()

function operationHelp(): string {
  return bulkTools()
    .map((t) => `- ${t.name}: ${t.description.split('\n')[0]}`)
    .join('\n')
}

const ApplyToAllSchema = z
  .object({ operation: OperationSchema, filter: FilterSchema.default({}) })
  .strict()

const ListTexturesSchema = z
  .object({
    filter: FilterSchema.default({}),
    limit: z.number().int().min(1).max(MAX_LISTED).default(50)
  })
  .strict()

const TexturePathSchema = z
  .string()
  .max(256)
  .regex(/^assets\/[a-z0-9_.-]+\/textures\/[a-z0-9_./-]+\.png$/)

const WriteItemSchema = z
  .object({
    item: z
      .record(z.string(), z.unknown())
      .describe('The WHOLE definition of the item, as a JSON object'),
    textureFrom: TexturePathSchema.optional().describe(
      "New item: the vanilla or pack texture its texture starts from (default: the kind's diamond item)"
    )
  })
  .strict()

const DeleteItemSchema = z
  .object({ id: z.string().min(1).max(64).describe('Id of the item to delete') })
  .strict()

const WRITE_ITEM_DESCRIPTION = `Propose a custom item (create it, or replace the item with the same id), shown to the user as a plan step. "item" is
the WHOLE definition (format below); "textureFrom" is the vanilla or pack texture a NEW item's texture is copied from
(default: the diamond item of its kind). The definition is checked: an invalid one is refused with the reasons. The
new texture can then be recolored with apply_to_all (filter {"match": "<id>"}), on top of this step.
Examples:
- "crée une épée en rubis qui fait 9 de dégâts" / "create a ruby sword that deals 9 damage" ->
  {"item":{"schemaVersion":1,"id":"ruby_sword","namespace":"<pack namespace>","kind":"weapon",
  "base":"minecraft:stone_sword","names":{"en_us":"Ruby Sword","fr_fr":"Épée en rubis"},"handheld":true,
  "durability":1561,"weapon":{"attackDamage":9,"attackSpeed":1.6},"recipe":{"type":"shaped","grid":[null,
  "minecraft:redstone_block",null,null,"minecraft:redstone_block",null,null,"minecraft:stick",null],"count":1}},
  "textureFrom":"assets/minecraft/textures/item/diamond_sword.png"}, then apply_to_all hue_shift on
  {"match":"ruby_sword"} to make it red
- "une pomme magique qui donne de la régénération" / "a magic apple that gives regeneration" -> kind "food", base
  "minecraft:poisonous_potato", "food": {"nutrition":4,"saturation":2.4,"effects":[{"effect":"minecraft:regeneration",
  "seconds":10,"level":2}]}, "textureFrom":"assets/minecraft/textures/item/apple.png"
${ITEM_DEFINITION_GUIDE}`

const SetPackMetaSchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional().describe('New pack name'),
    description: z.string().trim().max(200).optional().describe('New pack description')
  })
  .strict()
  .refine((v) => v.name !== undefined || v.description !== undefined, {
    message: 'Give a name and/or a description'
  })

interface CreationTool {
  name: string
  kind: ToolKind
  schema: z.ZodType
  spec: ToolSpec
}

function spec(name: string, description: string, schema: z.ZodType): ToolSpec {
  return {
    name,
    description,
    parameters: toolJsonSchema({ name, description, params: schema } as AnyTool)
  }
}

const ITEM_TOOLS = ['list_items', 'read_item', 'write_item', 'delete_item']

/**
 * The creation scope's tools for a pack kind: apply_to_all and list_textures (packs with textures), list_data, read_json
 * and write_json (packs with data), the custom item tools (combined packs), set_pack_meta and update_style_brief (all).
 */
export function creationTools(kind: PackKind = 'resource'): CreationTool[] {
  const textures = kind !== 'data'
  const data = dataToolsFor(kind)
  return allCreationTools().filter((t) => {
    if (t.name === 'apply_to_all' || t.name === 'list_textures') return textures
    if (t.name === 'list_data' || t.name === 'read_json' || t.name === 'write_json') return data
    if (ITEM_TOOLS.includes(t.name)) return kind === 'combined'
    return true
  })
}

function allCreationTools(): CreationTool[] {
  return [
    {
      name: 'apply_to_all',
      kind: 'mutate',
      schema: ApplyToAllSchema,
      spec: spec(
        'apply_to_all',
        `Apply ONE color or transform operation to every texture of the pack that matches "filter" (categories, folders,
name glob). This is how you change many textures at once; work category by category. The step is previewed on
representative textures and applied to all matched textures only if the user accepts it.
Operations (use the tool's own arguments in "args"):
${operationHelp()}
Examples:
- "rends tous les minerais plus rouges" / "make all ores redder" ->
  {"operation":{"tool":"hue_shift","args":{"degrees":-30}},"filter":{"categories":["ores"]}}
- "assombris les blocs" / "darken the blocks" -> {"operation":{"tool":"brightness","args":{"delta":-0.2}},"filter":{"categories":["blocks"]}}
- "contour noir sur les outils" / "black outline on tools" ->
  {"operation":{"tool":"outline","args":{"color":"#000000","mode":"outside"}},"filter":{"categories":["tools"]}}`,
        ApplyToAllSchema
      )
    },
    {
      name: 'list_textures',
      kind: 'read',
      schema: ListTexturesSchema,
      spec: spec(
        'list_textures',
        `List the textures of the pack that match "filter" (folder/name, size, status), to check what a filter covers
before using it in apply_to_all. Example: {"filter":{"match":"*_ore"},"limit":50}`,
        ListTexturesSchema
      )
    },
    {
      name: 'list_data',
      kind: 'read',
      schema: ListDataSchema,
      spec: spec('list_data', LIST_DATA_DESCRIPTION, ListDataSchema)
    },
    {
      name: 'read_json',
      kind: 'read',
      schema: ReadJsonSchema,
      spec: spec('read_json', READ_JSON_DESCRIPTION, ReadJsonSchema)
    },
    {
      name: 'write_json',
      kind: 'mutate',
      schema: WriteJsonSchema,
      spec: spec('write_json', WRITE_JSON_DESCRIPTION, WriteJsonSchema)
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
      name: 'write_item',
      kind: 'mutate',
      schema: WriteItemSchema,
      spec: spec('write_item', WRITE_ITEM_DESCRIPTION, WriteItemSchema)
    },
    {
      name: 'delete_item',
      kind: 'mutate',
      schema: DeleteItemSchema,
      spec: spec(
        'delete_item',
        `Propose to delete a custom item of the pack (its definition, texture, recipe and other generated files), shown to
the user as a plan step. Example: "supprime l'item ruby" / "delete the ruby item" -> {"id":"ruby"}`,
        DeleteItemSchema
      )
    },
    {
      name: 'set_pack_meta',
      kind: 'memory',
      schema: SetPackMetaSchema,
      spec: spec(
        'set_pack_meta',
        `Propose a new pack name and/or description (pack.mcmeta), shown to the user as a plan step.
Examples: "appelle le pack Pack de feu" / "name the pack Fire Pack" -> {"name":"Fire Pack"};
"description: textures volcaniques" -> {"description":"Volcanic textures"}`,
        SetPackMetaSchema
      )
    },
    {
      name: updateStyleBrief.name,
      kind: 'memory',
      schema: updateStyleBrief.params,
      spec: {
        name: updateStyleBrief.name,
        description: updateStyleBrief.description,
        parameters: toolJsonSchema(updateStyleBrief)
      }
    }
  ]
}

/** Folder/name of a texture: "block/stone". */
function folderName(t: Pick<TextureEntry, 'folder' | 'name'>): string {
  return t.folder ? `${t.folder}/${t.name}` : t.name
}

/** Textures of the pack matching a filter (all fields must match; an empty filter matches everything). */
export function matchTextures(
  textures: readonly TextureEntry[],
  filter: CreationFilter
): TextureEntry[] {
  const categories = filter.categories?.length ? new Set(filter.categories) : null
  const folders = filter.folders?.length
    ? filter.folders.map((f) => f.replace(/^\/+|\/+$/g, ''))
    : null
  const glob = filter.match ? globToRegExp(filter.match) : null
  const onName = filter.match ? !filter.match.includes('/') : false
  return textures.filter((t) => {
    if (categories && !t.categories.some((c) => categories.has(c))) return false
    if (folders && !folders.some((f) => t.folder === f || t.folder.startsWith(`${f}/`)))
      return false
    if (glob && !glob.test(onName ? t.name : folderName(t))) return false
    return true
  })
}

/** Matched count per category (textures in several categories count in each). */
function countByCategory(textures: readonly TextureEntry[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const t of textures) for (const c of t.categories) out[c] = (out[c] ?? 0) + 1
  return out
}

/**
 * Representative textures per category: modified/added ones first, then vanilla, at most SAMPLES_PER_CATEGORY each
 * and `max` in total, skipping textures larger than 64 px (GUI sheets, paintings) so tiles stay readable.
 */
export function pickSamples(textures: readonly TextureEntry[], max = MAX_SAMPLES): TextureEntry[] {
  const rank = (t: TextureEntry): number => (t.status === 'vanilla' ? 1 : 0)
  const byCategory = new Map<string, TextureEntry[]>()
  for (const t of textures) {
    if (t.width > 64 || (t.animated ? t.width : t.height) > 64) continue
    for (const c of t.categories) {
      const list = byCategory.get(c) ?? []
      list.push(t)
      byCategory.set(c, list)
    }
  }
  const picked = new Map<string, TextureEntry>()
  for (const list of byCategory.values()) {
    const sorted = [...list].sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path))
    let n = 0
    for (const t of sorted) {
      if (n >= SAMPLES_PER_CATEGORY || picked.size >= max) break
      if (picked.has(t.path)) continue
      picked.set(t.path, t)
      n++
    }
  }
  return [...picked.values()]
}

function sampleLine(index: number, s: CreationSample): string {
  const { colors } = paletteSummary(s.image)
  return `#${index} ${shortTexturePath(s.path).replace(/\.png$/, '')} ${s.image.width}x${s.image.height}: ${colors
    .slice(0, 4)
    .map((c) => c.hex)
    .join(' ')}`
}

function sheetTexture(index: number, s: CreationSample, image = s.image): SheetTexture {
  return { index, image, ...(s.frameHeight ? { frameHeight: s.frameHeight } : {}) }
}

/** The user message of a creation run: pack, categories, samples (+ contact sheet for vision), then the request. */
export function buildCreationMessage(
  input: Pick<
    CreationRunInput,
    'textures' | 'samples' | 'pack' | 'data' | 'categoryLabels' | 'items'
  >,
  message: string,
  withImage: boolean
): ChatMessage {
  const { samples, pack } = input
  const kind = pack.kind ?? 'resource'
  // A data pack has no textures: only its data files are described.
  const textures = kind === 'data' ? [] : input.textures
  const counts = countByCategory(textures)
  const changed = countByCategory(textures.filter((t) => t.status !== 'vanilla'))
  const folders = new Map<string, number>()
  for (const t of textures) {
    const top = t.folder.split('/')[0] || '(root)'
    folders.set(top, (folders.get(top) ?? 0) + 1)
  }
  const header = `[Pack: "${pack.name}"${pack.description ? ` - ${pack.description}` : ''}]`
  if (kind === 'data') {
    const parts = [
      header,
      'This is a DATA PACK (no textures).',
      ...dataSummary(input.data),
      '',
      'User request:',
      message
    ]
    return { role: 'user', text: parts.join('\n') }
  }
  const parts = [
    header,
    ...(kind === 'combined'
      ? [
          'This pack holds textures AND data files.',
          ...dataSummary(input.data),
          ...itemsSummary(input.items)
        ]
      : []),
    ...(pack.base === 'empty'
      ? [
          "This pack started EMPTY: the textures below are Minecraft's vanilla textures, most not in the pack yet. Create the elements the user asks for by transforming their vanilla textures with apply_to_all; accepted steps add the results to the pack."
        ]
      : []),
    `${textures.length} textures, ${textures.filter((t) => t.status !== 'vanilla').length} already modified or added.`,
    'Categories (id: textures, modified):',
    ...Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(
        ([id, n]) =>
          `- ${id}${input.categoryLabels?.[id] ? ` (${JSON.stringify(input.categoryLabels[id])}, custom)` : ''}: ${n}${changed[id] ? `, ${changed[id]} modified` : ''}`
      ),
    `Top folders: ${[...folders]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([f, n]) => `${f} (${n})`)
      .join(', ')}`,
    'Representative textures (number, folder/name, size, main colors):',
    ...samples.map((s, i) => sampleLine(i + 1, s))
  ]
  let images: Uint8Array[] | undefined
  if (withImage && samples.length > 0) {
    images = contactSheetPngs(samples.map((s, i) => sheetTexture(i + 1, s))).slice(0, 1)
    parts.push(
      'The attached contact sheet shows these textures, each tile labeled with its number; transparent pixels are drawn on a gray checkerboard.'
    )
  }
  parts.push('', 'User request:', message)
  return { role: 'user', text: parts.join('\n'), ...(images?.length ? { images } : {}) }
}

/** The pack's custom items (combined packs). */
function itemsSummary(items: CreationItems | undefined): string[] {
  if (!items) return []
  return items.list.length
    ? [
        `Custom items of the pack (namespace "${items.namespace}"):`,
        ...items.list.map((i) => `- ${itemLine(i)}`)
      ]
    : [`The pack has no custom item yet (namespace for new items: "${items.namespace}").`]
}

/** A texture the plan adds (a new custom item's), as the pack's texture list shows it. */
function plannedTexture(path: string, image: RgbaImage): TextureEntry {
  const parts = splitTexturePath(path)!
  return {
    path,
    namespace: parts.namespace,
    folder: parts.folder,
    name: parts.name,
    width: image.width,
    height: image.height,
    animated: false,
    status: 'added',
    categories: getDefaultCategoryEngine().categorize(path),
    url: ''
  }
}

/** Data files per kind and the pack's own files (data packs and combined packs). */
function dataSummary(data: CreationData | undefined): string[] {
  if (!data) return []
  const counts = new Map<string, { all: number; own: number }>()
  const own: string[] = []
  for (const e of data.entries) {
    const c = counts.get(e.kind) ?? { all: 0, own: 0 }
    c.all++
    if (e.status !== 'vanilla') {
      c.own++
      own.push(`${e.path} (${e.status})`)
    }
    counts.set(e.kind, c)
  }
  return [
    `Data files (kind: total, changed or added by the pack): ${
      [...counts].map(([k, c]) => `${k}: ${c.all}, ${c.own}`).join('; ') || 'none'
    }`,
    ...(own.length
      ? [
          'Files of the pack:',
          ...own.slice(0, 40),
          ...(own.length > 40 ? [`... and ${own.length - 40} more`] : [])
        ]
      : ['The pack has no data file of its own yet.'])
  ]
}

export async function runCreationAgent(
  input: CreationRunInput,
  deps: LoopDeps,
  emit: Emit,
  signal: AbortSignal
): Promise<CreationRunResult> {
  const { request, settings } = input
  // Copies: write_item adds the textures of new items, so later apply_to_all steps can preview on them.
  const textures = [...input.textures]
  const samples = [...input.samples]
  const steps: ProposalStep[] = []
  const at = (): string => deps.now().toISOString()
  /** Sample pixels after the steps so far. */
  const draft = new Map(samples.map((s) => [s.path, s.image]))
  const sampleByPath = new Map(samples.map((s) => [s.path, s]))
  let brief = input.brief
  let lastChanged: string[] = []

  const model = await Promise.resolve()
    .then(() => deps.providers.getModel(request.model))
    .catch(() => undefined)
  const plan = planImages(model, settings.imageMode)
  const kind = input.pack.kind ?? 'resource'
  const tools = creationTools(kind).filter(
    (t) =>
      (input.data || !['list_data', 'read_json', 'write_json'].includes(t.name)) &&
      (input.items || !ITEM_TOOLS.includes(t.name))
  )
  /** The pack's items as saved, then as the plan so far leaves them. */
  const packItems = new Map((input.items?.list ?? []).map((i) => [i.id, i]))
  const plannedItems = new Map(packItems)
  const dataDraft = input.data ? new DataDraft(input.data) : null
  const byName = new Map(tools.map((t) => [t.name, t]))
  const specs = tools.map((t) => t.spec)

  const messages: ChatMessage[] = [
    {
      role: 'system',
      text: buildSystemPrompt({
        agent: 'creation',
        language: request.language,
        brief,
        pack: { count: textures.length, kind }
      })
    },
    ...historyMessages(input.history),
    buildCreationMessage(input, request.message, plan.image)
  ]

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

  function applyToAll(call: ToolCall, data: z.output<typeof ApplyToAllSchema>): CallOutcome {
    const tool = getTool(data.operation.tool)
    if (!tool) return fail('mutate', `Unknown operation ${data.operation.tool}`)
    const parsedArgs = tool.params.safeParse(data.operation.args)
    if (!parsedArgs.success) {
      return fail('mutate', `Invalid arguments for ${tool.name}: ${issues(parsedArgs.error)}`)
    }
    const matched = matchTextures(textures, data.filter)
    if (matched.length === 0) {
      return fail('mutate', 'No texture of the pack matches this filter; nothing was planned.')
    }
    const matchedPaths = new Set(matched.map((t) => t.path))
    if (steps.length >= MAX_PLAN_STEPS) {
      return fail(
        'mutate',
        `The plan already has ${MAX_PLAN_STEPS} steps; stop and let the user review it.`
      )
    }
    const op = { tool, args: parsedArgs.data }
    const items: BulkItem[] = []
    const changed: string[] = []
    for (const t of matched) {
      const sample = sampleByPath.get(t.path)
      if (!sample) continue
      const before = draft.get(t.path)!
      let after: RgbaImage
      try {
        after = applyParsed(before, op, {
          ...(sample.frameHeight ? { frameHeight: sample.frameHeight } : {}),
          brief
        })
      } catch (err) {
        return fail('mutate', err instanceof ToolError ? err.message : String(err))
      }
      if (imagesEqual(after, before)) continue
      draft.set(t.path, after)
      changed.push(t.path)
      if (items.length < SAMPLES_PER_STEP) {
        items.push({
          path: t.path,
          name: t.name,
          beforePng: encodePng(before),
          afterPng: encodePng(after),
          changedPixels: 0
        })
      }
    }
    const scope: PlanScope = {
      ...(data.filter.categories?.length ? { categories: data.filter.categories } : {}),
      ...(data.filter.folders?.length ? { folders: data.filter.folders } : {}),
      ...(data.filter.match ? { match: data.filter.match } : {}),
      count: matched.length,
      byCategory: countByCategory(matched)
    }
    steps.push({
      id: deps.newId(),
      callId: call.id,
      tool: tool.name,
      args: op.args,
      kind: 'mutate',
      description: tool.describe(op.args),
      // Earlier texture steps, and the items whose new textures this step covers.
      dependsOn: steps
        .filter((s) =>
          s.item
            ? s.item.op === 'write' && itemTextures(s.item.item).some((p) => matchedPaths.has(p))
            : s.kind === 'mutate' && !s.json
        )
        .map((s) => s.id),
      targets: matched.map((t) => t.path),
      scope,
      samples: items
    })
    lastChanged = changed
    const summary = `apply_to_all ${tool.name} on ${matched.length} texture(s); previewed on ${changed.length} sample(s)`
    return ok(
      'mutate',
      summary,
      { matched: matched.length, byCategory: scope.byCategory, previewed: changed.length },
      changed.length > 0
    )
  }

  async function writeJson(
    call: ToolCall,
    data: z.output<typeof WriteJsonSchema>
  ): Promise<CallOutcome> {
    if (!dataDraft) return fail('mutate', 'This pack has no data files.')
    const jsonSteps = steps.filter((s) => s.json)
    if (jsonSteps.length >= MAX_JSON_STEPS && !jsonSteps.some((s) => s.json!.path === data.path)) {
      return fail(
        'mutate',
        `The plan already has ${MAX_JSON_STEPS} files; stop and let the user review it.`
      )
    }
    const r = await dataDraft.write(data.path, data.json)
    if (r.error) return fail('mutate', r.error)
    if (!r.write) {
      return fail(
        'mutate',
        `Invalid ${data.path}, nothing was planned. Fix: ${issuesForModel(r.issues)}`
      )
    }
    // A second write to the same file replaces the first step.
    const index = steps.findIndex((s) => s.json?.path === data.path)
    const step: ProposalStep = {
      id: deps.newId(),
      callId: call.id,
      tool: 'write_json',
      args: { path: data.path },
      kind: 'mutate',
      description: {
        key: r.write.previous === null ? 'ops.writeJsonNew' : 'ops.writeJson',
        params: { path: data.path }
      },
      dependsOn: [],
      json: r.write
    }
    if (index >= 0) steps.splice(index, 1, step)
    else steps.push(step)
    const warnings = r.issues.length ? { warnings: issuesForModel(r.issues) } : {}
    return ok('mutate', `Proposed ${data.path}${r.write.previous === null ? ' (new file)' : ''}`, {
      proposed: true,
      ...warnings,
      note: 'The user will review this file.'
    })
  }

  /** The item texture and worn texture of a definition. */
  function itemTextures(item: CustomItem | undefined): string[] {
    if (!item) return []
    const worn = armorTexturePath(item)
    return worn ? [itemTexturePath(item), worn] : [itemTexturePath(item)]
  }

  /** Decoded PNG of a pack or vanilla texture; null when missing or unreadable. */
  async function readImage(path: string): Promise<RgbaImage | null> {
    const png = await input.items!.readPng(path).catch(() => null)
    if (!png) return null
    try {
      return decodePng(png)
    } catch {
      return null
    }
  }

  /** Makes a planned texture visible to list_textures and apply_to_all, with its pixels as a sample. */
  function addPlannedTexture(path: string, image: RgbaImage): void {
    if (!textures.some((t) => t.path === path)) textures.push(plannedTexture(path, image))
    if (!sampleByPath.has(path)) {
      const sample: CreationSample = { path, image }
      samples.push(sample)
      sampleByPath.set(path, sample)
      draft.set(path, image)
    }
  }

  /** Puts `step` in place of the plan's earlier step for the same item (keeping its id), or at the end. */
  function putItemStep(step: Omit<ProposalStep, 'id'>, id: string): void {
    const index = steps.findIndex((s) => s.item?.id === id)
    const placed: ProposalStep = { id: index >= 0 ? steps[index]!.id : deps.newId(), ...step }
    if (index >= 0) steps.splice(index, 1, placed)
    else steps.push(placed)
  }

  function itemStepsFull(id: string): boolean {
    return (
      steps.filter((s) => s.item).length >= MAX_ITEM_STEPS && !steps.some((s) => s.item?.id === id)
    )
  }

  async function writeItem(
    call: ToolCall,
    data: z.output<typeof WriteItemSchema>
  ): Promise<CallOutcome> {
    const items = input.items!
    // Fields the model may leave out: the format version and the pack's namespace.
    const given = Object.fromEntries(Object.entries(data.item).filter(([, v]) => v !== undefined))
    const raw = { schemaVersion: 1, namespace: items.namespace, ...given }
    const id = typeof raw['id'] === 'string' ? raw['id'] : ''
    const previous = plannedItems.get(id) ?? null
    const check = checkDefinition(raw, { previous, taken: new Set(), known: items.known })
    if (!check.item) return fail('mutate', check.error ?? 'Invalid definition.')
    const item = check.item
    if (itemStepsFull(item.id)) {
      return fail(
        'mutate',
        `The plan already has ${MAX_ITEM_STEPS} items; stop and let the user review it.`
      )
    }
    const isNew = !packItems.has(item.id)
    let textureFrom: string | undefined
    if (isNew) {
      const variant = (item.tool?.type ?? item.armor?.slot) as ItemVariant | undefined
      textureFrom = data.textureFrom ?? itemPreset(item.kind, variant).textureFrom
      const image = await readImage(textureFrom)
      if (!image) {
        return fail(
          'mutate',
          `No texture at ${textureFrom}: give a vanilla or pack texture path in "textureFrom" (for example assets/minecraft/textures/item/diamond_sword.png), or leave it out.`
        )
      }
      addPlannedTexture(itemTexturePath(item), image)
    } else {
      const path = itemTexturePath(item)
      const image =
        (await readImage(path)) ?? createImage(BLANK_ITEM.width, BLANK_ITEM.height, [0, 0, 0, 0])
      addPlannedTexture(path, image)
    }
    const worn = armorTexturePath(item)
    if (worn && item.armor) {
      const image =
        (await readImage(worn)) ??
        (await readImage(wornTexturePreset(item.armor.slot))) ??
        createImage(BLANK_WORN.width, BLANK_WORN.height, [0, 0, 0, 0])
      addPlannedTexture(worn, image)
    }
    const name = item.names['en_us'] ?? item.id
    putItemStep(
      {
        callId: call.id,
        tool: 'write_item',
        args: { id: item.id, ...(textureFrom ? { textureFrom } : {}) },
        kind: 'mutate',
        description: { key: isNew ? 'ops.writeItemNew' : 'ops.writeItem', params: { name } },
        dependsOn: [],
        item: { op: 'write', id: item.id, item, ...(textureFrom ? { textureFrom } : {}), isNew }
      },
      item.id
    )
    plannedItems.set(item.id, item)
    return ok('mutate', `Proposed the item ${item.id}${isNew ? ' (new)' : ''}`, {
      proposed: true,
      texture: itemTexturePath(item),
      ...(check.unknownIds.length
        ? { warnings: `Ids this Minecraft version does not have: ${check.unknownIds.join(', ')}` }
        : {}),
      note: 'The user will review this item.'
    })
  }

  function deleteItem(call: ToolCall, data: z.output<typeof DeleteItemSchema>): CallOutcome {
    const id = data.id.includes(':') ? data.id.slice(data.id.indexOf(':') + 1) : data.id
    const item = packItems.get(id)
    if (!item || !plannedItems.has(id)) {
      return fail('mutate', `The pack has no item "${data.id}" (use list_items).`)
    }
    if (itemStepsFull(id)) {
      return fail(
        'mutate',
        `The plan already has ${MAX_ITEM_STEPS} items; stop and let the user review it.`
      )
    }
    putItemStep(
      {
        callId: call.id,
        tool: 'delete_item',
        args: { id },
        kind: 'mutate',
        description: { key: 'ops.deleteItem', params: { name: item.names['en_us'] ?? id } },
        dependsOn: [],
        item: { op: 'delete', id }
      },
      id
    )
    plannedItems.delete(id)
    return ok('mutate', `Proposed to delete the item ${id}`, {
      proposed: true,
      note: 'The user will review this change.'
    })
  }

  async function execute(call: ToolCall): Promise<CallOutcome> {
    const tool = byName.get(call.name)
    if (!tool) return unknownTool(call, specs)
    const parsed = tool.schema.safeParse(argsOf(call))
    if (!parsed.success) {
      return fail(tool.kind, `Invalid arguments for ${tool.name}: ${issues(parsed.error)}`)
    }
    switch (tool.name) {
      case 'list_data': {
        const listed = dataDraft!.list(parsed.data as z.output<typeof ListDataSchema>)
        return ok('read', `${listed.count} data file(s) match`, listed)
      }
      case 'read_json': {
        const { path } = parsed.data as z.output<typeof ReadJsonSchema>
        const file = await dataDraft!.read(path)
        if (!file) return fail('read', `No data file at ${path} (use list_data to find it).`)
        return ok('read', `Read ${path}`, file)
      }
      case 'write_json':
        return writeJson(call, parsed.data as z.output<typeof WriteJsonSchema>)
      case 'list_items':
        return ok(
          'read',
          `Listed ${plannedItems.size} item(s)`,
          listItemsResult([...plannedItems.values()])
        )
      case 'read_item': {
        const { id } = parsed.data as z.output<typeof ReadItemSchema>
        const found = plannedItems.get(id.includes(':') ? id.slice(id.indexOf(':') + 1) : id)
        if (!found) return fail('read', `The pack has no item "${id}" (use list_items).`)
        return ok('read', `Read the item ${found.id}`, { definition: found })
      }
      case 'write_item':
        return writeItem(call, parsed.data as z.output<typeof WriteItemSchema>)
      case 'delete_item':
        return deleteItem(call, parsed.data as z.output<typeof DeleteItemSchema>)
      case 'apply_to_all':
        return applyToAll(call, parsed.data as z.output<typeof ApplyToAllSchema>)
      case 'list_textures': {
        const { filter, limit } = parsed.data as z.output<typeof ListTexturesSchema>
        const matched = matchTextures(textures, filter)
        const list = matched.slice(0, limit).map((t) => {
          const size = `${t.width}x${t.animated && t.frameCount ? t.height / t.frameCount : t.height}`
          return `${folderName(t)} ${size}${t.status === 'vanilla' ? '' : ` (${t.status})`}`
        })
        return ok('read', `${matched.length} texture(s) match`, {
          count: matched.length,
          textures: list,
          ...(matched.length > limit ? { more: matched.length - limit } : {})
        })
      }
      case 'set_pack_meta': {
        const meta = parsed.data as PackMetaPatch
        steps.push({
          id: deps.newId(),
          callId: call.id,
          tool: 'set_pack_meta',
          args: meta,
          kind: 'memory',
          description: {
            key: 'ops.setPackMeta',
            params: { fields: Object.keys(meta).join(', ') }
          },
          dependsOn: [],
          packMeta: meta
        })
        return ok('memory', 'Proposed a new pack name / description', {
          proposed: true,
          note: 'The user will review this change.'
        })
      }
      default: {
        const patch = (parsed.data as { patch: StyleBriefPatch }).patch
        brief = applyBriefPatch(brief, patch, 'creation', at())
        steps.push({
          id: deps.newId(),
          callId: call.id,
          tool: updateStyleBrief.name,
          args: parsed.data,
          kind: 'memory',
          description: updateStyleBrief.describe(parsed.data as { patch: StyleBriefPatch }),
          dependsOn: [],
          briefPatch: patch
        })
        return ok('memory', `Proposed a style brief change (${Object.keys(patch).join(', ')})`, {
          proposed: true,
          note: 'The user will review this style brief change.'
        })
      }
    }
  }

  /** Vision models see the samples their last step changed. */
  function afterTools(mutated: boolean): ChatMessage | undefined {
    if (!mutated || !plan.image || lastChanged.length === 0) return undefined
    const index = new Map(samples.map((s, i) => [s.path, i + 1]))
    const shown = lastChanged.slice(0, TILES_PER_SHEET)
    const [sheet] = contactSheetPngs(
      shown.map((p) => sheetTexture(index.get(p)!, sampleByPath.get(p)!, draft.get(p)!))
    )
    return {
      role: 'user',
      text: `[App note] Representative textures after your last step (${shown
        .map((p) => `#${index.get(p)}`)
        .join(', ')}).`,
      images: sheet ? [sheet] : []
    }
  }

  const result = await runAgentLoop(
    {
      agent: 'creation',
      tools: specs,
      messages,
      execute,
      kindOf: (name) => byName.get(name)?.kind ?? 'read',
      afterTools
    },
    {
      runId: input.runId,
      model: request.model,
      ...(model ? { modelInfo: model } : {}),
      thinking: request.thinking ?? settings.thinking,
      maxIterations: settings.maxIterations
    },
    deps,
    emit,
    signal
  )
  return { ...result, steps }
}
