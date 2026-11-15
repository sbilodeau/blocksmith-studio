/**
 * Default tint colors for faces with a `tintindex`. In game these come from Java code (biome colormaps, redstone
 * power...), so the preview uses fixed plains-biome values. See docs/preview.md for the table.
 */

export const GRASS_TINT = '#91bd59'
export const FOLIAGE_TINT = '#77ab2f'
export const BIRCH_TINT = '#80a755'
export const SPRUCE_TINT = '#619961'
export const WATER_TINT = '#3f76e4'
/** Redstone wire at power 15 (vanilla formula: r 1.0, g 0.2, b 0.0). */
export const REDSTONE_TINT = '#ff3300'
/** Fully grown melon/pumpkin stem (age 7) and attached stems. */
export const STEM_TINT = '#e0c71c'
export const LILY_PAD_TINT = '#208030'
/** Blocks whose models have a tintindex but no color handler in game (rendered untinted). */
export const NO_TINT = '#ffffff'
/** Any other tinted face. */
export const DEFAULT_TINT = GRASS_TINT

/** Block (or model) name without namespace -> tint color. */
export const TINT_TABLE: Readonly<Record<string, string>> = {
  grass_block: GRASS_TINT,
  short_grass: GRASS_TINT,
  tall_grass: GRASS_TINT,
  fern: GRASS_TINT,
  large_fern: GRASS_TINT,
  potted_fern: GRASS_TINT,
  sugar_cane: GRASS_TINT,
  pink_petals: GRASS_TINT,
  oak_leaves: FOLIAGE_TINT,
  jungle_leaves: FOLIAGE_TINT,
  acacia_leaves: FOLIAGE_TINT,
  dark_oak_leaves: FOLIAGE_TINT,
  mangrove_leaves: FOLIAGE_TINT,
  vine: FOLIAGE_TINT,
  birch_leaves: BIRCH_TINT,
  spruce_leaves: SPRUCE_TINT,
  water: WATER_TINT,
  bubble_column: WATER_TINT,
  water_cauldron: WATER_TINT,
  redstone_wire: REDSTONE_TINT,
  redstone_dust: REDSTONE_TINT,
  melon_stem: STEM_TINT,
  pumpkin_stem: STEM_TINT,
  attached_melon_stem: STEM_TINT,
  attached_pumpkin_stem: STEM_TINT,
  lily_pad: LILY_PAD_TINT,
  cherry_leaves: NO_TINT,
  pale_oak_leaves: NO_TINT,
  bamboo: NO_TINT,
  bamboo_sapling: NO_TINT,
  stonecutter: NO_TINT,
  small_dripleaf: NO_TINT,
  lava_cauldron: NO_TINT,
  powder_snow_cauldron: NO_TINT
}

/** "minecraft:block/oak_leaves" or "oak_leaves" -> "oak_leaves". */
function baseName(name: string): string {
  return name.slice(Math.max(name.lastIndexOf(':'), name.lastIndexOf('/')) + 1)
}

/**
 * Tint from the table for a block or model name, trying the name then shorter "_" prefixes
 * ("water_cauldron_level1" -> "water_cauldron"), then any "*_leaves" as foliage. Undefined when nothing matches.
 */
export function knownTint(name: string): string | undefined {
  const parts = baseName(name).split('_')
  for (let n = parts.length; n > 0; n--) {
    const hit = TINT_TABLE[parts.slice(0, n).join('_')]
    if (hit) return hit
  }
  return baseName(name).endsWith('_leaves') ? FOLIAGE_TINT : undefined
}

/** Tint color for a tinted face of `name` (DEFAULT_TINT when unknown). */
export function tintFor(name: string): string {
  return knownTint(name) ?? DEFAULT_TINT
}
