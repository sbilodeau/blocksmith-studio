# Texture categories

The navigator groups textures into categories (blocks, tools, food...). The mapping is plain data in
[`resources/data/categories.json`](../resources/data/categories.json); the engine that applies it lives in
[`src/shared/categories/`](../src/shared/categories/) (pure TypeScript, no Electron or DOM, usable from every process).

## How matching works

- Each texture is matched by its **texture key**: the pack path below `assets/<namespace>/textures/`.
  `assets/minecraft/textures/block/stone.png` has the key `block/stone.png`. The namespace is ignored, so the same
  rules also sort textures added by mods or custom namespaces.
- A rule matches when at least one `include` glob matches and no `exclude` glob matches.
- A texture can be in **several** categories (`block/diamond_ore.png` is in both `blocks` and `ores`).
- Textures that match no rule go to `other`. The engine adds `other` automatically if the mapping forgets it.
- Categories are shown in ascending `order`; categories with no texture in the current pack are hidden.

### Glob syntax

| Pattern | Matches                                                  | Example                                         |
| ------- | -------------------------------------------------------- | ----------------------------------------------- |
| `*`     | any characters except `/`                                | `block/*_ore.png` matches `block/iron_ore.png`  |
| `**`    | any characters including `/`                             | `entity/**` matches `entity/zombie/zombie.png`  |
| `**/`   | zero or more whole folders                               | `**/heart/*.png` matches `gui/heart/full.png`   |
| `?`     | exactly one character except `/`                         | `item/clock_0?.png` matches `item/clock_04.png` |
| `{a,b}` | one of the alternatives (can nest and contain wildcards) | `item/{apple,bread}.png`                        |

Everything else is literal and case-sensitive. Globs are anchored: they must match the whole key.

## Rule format

```json
{
  "id": "ores",
  "i18nKey": "category.ores",
  "icon": "assets/minecraft/textures/block/diamond_ore.png",
  "order": 20,
  "include": ["block/*_ore.png", "block/raw_*_block.png", "item/raw_*.png"],
  "exclude": []
}
```

| Field     | Meaning                                                                                     |
| --------- | ------------------------------------------------------------------------------------------- |
| `id`      | Stable identifier (`[a-z0-9_-]`), used by the UI and the agents                             |
| `i18nKey` | Display name key, always `category.<id>` (strings live in `src/shared/locales/*.json`)      |
| `icon`    | Pack path of the tile texture; when the pack has no such texture, the first texture is used |
| `order`   | Display order (ascending)                                                                   |
| `include` | Globs on the texture key                                                                    |
| `exclude` | Optional globs removed from the category even when an include matches                       |

## Default mapping

Built from the Minecraft 1.21.4 texture listing and written to stay valid for 1.21.4 to 26.3 (new items such as copper
tools or spears are caught by the wildcard patterns).

| Order | Id            | What it contains                                                                                                                  |
| ----- | ------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 10    | `blocks`      | `block/**`, plus item textures of placeable blocks (doors, signs, candles, lanterns, campfires...)                                |
| 20    | `ores`        | `block/*_ore.png`, `block/raw_*_block.png`, `block/ancient_debris_*.png`, `item/raw_*.png`                                        |
| 30    | `tools`       | pickaxes, axes, shovels, hoes, buckets, compasses, clocks, fishing rod, spyglass, brush, shears...                                |
| 40    | `weapons`     | swords, spears, bow and crossbow (all states), arrows, trident, mace                                                              |
| 50    | `armor`       | helmets, chestplates, leggings, boots (and overlays), horse/wolf armor, elytra, trim templates, `entity/equipment/**`, `trims/**` |
| 60    | `food`        | a curated list of edible items (apple, bread, meats, fish, stews, berries, milk bucket...)                                        |
| 70    | `materials`   | ingots, nuggets, dyes, gems, dusts, rods, mob drops, seeds, pottery sherds, the netherite upgrade                                 |
| 80    | `entities`    | `entity/**` except `entity/equipment/**`                                                                                          |
| 90    | `gui`         | `gui/**`, `font/**`                                                                                                               |
| 100   | `particles`   | `particle/**`                                                                                                                     |
| 110   | `environment` | `environment/**`, `misc/**`, `painting/**`, `mob_effect/**`, `map/**`, `colormap/**`, `effect/**`                                 |
| 1000  | `other`       | everything else (boats, minecarts, music discs, bundles, potions, banner patterns...)                                             |

## Editing the mapping

1. Edit `resources/data/categories.json`. The file is validated with zod when the module loads
   (`CategoryMappingSchema` in `src/shared/categories/engine.ts`); an invalid file fails fast in tests.
2. For a new category, add its `category.<id>` string to **both** `src/shared/locales/en.json` and `fr.json`
   (the i18n parity test checks that both files have the same keys).
3. Add representative paths to `tests/unit/categories-engine.test.ts` and run `npx vitest run tests/unit/categories`.

Per-pack overrides (extra rules stored in a pack's `.blocksmith/project.json`) are planned for a later milestone.
