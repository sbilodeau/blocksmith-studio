import {
  checkDataText,
  dataContext,
  formatChanges,
  formatJson,
  jsonChanges,
  parseDataPath,
  referencedIds,
  tagEffect,
  tagValues,
  type DataIds,
  type DataKind,
  type DataPathInfo
} from '@shared/datapack'
import type { ChatMessage, DataExplainRequest } from '@shared/ai/types'
import type { DataEntry } from '@shared/model/data'
import type { PackKind } from '@shared/model/pack'
import type { Language } from '@shared/model/settings'
import { AppErrorException } from '../../../ipc/registry'
import { issuesForModel } from './creation-data'

/**
 * "Explain" in the data editor (PLAN M10): one model answer, without tools, describing in plain words what a data
 * file does in game and what it changes compared with vanilla. The model gets everything it needs to be right rather
 * than plausible: both texts, the computed differences, the app's checks, what a tag file really changes once
 * Minecraft merges it with vanilla's, the content of the tags the file uses, and the English names of its ids.
 */

/** Longest file text sent (vanilla's biggest loot tables are ~100 KB). */
export const MAX_EXPLAIN_CHARS = 12_000
/** Tags the file uses whose content is sent. */
export const MAX_EXPLAIN_TAGS = 10
/** Values listed per tag. */
export const MAX_TAG_VALUES = 40
/** English names listed. */
export const MAX_EXPLAIN_NAMES = 80

/** What the app knows about the file and the game, gathered in main (never from the renderer, except `text`). */
export interface ExplainSources {
  version: string
  pack: { name: string; kind: PackKind }
  info: DataPathInfo
  /** The editor's text, unsaved edits included. */
  text: string
  /** Vanilla's file at the same path (whatever the pack's base), or null. */
  vanilla: string | null
  /** The pack's saved file, or null when the pack does not have it. */
  saved: string | null
  ids: DataIds
  /** Content in game of the tags the file names (pack + vanilla merged). */
  tags: Array<{ id: string; registry: string; values: string[] }>
  /** English names of the ids the file names ("minecraft:stone_slab" -> "Stone Slab"). */
  names: Record<string, string>
}

/** Reads what the explanation and the data agent need (main wiring: the data service). */
export interface DataAiDeps {
  meta(packId: string): Promise<{ name: string; kind: PackKind; authoringVersion: string }>
  /** Vanilla's file at `path` for the pack's version, whatever the pack's base; null when vanilla has none. */
  vanillaText(packId: string, path: string): Promise<string | null>
  /** The pack's own file; null when the pack does not have it. */
  packText(packId: string, path: string): Promise<string | null>
  ids(packId: string): Promise<DataIds>
  /** English item and block names of the pack's version ("minecraft:stone" -> "Stone"). */
  names(packId: string): Promise<Record<string, string>>
  /** The pack's data files plus vanilla's (data agent's list_data). */
  entries(packId: string): Promise<DataEntry[]>
}

export const LANGUAGE_NAMES: Record<Language, string> = { en: 'English', fr: 'French' }

