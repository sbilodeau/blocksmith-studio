import { z } from 'zod'
import {
  CustomItemSchema,
  itemPreset,
  itemRef,
  type CustomItem,
  type ItemKind,
  type ItemVariant
} from '@shared/items'
import { formatJson } from '@shared/datapack'
import type { ItemCatalog, ItemContext } from '@shared/model/items'
import { issues } from './loop'

/**
 * What the AI agents know about custom items (PLAN M14): the definition guide sent to the item agent and the creation
 * agent, the check every proposed definition goes through, and the reading tools both agents share. Like every agent
 * tool, nothing here writes: definitions go into a proposal the user reviews.
 */

/** Reads what the item agent, the item Explain and the creation agent need (main wiring: the item service). */
export interface ItemAiDeps {
  /** Every valid definition of the pack. */
  all(packId: string): Promise<CustomItem[]>
  /** Vanilla items (English names) and item tags of the pack's version. */
  catalog(packId: string): Promise<ItemCatalog>
  /** Vanilla recipes using `base` as an ingredient. */
  context(packId: string, base: string): Promise<ItemContext>
  /** The item whose texture (or worn texture) is `path` (editor agent context). */
  forTexture(packId: string, path: string): Promise<CustomItem | null>
  /** PNG of a pack texture, else vanilla's (get_texture, the creation agent's new textures). */
  readPng(packId: string, path: string): Promise<Uint8Array | null>
}

/** Ids a definition can be checked against (vanilla of the pack's version). */
export interface KnownIds {
  items: ReadonlySet<string>
  /** "minecraft:planks" (without "#"). */
  tags: ReadonlySet<string>
}

export function knownIdsOf(catalog: ItemCatalog): KnownIds {
  return {
    items: new Set(catalog.items.map((i) => i.id)),
    tags: new Set(catalog.tags.map((t) => t.replace(/^#/, '')))
  }
}

/** English names of the catalog, by id. */
export function catalogNames(catalog: ItemCatalog): Record<string, string> {
  return Object.fromEntries(catalog.items.flatMap((i) => (i.name ? [[i.id, i.name]] : [])))
}

export const ITEM_DEFINITION_GUIDE = `Custom item definition (a JSON object, the format of Blocksmith Studio):
- "schemaVersion": 1. "id": lowercase letters, digits and "_" (the item is "<namespace>:<id>"). "namespace": the
  pack's namespace (never "minecraft").
- "kind": "simple", "food", "weapon", "tool" or "armor". "base": the vanilla item it is in game (for example
  "minecraft:stone_sword"); it keeps that item's behavior unless the definition overrides it.
- "names": {"en_us": "Ruby Sword", "fr_fr": "Épée en rubis"}: always give both. "lore": tooltip lines, each
  {"en_us": "...", "fr_fr": "..."}.
- "handheld": true for tools and weapons (held like a sword). "rarity": "common", "uncommon", "rare" or "epic" (name
  color). "glint": true for the enchanted shimmer. "maxStack": 1 to 99 (how many fit in one slot). "durability": uses
  before it breaks (an item with durability cannot stack: leave maxStack out). "repairWith": item id or "#tag" that
  repairs it in an anvil. "enchantability": 1 to 255.
- "food" (required for kind food): {"nutrition": hunger points (2 = one drumstick), "saturation", "eatSeconds" (default
  1.6), "alwaysEdible", "animation": "eat" or "drink", "effects": [{"effect": "minecraft:regeneration", "seconds": 10,
  "level": 1, "chance": 1}]} (level 1 = level I, chance 1 = always).
- "weapon" (required for kind weapon, also used by tools): {"attackDamage": as the tooltip shows it (diamond sword 7,
  netherite sword 8), "attackSpeed": attacks per second (swords 1.6, axes about 1)}.
- "tool" (required for kind tool): {"type": "pickaxe", "axe", "shovel" or "hoe", "tier": "wooden", "stone", "iron",
  "diamond" or "netherite" (which blocks drop their items), "miningSpeed" (iron 6, diamond 8, netherite 9)}.
- "armor" (required for kind armor): {"slot": "head", "chest", "legs" or "feet", "armor": armor points, "toughness",
  "knockbackResistance": 0 to 1}.
- "recipe": null (no recipe), {"type": "shaped", "grid": 9 slots row by row, each an item id, a "#tag" or null,
  "count": 1} or {"type": "shapeless", "ingredients": [ids or #tags], "count": 1}. Ingredients are VANILLA ids or tags:
  another custom item cannot be an ingredient (the game would accept any item of its base).
- "removeComponents" and "extraComponents": expert settings, leave them as they are unless the user asks.
The base item matters: Minecraft matches recipe ingredients by item id only, so the custom item ALSO works as its base
item in every vanilla recipe that uses the base (the request lists those recipes). Blocksmith's defaults use bases that
no vanilla crafting recipe uses: poisonous potato for simple items and food, stone swords and tools, netherite armor.
Keep the base the user chose unless asked.`

/** Short summary of the issues of an invalid definition, or null when `raw` is valid. */
export function definitionProblems(raw: unknown): string | null {
  const r = CustomItemSchema.safeParse(raw)
  return r.success ? null : issues(r.error)
}

/** Every id the definition names: base, recipe ingredients, repair item (tags with their "#"). */
export function referencedItemIds(item: CustomItem): string[] {
  const ids = [item.base]
  if (item.recipe) {
    ids.push(
      ...(item.recipe.type === 'shaped' ? item.recipe.grid : item.recipe.ingredients).filter(
        (i): i is string => i !== null
      )
    )
  }
  if (item.repairWith) ids.push(item.repairWith)
  return [...new Set(ids)]
}

/** Ids and tags of the definition this Minecraft version does not have (empty when nothing is known). */
export function unknownItemIds(item: CustomItem, known: KnownIds | null): string[] {
  if (!known || known.items.size === 0) return []
  return referencedItemIds(item).filter((id) =>
    id.startsWith('#') ? !known.tags.has(id.slice(1)) : !known.items.has(id)
  )
}

export interface DefinitionCheck {
  item?: CustomItem
  /** Why the definition is refused (English, for the model). */
  error?: string
  unknownIds: string[]
}

/**
 * Checks a definition proposed by an agent: the schema, both names, the namespace and id rules, then the ids this
 * version does not have (warnings, not errors). `previous` is the item it replaces (null for a new item).
 */
export function checkDefinition(
  raw: unknown,
  options: {
    previous: Partial<CustomItem> | null
    /** Ids of the pack's other items (a new or renamed item cannot take one). */
    taken: ReadonlySet<string>
    known: KnownIds | null
  }
): DefinitionCheck {
  const parsed = CustomItemSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      error: `This definition is not valid, nothing was proposed. Fix: ${issues(parsed.error)}`,
      unknownIds: []
    }
  }
  const item = parsed.data
  const { previous } = options
  if (previous?.namespace && item.namespace !== previous.namespace) {
    return {
      error: `Keep "namespace": "${previous.namespace}" (the namespace of the item cannot change).`,
      unknownIds: []
    }
  }
  if (item.id !== previous?.id && options.taken.has(item.id)) {
    return {
      error: `The pack already has another item "${item.id}": choose another id.`,
      unknownIds: []
    }
  }
  const renamed =
    !previous || item.id !== previous.id || item.names['en_us'] !== previous.names?.['en_us']
  if ((renamed || previous?.names?.['fr_fr'] !== undefined) && !item.names['fr_fr']) {
    return {
      error: 'Give the French name too: "names" needs both "en_us" and "fr_fr".',
      unknownIds: []
    }
  }
  return { item, unknownIds: unknownItemIds(item, options.known) }
}

/** JSON with sorted keys, to compare definitions whatever their key order. */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
        )
      : v
  )
}

