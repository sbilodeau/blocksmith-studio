# Custom items

How Blocksmith Studio makes new items that work in unmodded Minecraft (PLAN M14): the definition file, the files
generated from it for each Minecraft version, the checks, and the IPC. Code: `src/shared/items/` (schema, presets,
formats, generation, change sets, checks, recipe uses), `src/main/services/items/`, `src/main/ipc/item-handlers.ts`,
`src/renderer/components/items/` and `src/renderer/stores/items.ts`. The AI side (item agent, creation agent tools)
is in [ai-agents.md](ai-agents.md).

## How a custom item works in game

Minecraft without mods cannot register new item ids. A custom item is a vanilla **base item** carrying data
components that change its look, name and behavior:

| Component                                    | What it does                                                             |
| -------------------------------------------- | ------------------------------------------------------------------------ |
| `item_model`                                 | Points to the pack's own item definition (`assets/<ns>/items/<id>.json`) |
| `item_name`, `lore`                          | Name and tooltip lines, translated through the pack's lang files         |
| `food`, `consumable`                         | Hunger, saturation, eating time and animation, effects when eaten        |
| `tool`                                       | Mining speed and which blocks drop their items                           |
| `attribute_modifiers`                        | Attack damage and speed, armor, toughness, knockback resistance          |
| `equippable`                                 | Armor slot and the worn texture (`assets/<ns>/equipment/<id>.json`)      |
| `max_damage`, `max_stack_size`, `repairable` | Durability, stack size, repair item                                      |
| `rarity`, `enchantment_glint_override`       | Name color, enchantment glint                                            |
| `enchantable`                                | Enchantability                                                           |

Every version of the support window (1.21.4 and later) reads `item_model` and the `assets/<ns>/items/` item
definitions, so custom items work across the whole window. Players get one with the recipe, or with
`/function <ns>:give/<id>` (cheats on); `/function <ns>:give_all` gives every item of the namespace. `give_all` sits
outside `give/`, so no item id can collide with it.

**Base item caveat.** Minecraft matches recipe ingredients by item id only: a custom item still works as its base
item in vanilla recipes (a custom food based on `apple` crafts golden apples), and a custom recipe cannot ask for a
custom item as an ingredient. The presets use base items that no vanilla recipe takes as an ingredient, and the item
page lists the vanilla recipes that use the chosen base item (`items.context`).

## Definition

One file per item, `blocksmith/items/<id>.json` at the pack root. It is a pack file, so history, undo, merge and
send-to-pack cover it; Minecraft ignores it; exports, install and live mode leave it out. `CustomItemSchema`
(`src/shared/items/schema.ts`) checks it:

| Field                          | Meaning                                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `schemaVersion`                | `1`                                                                                                    |
| `id`                           | `[a-z0-9_]`, one path segment; the file name                                                           |
| `namespace`                    | Namespace of the generated files (not `minecraft`); kept when the pack is renamed                      |
| `kind`                         | `simple`, `food`, `weapon`, `tool` or `armor` (which properties the form shows)                        |
| `base`                         | The vanilla item it is in game (`minecraft:stone_sword`)                                               |
| `names`                        | Name per language; `en_us` required (Minecraft falls back to it), `fr_fr` filled by the app and the AI |
| `lore`                         | Up to 8 tooltip lines, each per language                                                               |
| `handheld`                     | Held like a tool (`item/handheld`) rather than flat (`item/generated`)                                 |
| `rarity`, `glint`              | Name color, enchantment glint                                                                          |
| `maxStack`, `durability`       | Stack size (1 to 99), durability                                                                       |
| `repairWith`, `enchantability` | Repair item or #tag, enchantability                                                                    |
| `food`                         | `nutrition`, `saturation`, `eatSeconds`, `alwaysEdible`, `animation`, `effects`                        |
| `weapon`                       | `attackDamage` and `attackSpeed` as the tooltip shows them                                             |
| `tool`                         | `type` (pickaxe / axe / shovel / hoe), `tier` (wooden ... netherite), `miningSpeed`                    |
| `armor`                        | `slot`, `armor`, `toughness`, `knockbackResistance`                                                    |
| `removeComponents`             | Components of the base item to remove (`minecraft:food` on a non-food item based on a food)            |
| `extraComponents`              | Raw components for experts, written as they are (`"!minecraft:x": {}` removes one)                     |
| `recipe`                       | `null`, `{ type: 'shaped', grid: [9 slots], count }` or `{ type: 'shapeless', ingredients, count }`    |

The kind's block (`food`, `weapon`, `tool`, `armor`) is required for that kind; a damageable item cannot stack.

**Presets** (`resources/data/custom-items.json`, `itemPreset(kind, variant)`) give a new item its base item, starting
properties and starting texture. Tools have one preset per tool type and armor one per slot, with diamond-like stats.

| Kind   | Base item                                                   | Starts from                             |
| ------ | ----------------------------------------------------------- | --------------------------------------- |
| Simple | `poisonous_potato` (food removed)                           | Amethyst shard texture, stacks to 64    |
| Food   | `poisonous_potato`                                          | Apple texture, 4 hunger, 2.4 saturation |
| Weapon | `stone_sword`                                               | Diamond sword: 7 damage, 1.6 speed      |
| Tool   | `stone_pickaxe` / `_axe` / `_shovel` / `_hoe`               | The diamond tool of that type           |
| Armor  | `netherite_helmet` / `_chestplate` / `_leggings` / `_boots` | The diamond piece of that slot          |

