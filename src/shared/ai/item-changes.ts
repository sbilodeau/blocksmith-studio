/**
 * Readable differences between two custom item definitions (M14), for the review of an item-agent proposal: one entry
 * per field a player cares about (names, stats, effects, recipe), with values already shortened for display. The
 * definition before may come from an unsaved form and not be valid, so every reader is defensive.
 */

/** A displayed value: text, number, flag, or null when the field is not set. */
export type ItemValue = string | number | boolean | null

export interface ItemFieldChange {
  /** Label key under `itemAgent.fields`. */
  field: string
  /** Label params ({ lang } for names). */
  params?: Record<string, string>
  before: ItemValue
  after: ItemValue
}

type Obj = Record<string, unknown>

function obj(value: unknown): Obj | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Obj) : null
}

function at(value: unknown, path: string): unknown {
  let cur: unknown = value
  for (const key of path.split('.')) {
    const o = obj(cur)
    if (!o) return undefined
    cur = o[key]
  }
  return cur
}

/** "minecraft:redstone" -> "redstone"; other namespaces and tags are kept. */
function short(id: unknown): string {
  return typeof id === 'string' ? id.replace(/^minecraft:/, '') : '-'
}

function scalar(value: unknown): ItemValue {
  if (value === undefined || value === null) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  return JSON.stringify(value)
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X']

/** "regeneration II 10 s, night_vision I 30 s (50%)" */
function effects(value: unknown): ItemValue {
  if (!Array.isArray(value) || value.length === 0) return null
  return value
    .map((e) => {
      const o = obj(e)
      if (!o) return JSON.stringify(e)
      const level = typeof o['level'] === 'number' ? (ROMAN[o['level'] - 1] ?? o['level']) : 'I'
      const chance =
        typeof o['chance'] === 'number' && o['chance'] < 1
          ? ` (${Math.round(o['chance'] * 100)}%)`
          : ''
      return `${short(o['effect'])} ${level} ${String(o['seconds'] ?? '?')} s${chance}`
    })
    .join(', ')
}

/** Shaped: "emerald emerald emerald / - stick - / - stick - (x1)"; shapeless: "emerald + stick (x2)". */
function recipe(value: unknown): ItemValue {
  const o = obj(value)
  if (!o) return value === undefined || value === null ? null : JSON.stringify(value)
  const count = typeof o['count'] === 'number' ? o['count'] : 1
  if (o['type'] === 'shaped' && Array.isArray(o['grid'])) {
    const grid = o['grid'] as unknown[]
    const rows = [0, 1, 2].map((r) =>
      grid
        .slice(r * 3, r * 3 + 3)
        .map((s) => (s === null ? '-' : short(s)))
        .join(' ')
    )
    return `${rows.join(' / ')} (x${count})`
  }
  if (o['type'] === 'shapeless' && Array.isArray(o['ingredients'])) {
    return `${(o['ingredients'] as unknown[]).map(short).join(' + ')} (x${count})`
  }
  return JSON.stringify(value)
}

/** "en_us: A shiny gem | ..." */
function lore(value: unknown): ItemValue {
  if (!Array.isArray(value) || value.length === 0) return null
  return value
    .map((line) => {
      const o = obj(line)
      return o
        ? Object.entries(o)
            .map(([lang, text]) => `${lang}: ${String(text)}`)
            .join(', ')
        : JSON.stringify(line)
    })
    .join(' | ')
}

function list(value: unknown): ItemValue {
  return Array.isArray(value) && value.length ? value.map(String).join(', ') : null
}

function components(value: unknown): ItemValue {
  const o = obj(value)
  return o && Object.keys(o).length ? JSON.stringify(o) : null
}

/** Field label key, path in the definition, and how its value is shown. */
const FIELDS: Array<[string, string, (v: unknown) => ItemValue]> = [
  ['id', 'id', scalar],
  ['kind', 'kind', scalar],
  ['base', 'base', scalar],
  ['lore', 'lore', lore],
  ['handheld', 'handheld', scalar],
  ['rarity', 'rarity', scalar],
  ['glint', 'glint', scalar],
  ['maxStack', 'maxStack', scalar],
  ['durability', 'durability', scalar],
  ['repairWith', 'repairWith', scalar],
  ['enchantability', 'enchantability', scalar],
  ['attackDamage', 'weapon.attackDamage', scalar],
  ['attackSpeed', 'weapon.attackSpeed', scalar],
  ['toolType', 'tool.type', scalar],
  ['toolTier', 'tool.tier', scalar],
  ['miningSpeed', 'tool.miningSpeed', scalar],
  ['armorSlot', 'armor.slot', scalar],
  ['armor', 'armor.armor', scalar],
  ['toughness', 'armor.toughness', scalar],
  ['knockbackResistance', 'armor.knockbackResistance', scalar],
  ['nutrition', 'food.nutrition', scalar],
  ['saturation', 'food.saturation', scalar],
  ['eatSeconds', 'food.eatSeconds', scalar],
  ['alwaysEdible', 'food.alwaysEdible', scalar],
  ['animation', 'food.animation', scalar],
  ['effects', 'food.effects', effects],
  ['recipe', 'recipe', recipe],
  ['removeComponents', 'removeComponents', list],
  ['extraComponents', 'extraComponents', components]
]

/** The fields that differ between two definitions, names first (one entry per language). */
export function itemChangesBetween(before: unknown, after: unknown): ItemFieldChange[] {
  const out: ItemFieldChange[] = []
  const namesBefore = obj(at(before, 'names')) ?? {}
  const namesAfter = obj(at(after, 'names')) ?? {}
  const langs = [...new Set([...Object.keys(namesBefore), ...Object.keys(namesAfter)])].sort(
    (a, b) => (a === 'en_us' ? -1 : b === 'en_us' ? 1 : a.localeCompare(b))
  )
  for (const lang of langs) {
    const b = scalar(namesBefore[lang])
    const a = scalar(namesAfter[lang])
    if (a !== b) out.push({ field: 'name', params: { lang }, before: b, after: a })
  }
  for (const [field, path, show] of FIELDS) {
    const b = show(at(before, path))
    const a = show(at(after, path))
    if (a !== b) out.push({ field, before: b, after: a })
  }
  return out
}
