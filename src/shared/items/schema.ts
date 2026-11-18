import { z } from 'zod'
import { NAMESPACE_RE } from '../datapack/paths'

/**
 * Custom items (PLAN M14): a vanilla base item carrying data components, defined once in
 * `blocksmith/items/<id>.json` at the pack root. The game files (model, item definition, names, recipe, give
 * function...) are generated from the definition for each Minecraft version (generate.ts).
 */

/** Folder of the definitions at the pack root (a pack file, ignored by Minecraft, left out of exports). */
export const ITEMS_DIR = 'blocksmith/items'
/** `blocksmith/items/<id>.json` */
export const ITEM_DEF_RE = /^blocksmith\/items\/([a-z0-9_]{1,64})\.json$/

export const ITEM_KINDS = ['simple', 'food', 'weapon', 'tool', 'armor'] as const
export type ItemKind = (typeof ITEM_KINDS)[number]

export const TOOL_TYPES = ['pickaxe', 'axe', 'shovel', 'hoe'] as const
export type ToolType = (typeof TOOL_TYPES)[number]
/** Which blocks drop their items when mined: Minecraft's `incorrect_for_<tier>_tool` block tags. */
export const TOOL_TIERS = ['wooden', 'stone', 'iron', 'diamond', 'netherite'] as const
export type ToolTier = (typeof TOOL_TIERS)[number]
export const ARMOR_SLOTS = ['head', 'chest', 'legs', 'feet'] as const
export type ArmorSlot = (typeof ARMOR_SLOTS)[number]
export const RARITIES = ['common', 'uncommon', 'rare', 'epic'] as const

/** Item id inside the namespace: one path segment, so every generated path stays flat. */
export const ITEM_ID_RE = /^[a-z0-9_]{1,64}$/
/** "minecraft:stone_sword" */
export const ITEM_REF_RE = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/
/** An item id, or a #tag: "minecraft:diamond", "#minecraft:planks". */
export const INGREDIENT_RE = /^#?[a-z0-9_.-]+:[a-z0-9_./-]+$/
/** Component ids for extra and removed components: "minecraft:food" (a leading "!" removes it in extras). */
export const COMPONENT_ID_RE = /^!?[a-z0-9_.-]+:[a-z0-9_./-]+$/
/** Minecraft language codes: "en_us", "fr_fr", "fr_ca"... */
export const LANG_RE = /^[a-z]{2,3}_[a-z]{2,3}$/

const Name = z.string().trim().min(1).max(80)
/** Text in several languages; English is required (Minecraft falls back to it). */
export const NamesSchema = z
  .record(z.string().regex(LANG_RE), Name)
  .refine((n) => typeof n['en_us'] === 'string', { message: 'en_us' })
  .refine((n) => Object.keys(n).length <= 20)
export type ItemNames = z.infer<typeof NamesSchema>

const LoreLine = z
  .record(z.string().regex(LANG_RE), z.string().max(120))
  .refine((n) => typeof n['en_us'] === 'string', { message: 'en_us' })

export const EffectSchema = z
  .object({
    /** Effect id: "minecraft:night_vision". */
    effect: z.string().regex(ITEM_REF_RE),
    seconds: z.number().min(0.05).max(3600),
    /** 1 = level I (amplifier 0). */
    level: z.number().int().min(1).max(10).default(1),
    /** 0..1, 1 = always. */
    chance: z.number().min(0).max(1).default(1)
  })
  .strict()
export type ItemEffect = z.infer<typeof EffectSchema>

export const FoodSchema = z
  .object({
    /** Hunger points restored (2 = one drumstick). */
    nutrition: z.number().int().min(0).max(100),
    saturation: z.number().min(0).max(100),
    eatSeconds: z.number().min(0.05).max(60).default(1.6),
    alwaysEdible: z.boolean().default(false),
    animation: z.enum(['eat', 'drink']).default('eat'),
    effects: z.array(EffectSchema).max(8).default([])
  })
  .strict()

export const WeaponSchema = z
  .object({
    /** As shown in the tooltip ("7 Attack Damage"), the player's 1 included. */
    attackDamage: z.number().min(0).max(1000),
    /** Attacks per second, as shown in the tooltip (a sword: 1.6). */
    attackSpeed: z.number().min(0.1).max(100)
  })
  .strict()

export const ToolSchema = z
  .object({
    type: z.enum(TOOL_TYPES),
    tier: z.enum(TOOL_TIERS),
    miningSpeed: z.number().min(0.1).max(1000)
  })
  .strict()

export const ArmorSchema = z
  .object({
    slot: z.enum(ARMOR_SLOTS),
    armor: z.number().min(0).max(30),
    toughness: z.number().min(0).max(20).default(0),
    knockbackResistance: z.number().min(0).max(1).default(0)
  })
  .strict()

