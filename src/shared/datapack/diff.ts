/**
 * Structural differences between two versions of a data file, and the facts an explanation needs that the raw texts
 * hide (PLAN M10, "Explain"): what a tag file really changes once Minecraft merges it, and the ids a file names.
 */

export type JsonPath = Array<string | number>

export interface JsonChange {
  path: JsonPath
  kind: 'added' | 'removed' | 'changed'
  before?: unknown
  after?: unknown
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const isPrimitive = (v: unknown): boolean => v === null || typeof v !== 'object'

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/**
 * Changes from `before` to `after`, at most `max`. Objects are compared key by key; lists of plain values (tag values,
 * ingredient choices, pattern rows of different lengths) as sets of added / removed values, since a position means
 * little there; other lists item by item.
 */
export function jsonChanges(before: unknown, after: unknown, max = 60): JsonChange[] {
  const out: JsonChange[] = []
  const walk = (a: unknown, b: unknown, path: JsonPath): void => {
    if (out.length >= max || same(a, b)) return
    if (isObject(a) && isObject(b)) {
      for (const key of Object.keys(a)) {
        if (!(key in b)) out.push({ path: [...path, key], kind: 'removed', before: a[key] })
        else walk(a[key], b[key], [...path, key])
      }
      for (const key of Object.keys(b)) {
        if (!(key in a)) out.push({ path: [...path, key], kind: 'added', after: b[key] })
      }
      return
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      const plain = a.every(isPrimitive) && b.every(isPrimitive)
      if (plain && a.length !== b.length) {
        for (const v of a) {
          if (!b.some((w) => same(v, w))) out.push({ path, kind: 'removed', before: v })
        }
        for (const v of b) {
          if (!a.some((w) => same(v, w))) out.push({ path, kind: 'added', after: v })
        }
        return
      }
      const n = Math.max(a.length, b.length)
      for (let i = 0; i < n; i++) {
        if (i >= a.length) out.push({ path: [...path, i], kind: 'added', after: b[i] })
        else if (i >= b.length) out.push({ path: [...path, i], kind: 'removed', before: a[i] })
        else walk(a[i], b[i], [...path, i])
      }
      return
    }
    out.push({ path, kind: 'changed', before: a, after: b })
  }
  walk(before, after, [])
  return out.slice(0, max)
}

/** "pools[0].entries[1].name" */
export function pathText(path: JsonPath): string {
  if (path.length === 0) return '(whole file)'
  return path.map((p, i) => (typeof p === 'number' ? `[${p}]` : i === 0 ? p : `.${p}`)).join('')
}

function short(value: unknown, max = 300): string {
  const text = JSON.stringify(value)
  return text.length > max ? `${text.slice(0, max)}...` : text
}

/** One line per change, for a model prompt. */
export function formatChanges(changes: readonly JsonChange[]): string {
  return changes
    .map((c) => {
      const at = pathText(c.path)
      if (c.kind === 'added') return `- ${at}: added ${short(c.after)}`
      if (c.kind === 'removed') return `- ${at}: removed ${short(c.before)}`
      return `- ${at}: ${short(c.before)} -> ${short(c.after)}`
    })
    .join('\n')
}

/** Id of a tag value ("minecraft:oak_log", "#minecraft:logs", or { "id": ..., "required": false }). */
function tagValueId(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (isObject(value) && typeof value['id'] === 'string') return value['id']
  return undefined
}

/** Ids listed by a tag file (empty when it is not one). */
export function tagValues(tag: unknown): string[] {
  if (!isObject(tag) || !Array.isArray(tag['values'])) return []
  return tag['values'].map(tagValueId).filter((v): v is string => v !== undefined)
}

export interface TagEffect {
  /** "replace": true: the file replaces the list of the packs below it (vanilla) instead of adding to it. */
  replace: boolean
  /** The list the game ends up with (vanilla + this file, or this file alone with replace). */
  effective: string[]
  /** Ids the game gains compared with vanilla. */
  added: string[]
  /** Ids the game loses compared with vanilla (only possible with replace). */
  removed: string[]
  /** Vanilla ids missing from the file that the game still keeps, because the file does not use replace. */
  stillIncluded: string[]
}

/**
 * What a tag file at a vanilla tag's path does in game. Without "replace": true, Minecraft ADDS the file's values to
 * vanilla's: deleting a value from the file changes nothing.
 */
export function tagEffect(vanilla: unknown, current: unknown): TagEffect {
  const base = tagValues(vanilla)
  const own = tagValues(current)
  const replace = isObject(current) && current['replace'] === true
  const effective = replace ? [...new Set(own)] : [...new Set([...base, ...own])]
  return {
    replace,
    effective,
    added: effective.filter((v) => !base.includes(v)),
    removed: base.filter((v) => !effective.includes(v)),
    stillIncluded: replace ? [] : base.filter((v) => !own.includes(v))
  }
}

const ID_RE = /^#?[a-z0-9_.-]+:[a-z0-9_./-]+$/

/** Namespaced ids and #tags a JSON value names (strings anywhere in it), in order, without duplicates. */
export function referencedIds(value: unknown, max = 200): string[] {
  const found = new Set<string>()
  const walk = (v: unknown): void => {
    if (found.size >= max) return
    if (typeof v === 'string') {
      if (ID_RE.test(v)) found.add(v)
    } else if (Array.isArray(v)) v.forEach(walk)
    else if (isObject(v)) Object.values(v).forEach(walk)
  }
  walk(value)
  return [...found]
}
