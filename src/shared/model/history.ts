import type { PackPath } from './pack'

/** One entry of a pack's persisted operation journal (.blocksmith/history/journal.jsonl). */
export interface HistoryEntry {
  id: string
  at: string
  source: 'editor' | 'revert' | 'ai' | 'bulk' | 'import' | 'merge'
  /** i18n key under `history.label.*` plus params, e.g. { key: 'save', params: { name: 'stone' } } */
  label: { key: string; params?: Record<string, string | number> }
  paths: PackPath[]
  /** false once undone (it can be redone until a new entry is recorded). */
  applied: boolean
}

export interface HistoryState {
  entries: HistoryEntry[]
  canUndo: boolean
  canRedo: boolean
}

/** Raw bytes of a texture as seen by a pack. */
export interface TextureData {
  path: PackPath
  /** PNG bytes; null when the file does not exist (neither in the pack nor in vanilla). */
  png: Uint8Array | null
  /** Where `png` came from. */
  origin: 'pack' | 'vanilla' | 'none'
  /** The vanilla version of the same path (for compare / revert), when the pack is vanilla-based. */
  vanillaPng: Uint8Array | null
  /** Sibling .png.mcmeta text (pack first, then vanilla), if any. */
  mcmeta: string | null
}
