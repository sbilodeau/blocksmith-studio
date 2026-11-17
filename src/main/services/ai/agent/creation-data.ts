import { z } from 'zod'
import {
  DATA_KINDS,
  dataContext,
  formatJson,
  parseDataPath,
  validateData,
  type DataIds,
  type DataIssue
} from '@shared/datapack'
import { globToRegExp } from '@shared/categories/glob'
import type { DataEntry } from '@shared/model/data'

/**
 * Data pack tools of the creation agent (PLAN M10): list_data and read_json read the pack's data files (and vanilla's),
 * write_json proposes a whole JSON file. Like every agent tool, write_json writes nothing: the file goes into the plan
 * and only the user's apply writes it (one history entry for all accepted files).
 */

/** Data files the creation agent can see and change. */
export interface CreationData {
  /** The pack's data files plus vanilla's (copy-on-write, as the data browser shows them). */
  entries: DataEntry[]
  ids: DataIds
  /** Current text of a data file (the pack's, else vanilla's); null when it does not exist. */
  read(path: string): Promise<string | null>
}

/** Ids returned by list_data. */
export const MAX_LISTED_DATA = 200
/** Longest text read_json returns (vanilla's biggest loot tables are ~100 KB). */
export const MAX_READ_CHARS = 12_000
/** JSON files per plan. */
export const MAX_JSON_STEPS = 24

export const ListDataSchema = z
  .object({
    kind: z
      .enum(DATA_KINDS)
      .optional()
      .describe('recipe, loot_table, tag, advancement, function or other'),
    match: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe(
        'Glob on the name (e.g. "*_planks") or, with "/", on the id path (e.g. "blocks/*_ore")'
      ),
    namespace: z.string().min(1).max(64).optional(),
    changedOnly: z.boolean().default(false).describe('Only files the pack added or changed'),
    limit: z.number().int().min(1).max(MAX_LISTED_DATA).default(50)
  })
  .strict()

export const ReadJsonSchema = z
  .object({
    path: z
      .string()
      .min(1)
      .max(512)
      .describe('Pack path, e.g. "data/minecraft/recipe/oak_planks.json"')
  })
  .strict()

export const WriteJsonSchema = z
  .object({
    path: z
      .string()
      .min(1)
      .max(512)
      .describe(
        'Pack path: data/<namespace>/<recipe|loot_table|advancement|tags/<registry>>/<name>.json'
      ),
    json: z.record(z.string(), z.unknown()).describe('The WHOLE file content as a JSON object')
  })
  .strict()

export const LIST_DATA_DESCRIPTION = `List the data files of the pack (its own files plus Minecraft's vanilla recipes, loot tables, tags and
advancements), to find the file to change or check that an id exists. Example: {"kind":"recipe","match":"*_planks"}`

export const READ_JSON_DESCRIPTION = `Read a data file of the pack (the pack's version, else vanilla's) before changing it.
Example: {"path":"data/minecraft/loot_table/blocks/diamond_ore.json"}`

export const WRITE_JSON_DESCRIPTION = `Propose a data pack JSON file (recipe, loot table, tag, advancement...), shown to the user as a plan step. "json"
is the WHOLE file. Overriding a vanilla file uses its vanilla path (data/minecraft/...); new content goes in the
pack's own namespace. The file is checked against Minecraft's format: an invalid file is refused with the reasons.
Formats (Minecraft 1.21.4+): ingredients are an item id, a tag "#minecraft:planks" or a list of item ids; results are
{"id":"minecraft:stone","count":2}. Data packs cannot add new items.
Examples:
- "une recette pour crafter une selle avec du cuir" / "a recipe to craft a saddle from leather" ->
  {"path":"data/my_pack/recipe/saddle.json","json":{"type":"minecraft:crafting_shaped","pattern":["LLL","L L"],
  "key":{"L":"minecraft:leather"},"result":{"id":"minecraft:saddle"}}}
- "le minerai de diamant donne 2 diamants" / "diamond ore drops 2 diamonds" -> read_json the vanilla loot table,
  then write_json the same path with the change.
- "ajoute le basalte au tag des pierres" / "add basalt to the stone tag" ->
  {"path":"data/minecraft/tags/block/base_stone_overworld.json","json":{"values":["minecraft:basalt"]}}
  (tags from several packs are combined; add only the new values)`

