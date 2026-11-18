import type { CustomItem, ItemKind } from '../items/schema'

/** One custom item in the Items list (PLAN M14). */
export interface ItemSummary {
  id: string
  namespace: string
  kind: ItemKind
  base: string
  names: Record<string, string>
  /** `assets/<ns>/textures/item/<id>.png` */
  texture: string
  /** False when the texture file is missing (Pack Doctor: items.missingTexture). */
  hasTexture: boolean
}

export interface ItemList {
  items: ItemSummary[]
  /** Definition files that are not valid (shown so the user can fix or delete them). */
  invalid: string[]
  /** Namespace offered for new items: the one of the existing items, else the pack name as a namespace. */
  namespace: string
}

/** A vanilla item for pickers: English name and the texture of its icon (vanilla path), when known. */
export interface VanillaItemInfo {
  id: string
  name?: string
  icon?: string
}

/** Vanilla items and item tags of the pack's version (item picker, recipe grid). */
export interface ItemCatalog {
  version: string
  items: VanillaItemInfo[]
  /** "#minecraft:planks"... */
  tags: string[]
}

/** Facts about an unsaved definition, computed in main from vanilla data. */
export interface ItemContext {
  /** Vanilla recipes that take the base item as an ingredient ("minecraft:golden_apple"). */
  baseRecipeUses: string[]
}

/** Where a new item's texture comes from: a vanilla or pack texture path, or a blank 16x16 image (null). */
export type TextureSource = string | null

export interface ItemCreateInput {
  item: CustomItem
  textureFrom: TextureSource
}

export type { CustomItem }
