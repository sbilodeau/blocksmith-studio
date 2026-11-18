import type { ItemFormat } from './formats'
import {
  generateItemFiles,
  generatedPaths,
  itemDefinitionText,
  langEntries,
  langPath,
  updateLangFiles
} from './generate'
import {
  ITEM_DEF_RE,
  armorTexturePath,
  itemTexturePath,
  parseItem,
  type CustomItem
} from './schema'

/** One file of a change set: new text, or null to delete it. */
export interface ItemFileChange {
  path: string
  text: string | null
}

/** Reads a lang file of the pack as an object; null when absent. Throws on a file that is not a JSON object. */
export type LangReader = (path: string) => Record<string, string> | null

export interface ItemChangeInput {
  /** The saved definition (null for a new item). */
  before: CustomItem | null
  /** The new definition (null deletes the item). */
  after: CustomItem | null
  /** The pack's other items (their names stay in the shared lang files). */
  others: readonly CustomItem[]
  format: ItemFormat
  readLang: LangReader
}

function langsOf(item: CustomItem | null): string[] {
  return item ? Object.keys(langEntries(item)) : []
}

/**
 * Every pack file a save, rename or delete changes, the definition included (textures aside: the caller copies,
 * moves or removes them). Files of `before` that `after` no longer generates are deleted.
 */
export function itemChanges({
  before,
  after,
  others,
  format,
  readLang
}: ItemChangeInput): ItemFileChange[] {
  const changes = new Map<string, string | null>()
  if (before) {
    for (const path of generatedPaths(before)) changes.set(path, null)
    if (!after || after.id !== before.id) changes.set(itemDefinitionText(before).path, null)
  }
  if (after) {
    const def = itemDefinitionText(after)
    changes.set(def.path, def.text)
    for (const file of generateItemFiles(after, format)) changes.set(file.path, file.text)
  }
  const namespaces = new Set([before?.namespace, after?.namespace].filter((n): n is string => !!n))
  const items = [...others.filter((o) => o.id !== before?.id && o.id !== after?.id)]
  if (after) items.push(after)
  for (const ns of namespaces) {
    const langs = new Set([...langsOf(before), ...langsOf(after)])
    const dropped = before ? [before] : []
    for (const file of updateLangFiles(ns, items, dropped, readLang, langs)) {
      changes.set(file.path, file.text)
    }
  }
  return [...changes].map(([path, text]) => ({ path, text }))
}

/** The definitions found in pack files; invalid ones are listed by path. */
export function parseItemFiles(files: Iterable<{ path: string; text: string }>): {
  items: CustomItem[]
  invalid: string[]
} {
  const items: CustomItem[] = []
  const invalid: string[] = []
  for (const { path, text } of files) {
    const m = ITEM_DEF_RE.exec(path)
    if (!m) continue
    const item = parseItem(text)
    if (item && item.id === m[1]) items.push(item)
    else invalid.push(path)
  }
  return { items, invalid }
}

/**
 * The files of a pack as exported for a version: each item's files generated in that version's format and the lang
 * files updated; `blocksmith/` itself is left out (Minecraft does not read it).
 */