## Generated files

Saving writes the definition and these files as ONE history entry (`createItem`, `saveItem`, `renameItem`,
`deleteItem`, `regenerateItem`; `aiItems` for an AI plan):

| File            | Path                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------ |
| Texture         | `assets/<ns>/textures/item/<id>.png` (drawn by the user; copied from the chosen texture on creation)   |
| Model           | `assets/<ns>/models/item/<id>.json`                                                                    |
| Item definition | `assets/<ns>/items/<id>.json`                                                                          |
| Names           | `assets/<ns>/lang/<lang>.json`, keys `item.<ns>.<id>` and `item.<ns>.<id>.lore.<n>`, other keys kept   |
| Armor (worn)    | `assets/<ns>/equipment/<id>.json` and `textures/entity/equipment/humanoid[_leggings]/<id>.png` (64x32) |
| Recipe          | `data/<ns>/recipe/<id>.json`, whose result is the base item with the item's components                 |
| Give function   | `data/<ns>/function/give/<id>.mcfunction`                                                              |
| Give all        | `data/<ns>/function/give_all.mcfunction`: calls every item's give function (shared by the namespace)   |

Names use `{ "translate": "item.<ns>.<id>", "fallback": "<English name>" }`, so the name shows in English even
without the lang file. A rename moves the textures and removes the old files; a delete removes everything,
textures included (undo brings it back). Lang files left with no key are removed, and so is `give_all` once the
namespace has no item. The Pack Doctor checks `give_all` like the other generated files and reports it under the
first item of its namespace.

Generation is pure (`generateItemFiles`, `itemChanges`): the same definition and version always give the same text.
That is how the Pack Doctor spots a generated file edited by hand, and why the data editor shows generated files
read-only with **Open item** (`DataFileData.generatedBy`).

## Versions

`itemFormatFor(version)` reads the version's data pack format. 1.21.5 (format 71) changed two things the items use:

| Format                | Before 1.21.5                                                   | 1.21.5 and later                          |
| --------------------- | --------------------------------------------------------------- | ----------------------------------------- |
| Text components       | Strings holding JSON (`"{\"translate\":...}"`; `'...'` in SNBT) | JSON objects (SNBT compounds in commands) |
| `attribute_modifiers` | `{ "modifiers": [...], "show_in_tooltip": true }`               | A plain list                              |

The pack holds the files for its authoring version. Exports regenerate them for each target version
(`exportItemFiles`, before path migration), and **Upgrade** rewrites them for the new authoring version. A future
format change means one more flag in `formats.ts` and a test in `tests/unit/items.test.ts`, which pins the exact
output for 1.21.4, 1.21.5 and 26.3.

## Checks

The Pack Doctor runs `checkItems` (codes `items.*`, messages `warnings.items.*`). Issues about an item carry its
`itemId`, so the drawer offers **Open item** and, for generated files, **Regenerate**.

| Code                      | When                                                                       |
| ------------------------- | -------------------------------------------------------------------------- |
| `items.invalidDefinition` | The file is not a valid definition, or its `id` differs from the file name |
| `items.missingTexture`    | The item texture or the worn armor texture is missing                      |
| `items.unknownBase`       | The base item does not exist in the authoring version                      |
| `items.unknownIngredient` | A `minecraft:` recipe ingredient does not exist in the authoring version   |
| `items.generatedEdited`   | A generated file differs from what the definition generates                |
| `items.generatedMissing`  | A generated file is missing                                                |
| `items.langOutdated`      | A lang file lacks the item's current name or lore                          |

Exports report invalid definitions with the same `items.invalidDefinition` warning and leave those items out.

## IPC

| Channel            | Input                           | Output        | Notes                                                      |
| ------------------ | ------------------------------- | ------------- | ---------------------------------------------------------- |
| `items.list`       | `{ packId }`                    | `ItemList`    | Items, invalid definitions, namespace for new items        |
| `items.read`       | `{ packId, id }`                | `CustomItem`  |                                                            |
| `items.create`     | `{ packId, item, textureFrom }` | `ItemSummary` | `textureFrom`: vanilla or pack texture, null = blank 16x16 |
| `items.save`       | `{ packId, id, item }`          | `ItemSummary` | A different `item.id` renames                              |
| `items.delete`     | `{ packId, id }`                | `void`        |                                                            |
| `items.regenerate` | `{ packId, id }`                | `void`        | Pack Doctor fix                                            |
| `items.catalog`    | `{ packId }`                    | `ItemCatalog` | Vanilla items (English names, icon textures), item tags    |
| `items.context`    | `{ packId, base }`              | `ItemContext` | Vanilla recipes using the base item                        |

| Error code             | When                                                     |
| ---------------------- | -------------------------------------------------------- |
| `items.needsCombined`  | The pack is not a resource + data pack                   |
| `items.notFound`       | No definition with that id                               |
| `items.exists`         | Creating or renaming onto an existing id                 |
| `items.invalid`        | The definition file is not valid                         |
| `items.invalidLang`    | A lang file the item writes into is not a JSON object    |
| `items.invalidTexture` | `textureFrom` is not a texture of vanilla or of the pack |

Merging a pack with items into a new pack creates a resource + data pack. Lang files are merged by key like other
lang files, so a merged pack may need **Regenerate** on its items (the Pack Doctor says which).
