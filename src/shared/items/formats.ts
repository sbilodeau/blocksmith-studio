import type { McVersion } from '../model/versions'

/**
 * Item component formats that changed inside the support window (1.21.4 and later). Every version of the window
 * reads `item_model` and `assets/<ns>/items/` item definitions (1.21.4+), `equippable.asset_id` (1.21.4+),
 * `consumable` and `food` (1.21.2+), so only the differences below are version-dependent.
 */
export interface ItemFormat {
  /**
   * Text components (item_name, lore) are JSON objects in JSON files and SNBT compounds in commands from 1.21.5;
   * before, they are strings holding JSON (`"{\"translate\":...}"`).
   */
  textAsObject: boolean
  /**
   * 1.21.5 removed `show_in_tooltip`: attribute_modifiers is a plain list. Before, the full form
   * `{ modifiers: [...], show_in_tooltip: true }` is used (always accepted there).
   */
  modifiersAsList: boolean
}

/** Data pack format of 1.21.5, where the text and attribute modifier formats changed (25w02a..25w04a). */
const FORMATS_1_21_5 = 71

/** The formats a version reads, from its data pack format (works for snapshots too). */
export function itemFormatFor(version: Pick<McVersion, 'dataPack'>): ItemFormat {
  const modern = version.dataPack.major >= FORMATS_1_21_5
  return { textAsObject: modern, modifiersAsList: modern }
}

/** Formats of the newest versions (used when a version is unknown). */
export const LATEST_ITEM_FORMAT: ItemFormat = { textAsObject: true, modifiersAsList: true }