const Ingredient = z.string().regex(INGREDIENT_RE)
export const RecipeSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('shaped'),
      /** 3x3 grid, row by row; null = empty slot. */
      grid: z.array(Ingredient.nullable()).length(9),
      count: z.number().int().min(1).max(99).default(1)
    })
    .strict()
    .refine((r) => r.grid.some((s) => s !== null), { message: 'empty' }),
  z
    .object({
      type: z.literal('shapeless'),
      ingredients: z.array(Ingredient).min(1).max(9),
      count: z.number().int().min(1).max(99).default(1)
    })
    .strict()
])
export type ItemRecipe = z.infer<typeof RecipeSchema>

export const CustomItemSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().regex(ITEM_ID_RE),
    namespace: z
      .string()
      .regex(NAMESPACE_RE)
      .max(64)
      .refine((ns) => ns !== 'minecraft'),
    kind: z.enum(ITEM_KINDS),
    /** The vanilla item the custom item is in game: it keeps that item's behavior unless overridden. */
    base: z.string().regex(ITEM_REF_RE),
    names: NamesSchema,
    lore: z.array(LoreLine).max(8).default([]),
    /** Held like a tool (item/handheld) rather than flat (item/generated). */
    handheld: z.boolean().default(false),
    rarity: z.enum(RARITIES).optional(),
    glint: z.boolean().optional(),
    maxStack: z.number().int().min(1).max(99).optional(),
    durability: z.number().int().min(1).max(100000).optional(),
    /** Item or #tag that repairs it in an anvil. */
    repairWith: Ingredient.optional(),
    enchantability: z.number().int().min(1).max(255).optional(),
    food: FoodSchema.optional(),
    weapon: WeaponSchema.optional(),
    tool: ToolSchema.optional(),
    armor: ArmorSchema.optional(),
    /** Components of the base item to remove ("minecraft:food" on a non-food item based on a food). */
    removeComponents: z.array(z.string().regex(ITEM_REF_RE)).max(32).default([]),
    /** Raw components for experts, written as they are ("!minecraft:x": {} removes one). */
    extraComponents: z
      .record(z.string().regex(COMPONENT_ID_RE), z.unknown())
      .refine((c) => Object.keys(c).length <= 32)
      .default({}),
    recipe: RecipeSchema.nullable().default(null)
  })
  .strict()
  .superRefine((item, ctx) => {
    const need: Partial<Record<ItemKind, keyof CustomItem>> = {
      food: 'food',
      weapon: 'weapon',
      tool: 'tool',
      armor: 'armor'
    }
    const field = need[item.kind]
    if (field && item[field] === undefined) {
      ctx.addIssue({ code: 'custom', path: [field], message: 'required' })
    }
    if (item.durability !== undefined && item.maxStack !== undefined && item.maxStack > 1) {
      ctx.addIssue({ code: 'custom', path: ['maxStack'], message: 'durability' })
    }
  })
export type CustomItem = z.infer<typeof CustomItemSchema>
/** A definition as written by the form or the AI (fields with defaults are optional). */
export type CustomItemInput = z.input<typeof CustomItemSchema>

/** `blocksmith/items/<id>.json` */
export function itemDefPath(id: string): string {
  return `${ITEMS_DIR}/${id}.json`
}

/** "my_pack:ruby_sword" */
export function itemRef(item: Pick<CustomItem, 'namespace' | 'id'>): string {
  return `${item.namespace}:${item.id}`
}

/** The item's texture (drawn by the user): `assets/<ns>/textures/item/<id>.png`. */
export function itemTexturePath(item: Pick<CustomItem, 'namespace' | 'id'>): string {
  return `assets/${item.namespace}/textures/item/${item.id}.png`
}

/** Equipment layer drawn on the body for an armor slot. */
export function equipmentLayer(slot: ArmorSlot): 'humanoid' | 'humanoid_leggings' {
  return slot === 'legs' ? 'humanoid_leggings' : 'humanoid'
}

/** Worn texture of an armor piece: `assets/<ns>/textures/entity/equipment/<layer>/<id>.png`. */
export function armorTexturePath(
  item: Pick<CustomItem, 'namespace' | 'id' | 'armor'>
): string | null {
  if (!item.armor) return null
  return `assets/${item.namespace}/textures/entity/equipment/${equipmentLayer(item.armor.slot)}/${item.id}.png`
}

/** Lang key of the name: `item.<ns>.<id>` (lore lines: `item.<ns>.<id>.lore.<n>`). */
export function nameKey(item: Pick<CustomItem, 'namespace' | 'id'>): string {
  return `item.${item.namespace}.${item.id}`
}

/** "Ruby Sword!" -> "ruby_sword"; empty when nothing usable is left. */
export function itemIdFromName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64)
}

/** Parses a definition file; null when it is not valid JSON or not a valid definition. */
export function parseItem(text: string): CustomItem | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  const r = CustomItemSchema.safeParse(raw)
  return r.success ? r.data : null
}
