import { z } from 'zod'
import raw from '../../../resources/data/custom-items.json'
import {
  ARMOR_SLOTS,
  ITEM_REF_RE,
  TOOL_TYPES,
  type ArmorSlot,
  type CustomItemInput,
  type ItemKind,
  type ToolType
} from './schema'

const TexturePath = z.string().regex(/^assets\/minecraft\/textures\/[a-z0-9_./-]+\.png$/)
const ItemPart = z.record(z.string(), z.unknown())
const Variant = z.object({
  base: z.string().regex(ITEM_REF_RE),
  textureFrom: TexturePath,
  item: ItemPart
})
const Common = z.object({
  handheld: z.boolean(),
  removeComponents: z.array(z.string().regex(ITEM_REF_RE))
})
const Single = Common.extend({
  base: z.string().regex(ITEM_REF_RE),
  textureFrom: TexturePath,
  item: ItemPart
})

const PresetTableSchema = z.object({
  schemaVersion: z.literal(1),
  description: z.string(),
  kinds: z.object({
    simple: Single,
    food: Single,
    weapon: Single,
    tool: Common.extend({ variants: z.record(z.enum(TOOL_TYPES), Variant) }),
    armor: Common.extend({
      wornTextureFrom: z.object({ humanoid: TexturePath, humanoid_leggings: TexturePath }),
      variants: z.record(z.enum(ARMOR_SLOTS), Variant)
    })
  })
})

/** resources/data/custom-items.json, validated once at load. */
export const itemPresets = PresetTableSchema.parse(raw)

/** Tool type for tools, slot for armor; ignored by the other kinds. */
export type ItemVariant = ToolType | ArmorSlot

export interface ItemPreset {
  base: string
  /** Vanilla texture a new item starts from. */
  textureFrom: string
  /** Fields of a new definition (id, namespace and names are added by the caller). */
  item: Partial<CustomItemInput>
}

/** Default variant of each kind that has variants. */
export const DEFAULT_VARIANT: Partial<Record<ItemKind, ItemVariant>> = {
  tool: 'pickaxe',
  armor: 'head'
}

/** The starting point of a new item of `kind` (and tool type / armor slot). */
export function itemPreset(kind: ItemKind, variant?: ItemVariant): ItemPreset {
  const k = itemPresets.kinds
  const common = { handheld: k[kind].handheld, removeComponents: [...k[kind].removeComponents] }
  if (kind === 'tool' || kind === 'armor') {
    const variants = k[kind].variants as Record<string, z.infer<typeof Variant>>
    const v = variants[variant ?? DEFAULT_VARIANT[kind]!] ?? variants[DEFAULT_VARIANT[kind]!]!
    return {
      base: v.base,
      textureFrom: v.textureFrom,
      item: { kind, base: v.base, ...common, ...structuredClone(v.item) }
    }
  }
  const s = k[kind]
  return {
    base: s.base,
    textureFrom: s.textureFrom,
    item: { kind, base: s.base, ...common, ...structuredClone(s.item) }
  }
}

/** Vanilla worn armor texture a new armor piece's worn texture starts from. */
export function wornTexturePreset(slot: ArmorSlot): string {
  const worn = itemPresets.kinds.armor.wornTextureFrom
  return slot === 'legs' ? worn.humanoid_leggings : worn.humanoid
}