export function exportItemFiles(
  files: ReadonlyArray<{ path: string; data: Uint8Array }>,
  format: ItemFormat
): { files: Array<{ path: string; data: Uint8Array }>; invalid: string[] } {
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  const defs = files.filter((f) => ITEM_DEF_RE.test(f.path))
  const { items, invalid } = parseItemFiles(
    defs.map((f) => ({ path: f.path, text: decoder.decode(f.data) }))
  )
  const byPath = new Map(
    files.filter((f) => !f.path.startsWith('blocksmith/')).map((f) => [f.path, f.data])
  )
  if (items.length > 0) {
    const readLang: LangReader = (path) => {
      const data = byPath.get(path)
      if (!data) return null
      try {
        const v = JSON.parse(decoder.decode(data)) as unknown
        return v && typeof v === 'object' && !Array.isArray(v)
          ? (v as Record<string, string>)
          : null
      } catch {
        return null
      }
    }
    for (const item of items) {
      for (const file of generateItemFiles(item, format))
        byPath.set(file.path, encoder.encode(file.text))
    }
    const namespaces = new Set(items.map((i) => i.namespace))
    for (const ns of namespaces) {
      const langs = new Set(items.filter((i) => i.namespace === ns).flatMap(langsOf))
      for (const file of updateLangFiles(ns, items, [], readLang, langs)) {
        if (file.text === null) byPath.delete(file.path)
        else byPath.set(file.path, encoder.encode(file.text))
      }
    }
  }
  return { files: [...byPath].map(([path, data]) => ({ path, data })), invalid }
}

/** Pack Doctor issue about a custom item; `itemId` lets the drawer offer "Regenerate". */
export interface ItemIssue {
  code: string
  path: string
  itemId?: string
}

export interface ItemCheckInput {
  /** Every pack file path (textures included). */
  paths: ReadonlySet<string>
  /** Text of a pack file (definitions, generated files, lang files); null when absent. */
  read: (path: string) => string | null
  format: ItemFormat
  /** Vanilla item ids of the authoring version; null when vanilla is not extracted (no id checks). */
  vanillaItems: ReadonlySet<string> | null
}

const normalize = (text: string): string => text.replace(/\r\n/g, '\n')

/** Pack Doctor checks of the custom items (codes `items.*`, i18n `warnings.items.*`). */
export function checkItems({ paths, read, format, vanillaItems }: ItemCheckInput): ItemIssue[] {
  const issues: ItemIssue[] = []
  const defPaths = [...paths].filter((p) => ITEM_DEF_RE.test(p)).sort()
  const { items, invalid } = parseItemFiles(
    defPaths.map((path) => ({ path, text: read(path) ?? '' }))
  )
  for (const path of invalid) issues.push({ code: 'items.invalidDefinition', path })
  for (const item of items) {
    const itemId = item.id
    const def = itemDefinitionText(item).path
    for (const texture of [itemTexturePath(item), armorTexturePath(item)]) {
      if (texture && !paths.has(texture))
        issues.push({ code: 'items.missingTexture', path: texture, itemId })
    }
    if (vanillaItems && !vanillaItems.has(item.base)) {
      issues.push({ code: 'items.unknownBase', path: def, itemId })
    }
    if (vanillaItems && item.recipe) {
      const ingredients = item.recipe.type === 'shaped' ? item.recipe.grid : item.recipe.ingredients
      const unknown = ingredients.some(
        (i) => i !== null && i.startsWith('minecraft:') && !vanillaItems.has(i)
      )
      if (unknown) issues.push({ code: 'items.unknownIngredient', path: def, itemId })
    }
    for (const file of generateItemFiles(item, format)) {
      const current = read(file.path)
      if (current === null) issues.push({ code: 'items.generatedMissing', path: file.path, itemId })
      else if (normalize(current) !== file.text) {
        issues.push({ code: 'items.generatedEdited', path: file.path, itemId })
      }
    }
    for (const [lang, entries] of Object.entries(langEntries(item))) {
      const path = langPath(item.namespace, lang)
      let current: Record<string, unknown> = {}
      try {
        current = JSON.parse(read(path) ?? '{}') as Record<string, unknown>
      } catch {
        // An unreadable lang file is reported by the pack's JSON checks.
      }
      const stale = Object.entries(entries).some(([k, v]) => current[k] !== v)
      if (stale) issues.push({ code: 'items.langOutdated', path, itemId })
    }
  }
  return issues
}

/** The item whose generated files include `path` (data editor: read-only notice), if any. */
export function itemGenerating(path: string, items: readonly CustomItem[]): CustomItem | null {
  return items.find((i) => generatedPaths(i).includes(path)) ?? null
}
