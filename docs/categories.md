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

| Field     | Meaning                                                                                         |
| --------- | ----------------------------------------------------------------------------------------------- |
| `id`      | Stable identifier (`[a-z0-9_-]`, 1 to 40 characters), used by the UI and the agents             |
| `i18nKey` | Built-in categories: display name key, always `category.<id>` (in `src/shared/locales/*.json`)  |
| `label`   | Custom categories: plain-text name typed by the user (not translated); wins over `i18nKey`      |
| `icon`    | Pack path of the tile texture; when the pack has no such texture, the first texture is used     |
| `order`   | Display order (ascending)                                                                       |
| `include` | Globs on the texture key                                                                        |
| `exclude` | Optional globs removed from the category even when an include matches                           |
| `hidden`  | Optional; a hidden category matches nothing and is not shown (`other` can never be hidden)      |

A rule needs an `i18nKey` or a `label`.

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

## Editing the mapping in the app

The **Edit categories** button at the bottom of a pack's category sidebar opens the category editor. It has two tabs,
one per scope:

| Tab           | Stored in                                                    | What can be changed                                                                                        |
| ------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| **All packs** | `userData/categories.json` (same schema as the default)      | globs, icon and order of every category; hide a built-in one; add or delete custom ones; reset to defaults |
| **This pack** | `categoryOverrides` in the pack's `.blocksmith/project.json` | replace a category for this pack only (any field, including hiding it), or add categories to this pack     |

- **All packs** is the user's copy of the whole mapping. With no file (or an invalid one, kept as
  `categories.json.bak`), the defaults apply. "Reset to defaults" removes the file. Built-in categories cannot be
  deleted, only hidden; a built-in category missing from a saved file (added by a newer version of the app) is
  appended, so updates keep working.
- **This pack** rules are applied on top of **All packs**: a rule whose `id` exists replaces that category (it keeps its
  position in the list), any other rule adds a category. An invalid `categoryOverrides` value is ignored rather than
  hiding the pack.
- A custom category gets an id derived from its name ("Épées de feu" -> `epees_de_feu`, made unique) and keeps that
  id when renamed. Its name is shown as typed, in every language.
- `other` (the fallback) always exists and cannot be deleted or hidden.

While editing, the editor works on the textures of the current pack: each category shows how many textures it would
hold, each glob how many textures it matches, invalid globs are flagged inline (empty, unbalanced `{ }`, a leading `/`,
a backslash, longer than 512 characters) and block saving, and a **Test a path** field shows the categories a texture
key (`block/stone.png`) or pack path would get.

### Saving and where the mapping is applied

- `categories.save` / `categories.reset` (All packs) and `pack.setCategoryOverrides` (This pack) validate the rules again
  in main (`validateCategoryRules` in `src/shared/categories/mapping.ts`). A bad glob is refused with the typed error
  `categories.invalidGlob`, a repeated id with `categories.duplicateId`, anything else with `categories.invalidRule`.
- After a save, main emits `packs.changed` (without a pack id for **All packs**), and every open pack tab reloads its
  textures and categories: the navigator, the grid filter and the counts follow the new mapping.
- The pack service resolves each pack's rules (`resolveCategoryRules`) and compiles one engine per distinct rule set
  (cached by the rules' JSON). The texture index is still built and cached once per pack; when the pack's engine is not
  the default one, the cached entries' `categories` are recomputed in place, once per index and engine.
- The creation agent filters by category id (any id, custom ones included) and its context lists custom categories with
  their label (`- epees_de_feu ("Épées de feu", custom): 12`).

## Changing the default mapping (developers)

1. Edit `resources/data/categories.json`. The file is validated with zod when the module loads
   (`CategoryMappingSchema` in `src/shared/categories/engine.ts`); an invalid file fails fast in tests.
2. For a new category, add its `category.<id>` string to **both** `src/shared/locales/en.json` and `fr.json`
   (the i18n parity test checks that both files have the same keys).
3. Add representative paths to `tests/unit/categories-engine.test.ts` and run `npx vitest run tests/unit/categories`.