function parse(text: string | null): unknown {
  if (text === null) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** Registries a "#tag" used by a file of `kind` most likely belongs to, in the order tried. */
function tagRegistries(info: DataPathInfo): string[] {
  const first = info.kind === 'tag' && info.registry ? [info.registry] : []
  return [...new Set([...first, 'item', 'block', 'entity_type'])]
}

/** Content in game of a tag: the pack's file merged with vanilla's (or alone with "replace": true). */
async function tagInGame(
  deps: DataAiDeps,
  packId: string,
  id: string,
  registries: readonly string[]
): Promise<{ id: string; registry: string; values: string[] } | null> {
  const [ns, name] = id.slice(1).split(':') as [string, string]
  for (const registry of registries) {
    const path = `data/${ns}/tags/${registry}/${name}.json`
    if (!parseDataPath(path)) return null
    const [own, vanilla] = await Promise.all([
      deps.packText(packId, path).catch(() => null),
      deps.vanillaText(packId, path).catch(() => null)
    ])
    if (own === null && vanilla === null) continue
    const values =
      own === null ? tagValues(parse(vanilla)) : tagEffect(parse(vanilla), parse(own)).effective
    return { id, registry, values }
  }
  return null
}

/** Gathers the sources for `request` (validated path; the text is the renderer's). */
export async function gatherExplainSources(
  request: Pick<DataExplainRequest, 'packId' | 'path' | 'text'>,
  deps: DataAiDeps
): Promise<ExplainSources> {
  const info = parseDataPath(request.path)
  if (!info) throw new AppErrorException('data.invalidPath', { path: request.path })
  const [meta, vanilla, saved, ids, allNames] = await Promise.all([
    deps.meta(request.packId),
    deps.vanillaText(request.packId, request.path).catch(() => null),
    deps.packText(request.packId, request.path).catch(() => null),
    deps.ids(request.packId).catch(() => ({ items: [], blocks: [], tags: {} }) as DataIds),
    deps.names(request.packId).catch(() => ({}) as Record<string, string>)
  ])
  const referenced = info.text
    ? []
    : [...new Set([...referencedIds(parse(request.text)), ...referencedIds(parse(vanilla))])]
  const tags: ExplainSources['tags'] = []
  for (const id of referenced.filter((r) => r.startsWith('#')).slice(0, MAX_EXPLAIN_TAGS)) {
    const tag = await tagInGame(deps, request.packId, id, tagRegistries(info))
    if (tag) tags.push(tag)
  }
  const names: Record<string, string> = {}
  const named = [...referenced.filter((r) => !r.startsWith('#')), ...tags.flatMap((t) => t.values)]
  for (const id of named) {
    if (Object.keys(names).length >= MAX_EXPLAIN_NAMES) break
    const name = allNames[id]
    if (name) names[id] = name
  }
  return {
    version: meta.authoringVersion,
    pack: { name: meta.name, kind: meta.kind },
    info,
    text: request.text,
    vanilla,
    saved,
    ids,
    tags,
    names
  }
}

export const EXPLAIN_INSTRUCTIONS = `You explain Minecraft Java Edition data pack files to players inside Blocksmith Studio, a pack editor.
The user clicked "Explain" on one data file. Explain IN SIMPLE TERMS what this file makes happen in the game and, when
it replaces a vanilla file, what changes compared with the original game. You do not edit anything.

Reply in {{language}}. Write for a player who does not read JSON:
- Start with one sentence that sums up the effect in game (for example "Crafting 3 stone now gives 3 slabs instead of 6.").
- Then at most 6 short lines starting with "- ", one concrete effect each: what the player does, what happens.
- Name items, blocks and mobs by their in-game names in {{language}} (English names are listed when known). Add the id in
  backticks only when there is no common name.
- Turn numbers into game terms: ticks into seconds (20 ticks = 1 second), chances into percentages, ranges into "2 to 4".
- If the CHECKS list errors, say first, plainly, that Minecraft will not load the file as written, and what is wrong.
- If an edit has no effect in game (see the TAG EFFECT section), say so: the user may think it works.
- Only state what the data says. When an effect depends on something outside the file, say so in a few words.
- Plain text only: no headings, no bold, no tables, no code blocks. Do not restate or quote the JSON.
`

/** How Minecraft combines data pack files with vanilla's (explanations and the data agent). */
export const DATA_PACK_RULES = `How Minecraft reads data packs:
- A file at the same path as a vanilla file (namespace "minecraft") REPLACES the vanilla file completely. Tags are the
  exception: a tag file ADDS its values to vanilla's tag, unless it has "replace": true.
- A file in another namespace adds something new and changes nothing in vanilla by itself. A new loot table, function
  or tag is only used when something refers to it (a recipe, another loot table, an advancement, a command).`

/** What each kind of file means in game, sent for the file's kind only. */
export const KIND_GUIDES: Record<DataKind, string> = {
  recipe: `Recipes:
- "crafting_shaped": "pattern" rows draw the crafting grid (up to 3x3); each character stands for the "key" entry with
  that character, a space is an empty slot. The shape works anywhere in the grid and mirrored. "crafting_shapeless":
  the "ingredients" in any position. An ingredient is an item id, a "#tag" (any item of the tag) or a list (any of them).
- "smelting" (furnace), "blasting" (blast furnace), "smoking" (smoker), "campfire_cooking": one "ingredient" becomes
  "result"; "cookingtime" in ticks (defaults: furnace 200 = 10 s, blast furnace and smoker 100, campfire 600);
  "experience" is the XP collected from the furnace.
- "stonecutting": one ingredient in the stonecutter gives "result" (with its count).
- "smithing_transform": smithing table with "template" + "base" + "addition" gives "result" (the base keeps its
  enchantments). "smithing_trim": applies an armor trim pattern. "transmute": changes an item into another while keeping
  its data (for example dyeing a shulker box).
- "result": item id and "count" (default 1). "category" and "group" only sort the recipe book; "show_notification"
  controls the "new recipe" toast.
- Types like "crafting_special_*", "crafting_decorated_pot" are built into the game code and have no settings.`,
  loot_table: `Loot tables:
- The id path tells what uses the table: "blocks/<block>" = what the block drops when broken, "entities/<mob>" = what the
  mob drops when killed, "chests/<structure>" = chest contents in that structure, "gameplay/fishing/..." = fishing,
  "archaeology/..." = brushing suspicious sand or gravel, "shearing/...", "gameplay/..." for other actions.
- Each pool is rolled "rolls" times (a number, or {"min", "max"} for a random amount); "bonus_rolls" add rolls with
  Luck. Each roll picks one entry by "weight" among the entries whose conditions pass.
- Entry types: "item" (one item), "tag" (with "expand": true one random item of the tag, otherwise all of them),
  "loot_table" (rolls another table), "alternatives" (the first child whose conditions pass), "group" (all children),
  "sequence" (children until one fails), "empty" (nothing).
- Conditions ("conditions", or "condition" in 26.1+): "survives_explosion", "match_tool" (for example a tool with Silk
  Touch), "random_chance" (a probability), "random_chance_with_enchanted_bonus", "table_bonus" (chance by enchantment
  level), "killed_by_player", "entity_properties" (for example on fire), "inverted" (NOT), "any_of" / "all_of".
- Functions ("functions", or "modifier" in 26.1+): "set_count" (how many), "apply_bonus" (Fortune: "ore_drops",
  "uniform_bonus_count", "binomial_with_bonus_count"), "enchanted_count_increase" (Looting), "explosion_decay" (fewer
  items from explosions), "furnace_smelt" (drops cooked), "set_components" / "set_name" / "set_enchantments" /
  "enchant_randomly" / "enchant_with_levels" (item data), "limit_count".`,
  tag: `Tags:
- A tag is a named group of ids ("#minecraft:logs") that recipes, loot tables, other tags and the game's code use. Item
  tags often stand for "any of these" in recipes; block tags control game rules: "mineable/pickaxe" (which tool mines
  it fast), "needs_iron_tool" (tool level needed for drops), "climbable", "infiniburn_*", and many more.
- Values are ids, "#other_tag" (all its values), or {"id": ..., "required": false} (skipped when missing).
- Without "replace": true the file's values are ADDED to vanilla's tag: removing a vanilla value from the file changes
  nothing in game. With "replace": true the file's list replaces vanilla's.`,
  advancement: `Advancements:
- "criteria": named triggers the player must meet (for example "inventory_changed" with items, "player_killed_entity",
  "recipe_unlocked", "consume_item", "location"); "requirements" lists groups that must all be met, each group met by any
  of its criteria (default: every criterion).
- "display": the "title", "description", "icon" and "frame" ("task", "goal" or "challenge") shown in the advancement
  screen; "show_toast", "announce_to_chat", "hidden". Without "display" the advancement is invisible: the game uses
  those to unlock recipes ("recipes/..." advancements) or run rewards.
- "parent" places it in the tree; without a parent, a displayed advancement starts a new tab ("background" texture).
- "rewards": "experience", "recipes" unlocked, "loot" tables given, "function" run.`,
  function: `Functions (.mcfunction):
- One command per line, without the leading "/". "#" starts a comment. They run with "/function <id>", from an
  advancement reward, or every game tick ("#minecraft:tick" function tag) or on load and "/reload" ("#minecraft:load").
- Explain what the commands do for the player, in order.`,
  other: `Other data files:
- The folder after the namespace says what the file is (for example "predicate", "item_modifier", "enchantment",
  "damage_type", "worldgen/..."). Explain what that kind of file controls, then this one.`
}

export const VERSION_NOTES = `Format notes: 26.1 renamed loot table "conditions" to "condition" and "functions" to "modifier"; 1.21.5
changed the transmute recipe result from an id to an item stack. Read the file with the rules of its Minecraft version.`

function clip(text: string): string {
  return text.length > MAX_EXPLAIN_CHARS
    ? `${text.slice(0, MAX_EXPLAIN_CHARS)}\n... (cut: ${text.length - MAX_EXPLAIN_CHARS} more characters)`
    : text
}

/** JSON reformatted the same way on both sides (so key order and spaces do not look like changes), or the raw text. */
function shown(text: string, value: unknown): string {
  return clip(value === undefined ? text : formatJson(value).trimEnd())
}

const KIND_NAMES: Record<PackKind, string> = {
  resource: 'resource pack',
  data: 'data pack',
  combined: 'resource pack + data pack'
}

/** The situation of the file in one line. */
function situation(src: ExplainSources, current: unknown, vanilla: unknown): string {
  const { info } = src
  if (src.vanilla === null) {
    return info.namespace === 'minecraft'
      ? 'This is a NEW file in the "minecraft" namespace: vanilla has no file at this path.'
      : `This is a NEW file in the pack's own namespace "${info.namespace}": vanilla has no such file.`
  }
  const unchanged =
    current !== undefined && vanilla !== undefined
      ? JSON.stringify(current) === JSON.stringify(vanilla)
      : src.text === src.vanilla
  return unchanged
    ? 'The file is IDENTICAL to vanilla (not changed yet): explain what the vanilla file does in game.'
    : `This file REPLACES the vanilla ${info.kind.replace('_', ' ')} ${info.id}${
        info.kind === 'tag' ? ' (merged with it, see TAG EFFECT)' : ''
      }: explain what changes in game.`
}

function tagSection(src: ExplainSources, current: unknown, vanilla: unknown): string | null {
  if (src.info.kind !== 'tag' || src.vanilla === null || current === undefined) return null
  const effect = tagEffect(vanilla, current)
  const list = (ids: string[]): string => (ids.length ? ids.join(', ') : 'none')
  return [
    `TAG EFFECT (computed by the app, this is what the game ends up with):`,
    `- "replace": ${effect.replace}`,
    `- Ids the game gains: ${list(effect.added)}`,
    `- Ids the game loses: ${list(effect.removed)}`,
    ...(effect.stillIncluded.length
      ? [
          `- Removed from the file but STILL in the tag in game (no "replace": true, so vanilla's values stay): ${list(
            effect.stillIncluded
          )}`
        ]
      : [])
  ].join('\n')
}

function checksSection(src: ExplainSources): string {
  if (src.info.text) return 'CHECKS: function files are not checked by the app.'
  const check = checkDataText(src.text, src.info.kind, dataContext(src.ids), src.info.registry)
  if (check.errors === 0 && check.warnings === 0) {
    return 'CHECKS (by the app): no problem found.'
  }
  const errors = check.issues.filter((i) => i.severity === 'error')
  const warnings = check.issues.filter((i) => i.severity === 'warning')
  return [
    'CHECKS (by the app, codes are internal: explain them in plain words):',
    ...(errors.length
      ? [`- ${errors.length} error(s), Minecraft will not load the file: ${issuesForModel(errors)}`]
      : []),
    ...(warnings.length
      ? [
          `- ${warnings.length} warning(s), ids this Minecraft version does not have (unknownItem / unknownBlock / unknownTag) or unknown types: ${issuesForModel(warnings)}`
        ]
      : [])
  ].join('\n')
}

/**
 * What the app knows about the open file, as sections of a user message: situation, original and current text, computed
 * changes, tag effect, checks, tags used and English names.
 */
export function fileContext(src: ExplainSources): string[] {
  const { info } = src
  const current = info.text ? undefined : parse(src.text)
  const vanilla = info.text ? undefined : parse(src.vanilla)
  const parts: string[] = [
    `Pack: "${src.pack.name}" (${KIND_NAMES[src.pack.kind]}). Minecraft version: ${src.version}.`,
    `File: ${info.path}`,
    `Kind: ${info.kind}${info.registry ? ` (${info.registry} tag)` : ''}. Id: ${info.kind === 'tag' ? '#' : ''}${info.id}.`,
    situation(src, current, vanilla),
    src.saved === null
      ? src.vanilla === null
        ? 'The file is not saved in the pack yet.'
        : src.text === src.vanilla
          ? ''
          : "The edits are not saved yet (until then the game keeps vanilla's file); the current file below is the edited version."
      : src.saved === src.text
        ? 'Saved in the pack.'
        : 'The editor has unsaved edits; the current file below is the edited version.'
  ].filter(Boolean)

  const lang = info.text ? 'mcfunction' : 'json'
  if (src.vanilla !== null) {
    parts.push(
      `ORIGINAL (vanilla ${src.version}) FILE:\n\`\`\`${lang}\n${shown(src.vanilla, vanilla)}\n\`\`\``
    )
  }
  parts.push(`CURRENT FILE (as in the editor):\n\`\`\`${lang}\n${shown(src.text, current)}\n\`\`\``)

  if (src.vanilla !== null && current !== undefined && vanilla !== undefined) {
    const changes = jsonChanges(vanilla, current)
    if (changes.length) {
      parts.push(`CHANGES FROM THE ORIGINAL (computed by the app):\n${formatChanges(changes)}`)
    }
  }
  const tag = tagSection(src, current, vanilla)
  if (tag) parts.push(tag)
  parts.push(checksSection(src))

  if (src.tags.length) {
    parts.push(
      [
        'TAGS USED BY THE FILE (their content in game):',
        ...src.tags.map((t) => {
          const shownValues = t.values.slice(0, MAX_TAG_VALUES)
          const more = t.values.length - shownValues.length
          return `- ${t.id} (${t.registry}, ${t.values.length} ids): ${shownValues.join(', ')}${
            more > 0 ? `, ... and ${more} more` : ''
          }`
        })
      ].join('\n')
    )
  }
  const names = Object.entries(src.names)
  if (names.length) {
    parts.push(
      `ENGLISH IN-GAME NAMES:\n${names.map(([id, name]) => `- ${id} = ${name}`).join('\n')}`
    )
  }
  return parts
}

/** System prompt and user message for an explanation. */
export function buildExplainMessages(src: ExplainSources, language: Language): ChatMessage[] {
  const system = [
    EXPLAIN_INSTRUCTIONS.replaceAll('{{language}}', LANGUAGE_NAMES[language]),
    DATA_PACK_RULES,
    KIND_GUIDES[src.info.kind],
    VERSION_NOTES
  ].join('\n\n')
  const parts = [
    ...fileContext(src),
    `Explain this file in ${LANGUAGE_NAMES[language]}, in simple terms.`
  ]
  return [
    { role: 'system', text: system },
    { role: 'user', text: parts.join('\n\n') }
  ]
}
