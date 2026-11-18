import type { DataKind } from '../datapack/paths'
import type { DataIds } from '../datapack/ids'
import type { PackPath } from './pack'

export type DataStatus = 'vanilla' | 'modified' | 'added'

/** One data file as seen by a pack: the pack's file if present, otherwise the vanilla one (copy-on-write). */
export interface DataEntry {
  path: PackPath
  namespace: string
  kind: DataKind
  /** Resource location: "minecraft:oak_planks" (tags without "#"). */
  id: string
  /** Tags: "item", "block", "worldgen/biome"... */
  registry?: string
  status: DataStatus
}

/** What the data browser shows for a pack. */
export interface DataList {
  entries: DataEntry[]
  /**
   * False when the pack is vanilla-based but the vanilla data of its version is not available (version extracted
   * before data support and its jar is gone): only the pack's own files are listed.
   */
  vanillaData: boolean
  /** Ids for completion and "unknown item" warnings. */
  ids: DataIds
}

/** Text of a data file as seen by a pack. */
export interface DataFileData {
  path: PackPath
  /** UTF-8 text; null when the file exists neither in the pack nor in vanilla. */
  text: string | null
  origin: 'pack' | 'vanilla' | 'none'
  /** The vanilla file at the same path (compare / revert), for vanilla-based packs. */
  vanillaText: string | null
  /** Id of the custom item that generates this file (M14): edit the item, not the file. */
  generatedBy?: string
}

/** Largest data file accepted by data.save (vanilla's biggest is about 100 KB). */
export const MAX_DATA_FILE_BYTES = 1024 * 1024
