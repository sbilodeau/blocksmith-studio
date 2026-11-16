import type { StyleBrief, StyleBriefPatch } from '@shared/model/brief'

/**
 * Pure parts of a merge: which JSON files are combined automatically and how, and how style briefs are combined.
 * PLAN 8.6: lang files (key union), sounds.json (event union), atlases (source list union), fonts (provider union).
 */

export type MergeableKind = 'lang' | 'sounds' | 'atlas' | 'font'

/** Kind of an automatically merged JSON file, or null for files that are conflicts when they differ. */
export function mergeableKind(path: string): MergeableKind | null {
  if (/^assets\/[^/]+\/lang\/[^/]+\.json$/.test(path)) return 'lang'
  if (/^assets\/[^/]+\/sounds\.json$/.test(path)) return 'sounds'
  if (/^assets\/[^/]+\/atlases\/[^/]+\.json$/.test(path)) return 'atlas'
  if (/^assets\/[^/]+\/font\/[^/]+\.json$/.test(path)) return 'font'
  return null
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Union of arrays of JSON values, first occurrence wins, compared by JSON text. */
function unionArrays(lists: unknown[][]): unknown[] {
  const seen = new Set<string>()
  const out: unknown[] = []
  for (const list of lists) {
    for (const item of list) {
      const key = JSON.stringify(item)
      if (seen.has(key)) continue
      seen.add(key)
      out.push(item)
    }
  }
  return out
}

/**
 * Combines JSON documents of one mergeable kind, given highest priority first. Returns null when a document is not
 * the expected shape (the file is then treated as a conflict).
 * - lang / sounds: key union; for the same key, the highest-priority document wins.
 * - atlas: `sources` lists combined (highest priority first, duplicates removed), other keys from the top document.
 * - font: `providers` lists combined the same way.
 */
export function combineJson(kind: MergeableKind, docs: readonly unknown[]): unknown | null {
  if (docs.length === 0 || !docs.every(isObject)) return null
  const objects = docs as Array<Record<string, unknown>>
  if (kind === 'lang' || kind === 'sounds') {
    const out: Record<string, unknown> = {}
    for (const doc of [...objects].reverse()) Object.assign(out, doc)
    // Keep the top document's key order first, then keys only found in lower ones.
    const ordered: Record<string, unknown> = {}
    for (const doc of objects)
      for (const key of Object.keys(doc)) if (!(key in ordered)) ordered[key] = out[key]
    return ordered
  }
  const listKey = kind === 'atlas' ? 'sources' : 'providers'
  if (!objects.every((d) => d[listKey] === undefined || Array.isArray(d[listKey]))) return null
  return {
    ...objects[0],
    [listKey]: unionArrays(objects.map((d) => (d[listKey] as unknown[] | undefined) ?? []))
  }
}

/**
 * Patch that merges source briefs into the target brief: palette colors and rules not yet in the target are
 * appended (limits 32 and 40), the theme is kept (or taken from the first source when the target has none).
 * Returns null when nothing would change.
 */
export function combineBriefs(
  target: StyleBrief,
  sources: readonly StyleBrief[]
): StyleBriefPatch | null {
  const palette = [...target.palette]
  const hexes = new Set(palette.map((p) => p.hex.toLowerCase()))
  for (const s of sources) {
    for (const color of s.palette) {
      if (palette.length >= 32 || hexes.has(color.hex.toLowerCase())) continue
      hexes.add(color.hex.toLowerCase())
      palette.push(color)
    }
  }
  const rules = [...target.rules]
  for (const s of sources) {
    for (const rule of s.rules) if (rules.length < 40 && !rules.includes(rule)) rules.push(rule)
  }
  const theme = target.theme || sources.find((s) => s.theme)?.theme || ''
  const patch: StyleBriefPatch = {}
  if (palette.length !== target.palette.length) patch.palette = palette
  if (rules.length !== target.rules.length) patch.rules = rules
  if (theme !== target.theme) patch.theme = theme
  return Object.keys(patch).length ? patch : null
}
