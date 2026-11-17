import { parseDataPath } from './paths'
import type { DataContext } from './schemas'

/** Ids a pack can refer to (sent over IPC as plain arrays). */
export interface DataIds {
  /** "minecraft:stone"... from the vanilla item model definitions (assets/minecraft/items/*.json, 1.21.4+). */
  items: string[]
  /** From the vanilla blockstates (assets/minecraft/blockstates/*.json). */
  blocks: string[]
  /** Tag ids per registry, vanilla and the pack's own: { item: ["minecraft:planks", "my_pack:gems"] }. */
  tags: Record<string, string[]>
}

const ITEM_DEF = /^assets\/minecraft\/items\/([a-z0-9_.\-/]+)\.json$/
const BLOCKSTATE = /^assets\/minecraft\/blockstates\/([a-z0-9_.\-/]+)\.json$/

/** Collects item, block and tag ids from file paths (vanilla index entries and pack files). */
export function collectDataIds(paths: Iterable<string>): DataIds {
  const items = new Set<string>()
  const blocks = new Set<string>()
  const tags: Record<string, Set<string>> = {}
  for (const path of paths) {
    let m = ITEM_DEF.exec(path)
    if (m) {
      items.add(`minecraft:${m[1]}`)
      continue
    }
    m = BLOCKSTATE.exec(path)
    if (m) {
      blocks.add(`minecraft:${m[1]}`)
      continue
    }
    if (path.startsWith('data/')) {
      const info = parseDataPath(path)
      if (info?.kind === 'tag' && info.registry) (tags[info.registry] ??= new Set()).add(info.id)
    }
  }
  const sorted = (s: Set<string>): string[] => [...s].sort()
  return {
    items: sorted(items),
    blocks: sorted(blocks),
    tags: Object.fromEntries(Object.entries(tags).map(([k, v]) => [k, sorted(v)]))
  }
}

/**
 * Validation context from id lists. Without vanilla items (vanilla not extracted) nothing is reported as unknown:
 * the check would flag every id.
 */
export function dataContext(ids: DataIds | null | undefined): DataContext {
  if (!ids || ids.items.length === 0) return {}
  return {
    items: new Set(ids.items),
    blocks: new Set(ids.blocks),
    tags: Object.fromEntries(Object.entries(ids.tags).map(([k, v]) => [k, new Set(v)]))
  }
}
