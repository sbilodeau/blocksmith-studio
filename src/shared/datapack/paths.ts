/**
 * Data pack file paths (PLAN M10). A data file lives at `data/<namespace>/<folder>/<path>.<ext>`; the folder says
 * what it is. Folder names are singular since Minecraft 1.21 (`recipe`, `loot_table`, `advancement`, `function`),
 * which covers the whole support window.
 */

/** Kinds of data files the app knows. `other` is any other JSON file under data/ (predicates, worldgen...). */
export const DATA_KINDS = [
  'recipe',
  'loot_table',
  'tag',
  'advancement',
  'function',
  'other'
] as const
export type DataKind = (typeof DATA_KINDS)[number]

/** Kinds checked against a schema (the others are only checked to be valid JSON, or not at all for functions). */
export const VALIDATED_KINDS: readonly DataKind[] = ['recipe', 'loot_table', 'tag', 'advancement']

/** Folder under data/<namespace>/ for each kind (tags add their registry: tags/item, tags/block...). */
export const KIND_FOLDERS: Record<Exclude<DataKind, 'other'>, string> = {
  recipe: 'recipe',
  loot_table: 'loot_table',
  tag: 'tags',
  advancement: 'advancement',
  function: 'function'
}

/** Tag registries offered when creating a tag (any registry folder is accepted when reading). */
export const TAG_REGISTRIES = [
  'item',
  'block',
  'entity_type',
  'fluid',
  'game_event',
  'damage_type',
  'enchantment'
] as const

/** Namespace: lowercase letters, digits, "_", "-" and ".". */
export const NAMESPACE_RE = /^[a-z0-9_.-]+$/
/** Path part of a resource location: the same characters plus "/". */
export const ID_PATH_RE = /^[a-z0-9_.\-/]+$/

/** Any file of a data pack the app edits: JSON, or a .mcfunction text file. */
const DATA_FILE_RE = /^data\/([a-z0-9_.-]+)\/([a-z0-9_.\-/]+)\.(json|mcfunction)$/

/** Vanilla data copied from the client jar into the vanilla cache (the four validated kinds). */
export const VANILLA_DATA_RE = /^data\/minecraft\/(recipe|loot_table|tags|advancement)\/.+\.json$/

export interface DataPathInfo {
  path: string
  namespace: string
  kind: DataKind
  /** Resource location of the file, e.g. "minecraft:oak_planks" (a tag: "minecraft:planks", without "#"). */
  id: string
  /** Tags only: the registry folder, e.g. "item", "block", "worldgen/biome". */
  registry?: string
  /** Last path segment without extension: "oak_planks". */
  name: string
  /** Text file (.mcfunction) instead of JSON. */
  text: boolean
}

/** Parses a pack path under data/. Null when it is not an editable data file (or has invalid characters). */
export function parseDataPath(path: string): DataPathInfo | null {
  const m = DATA_FILE_RE.exec(path)
  if (!m) return null
  const [, namespace, rest, ext] = m as unknown as [string, string, string, string]
  const segments = rest.split('/')
  if (segments.some((s) => s === '' || s === '.' || s === '..')) return null
  const name = segments[segments.length - 1]!
  const folder = segments[0]!
  const text = ext === 'mcfunction'
  const base = { path, namespace, name, text }
  if (text) {
    return folder === 'function' && segments.length > 1
      ? { ...base, kind: 'function', id: `${namespace}:${segments.slice(1).join('/')}` }
      : { ...base, kind: 'other', id: `${namespace}:${rest}` }
  }
  if (folder === 'tags') {
    // tags/<registry>/<id>; worldgen registries take two segments (tags/worldgen/biome/...).
    const width = segments[1] === 'worldgen' ? 2 : 1
    if (segments.length < 2 + width) return { ...base, kind: 'other', id: `${namespace}:${rest}` }
    return {
      ...base,
      kind: 'tag',
      registry: segments.slice(1, 1 + width).join('/'),
      id: `${namespace}:${segments.slice(1 + width).join('/')}`
    }
  }
  const kind = (
    { recipe: 'recipe', loot_table: 'loot_table', advancement: 'advancement' } as const
  )[folder as 'recipe' | 'loot_table' | 'advancement']
  if (kind && segments.length > 1) {
    return { ...base, kind, id: `${namespace}:${segments.slice(1).join('/')}` }
  }
  return { ...base, kind: 'other', id: `${namespace}:${rest}` }
}

/**
 * Pack path of a new data file. `name` may contain "/" (sub folders); for `other`, it is the whole path under the
 * namespace (folder included) and must end in .json. Null when a part has invalid characters.
 */
export function buildDataPath(
  kind: DataKind,
  namespace: string,
  name: string,
  registry = 'item'
): string | null {
  const clean = name.trim().replace(/^\/+|\/+$/g, '')
  if (!NAMESPACE_RE.test(namespace) || !clean || !ID_PATH_RE.test(clean)) return null
  if (clean.split('/').some((s) => s === '' || s === '.' || s === '..')) return null
  let path: string
  if (kind === 'other') {
    path = `data/${namespace}/${clean.endsWith('.json') ? clean : `${clean}.json`}`
  } else if (kind === 'tag') {
    if (!ID_PATH_RE.test(registry)) return null
    path = `data/${namespace}/tags/${registry}/${clean}.json`
  } else {
    path = `data/${namespace}/${KIND_FOLDERS[kind]}/${clean}.${kind === 'function' ? 'mcfunction' : 'json'}`
  }
  return parseDataPath(path) ? path : null
}

/** Default namespace for a pack's own content: its name as a namespace ("Fire Pack!" -> "fire_pack"). */
export function namespaceFor(packName: string): string {
  const ns = packName
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32)
  return ns && ns !== 'minecraft' ? ns : 'my_pack'
}