/** One proposed file: text, what it replaces, and the warnings the check found. */
export interface JsonWrite {
  path: string
  text: string
  /** Text before the plan (pack or vanilla), null for a new file. */
  previous: string | null
  warnings: number
}

/** Describes issues for the model (English, compact). */
export function issuesForModel(issues: readonly DataIssue[], max = 8): string {
  return issues
    .slice(0, max)
    .map((i) => {
      const at = i.path.length ? ` at ${i.path.join('.')}` : ''
      const params = i.params ? ` ${JSON.stringify(i.params)}` : ''
      return `${i.code}${params}${at}`
    })
    .join('; ')
}

/** Keeps the files written during the run, so read_json returns the planned version. */
export class DataDraft {
  private readonly written = new Map<string, JsonWrite>()
  private readonly ctx

  constructor(private readonly data: CreationData) {
    this.ctx = dataContext(data.ids)
  }

  get count(): number {
    return this.written.size
  }

  list(args: z.output<typeof ListDataSchema>): { count: number; files: string[]; more?: number } {
    const glob = args.match ? globToRegExp(args.match) : null
    const planned = new Set(this.written.keys())
    const matched = this.data.entries.filter((e) => {
      if (args.kind && e.kind !== args.kind) return false
      if (args.namespace && e.namespace !== args.namespace) return false
      if (args.changedOnly && e.status === 'vanilla' && !planned.has(e.path)) return false
      if (!glob) return true
      // A pattern without "/" matches the last segment ("*_ore" finds "blocks/diamond_ore"), as for textures.
      const idPath = e.id.slice(e.id.indexOf(':') + 1)
      return glob.test(
        args.match!.includes('/') ? idPath : idPath.slice(idPath.lastIndexOf('/') + 1)
      )
    })
    const files = matched.slice(0, args.limit).map((e) => {
      const status = planned.has(e.path) ? 'planned' : e.status === 'vanilla' ? '' : e.status
      return `${e.path}${status ? ` (${status})` : ''}`
    })
    return {
      count: matched.length,
      files,
      ...(matched.length > args.limit ? { more: matched.length - args.limit } : {})
    }
  }

  async read(path: string): Promise<{ path: string; text: string; truncated?: boolean } | null> {
    if (!parseDataPath(path)) return null
    const text = this.written.get(path)?.text ?? (await this.data.read(path))
    if (text === null) return null
    return text.length > MAX_READ_CHARS
      ? { path, text: text.slice(0, MAX_READ_CHARS), truncated: true }
      : { path, text }
  }

  /** Checks and records a file; returns the issues (errors refuse the file). */
  async write(
    path: string,
    json: Record<string, unknown>
  ): Promise<{ write?: JsonWrite; issues: DataIssue[]; error?: string }> {
    const info = parseDataPath(path)
    if (!info || info.text) {
      return {
        issues: [],
        error: `Invalid path "${path}": use data/<namespace>/<folder>/<name>.json (lowercase, no spaces)`
      }
    }
    const issues = validateData(info.kind, json, this.ctx, info.registry)
    if (issues.some((i) => i.severity === 'error')) return { issues }
    const earlier = this.written.get(path)
    const write: JsonWrite = {
      path,
      text: formatJson(json),
      previous: earlier ? earlier.previous : await this.data.read(path),
      warnings: issues.length
    }
    this.written.set(path, write)
    return { write, issues }
  }
}

/** True when the agent may use data tools on this pack kind. */
export function dataToolsFor(kind: 'resource' | 'data' | 'combined'): boolean {
  return kind !== 'resource'
}