/** True when two definitions are the same once defaults are filled in. */
export function sameDefinition(a: unknown, b: unknown): boolean {
  const pa = CustomItemSchema.safeParse(a)
  const pb = CustomItemSchema.safeParse(b)
  return stableJson(pa.success ? pa.data : a) === stableJson(pb.success ? pb.data : b)
}

/** One line per item: "ruby_sword: Ruby Sword (weapon, base minecraft:stone_sword)". */
export function itemLine(item: CustomItem): string {
  return `${item.id}: ${item.names['en_us'] ?? item.id} (${item.kind}, base ${item.base})`
}

/** The starting values Blocksmith gives a new item of this kind (tool type, armor slot), as a reference. */
export function presetReference(item: Partial<CustomItem>): string | null {
  const kind = item.kind as ItemKind | undefined
  if (!kind) return null
  const variant = (item.tool?.type ?? item.armor?.slot) as ItemVariant | undefined
  try {
    const values: Record<string, unknown> = { ...itemPreset(kind, variant).item }
    delete values['removeComponents']
    return JSON.stringify(values)
  } catch {
    return null
  }
}

export const ListItemsSchema = z.object({}).strict()
export const ReadItemSchema = z
  .object({ id: z.string().min(1).max(64).describe('Id of the item, e.g. "ruby_sword"') })
  .strict()

export const LIST_ITEMS_DESCRIPTION = `List the custom items of the pack (id, English name, kind, base item). Example: {}`
export const READ_ITEM_DESCRIPTION = `Read the whole definition of a custom item of the pack. Example: {"id":"ruby_sword"}`

/** The pack's items as list_items returns them. */
export function listItemsResult(items: readonly CustomItem[]): { count: number; items: string[] } {
  return { count: items.length, items: items.map((i) => `${itemRef(i)} - ${itemLine(i)}`) }
}

/** A definition as shown to the model: formatted JSON. */
export function definitionJson(value: unknown): string {
  return formatJson(value).trimEnd()
}
