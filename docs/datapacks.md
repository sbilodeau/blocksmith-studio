# Data packs

How Blocksmith Studio edits data packs (PLAN M10): pack kinds, the vanilla data cache, the data browser and JSON
editor, the checks, and the creation agent's data tools. Code: `src/shared/datapack/` (paths, schemas, text checks,
templates, ids), `src/main/services/packs/data.ts`, `src/main/ipc/data-handlers.ts`, `src/renderer/components/data/`
and `src/renderer/stores/data.ts`.

## Pack kinds

`project.json` has a `kind` (projects created before M10 are `resource`):

| Kind       | Holds                     | Folder `pack.mcmeta` | Exported as                             |
| ---------- | ------------------------- | -------------------- | --------------------------------------- |
| `resource` | Textures and other assets | Resource pack format | A resource pack zip                     |
| `data`     | `data/` files             | Data pack format     | A data pack zip                         |
| `combined` | Both, in one folder       | Resource pack format | A resource pack zip and a data pack zip |

The kind is chosen in the New pack dialog and changed from the kind tag in the pack header (`pack.setKind`, which
rewrites the folder's `pack.mcmeta` format and keeps its other sections). Changing the kind never deletes files: a
combined pack turned back into a resource pack keeps its `data/` folder, which resource pack exports leave out
(`export.dataLeftOut`). A combined pack tab has a **Textures / Data** switch at the top of the sidebar.

Importing a zip detects the kind: `data/` without `assets/` is a data pack, whose declared format is mapped with the
data pack format column of `versions.json`; both folders make a combined pack.

## Vanilla data

The vanilla store copies `data/minecraft/{recipe,loot_table,tags,advancement}/**/*.json` from the client jar with
the assets (about 6,000 files for 26.3) and adds them to `index.json`, which then has `"data": true`. Versions
extracted before M10 get the data from their jar on first use (`VanillaStore.prepareData`, run by the data service,
the Pack Doctor, data pack exports and imports); when that jar is gone the data browser shows only the pack's own
files with a notice (`DataList.vanillaData: false`). Other data folders (worldgen, structures...) are not extracted.

Vanilla-based packs are copy-on-write for data too: the browser lists vanilla files, editing one writes the pack's
copy, and saving a file equal to vanilla's (same JSON, any formatting) removes the copy. Exports leave out data files
byte-identical to the target version's vanilla.

## Data files

`parseDataPath` (shared) recognizes `data/<namespace>/<folder>/<path>.json` and `.mcfunction`. Folder names are the
singular ones of Minecraft 1.21+, which covers the whole support window:

| Kind          | Path                                  | Id example                 |
| ------------- | ------------------------------------- | -------------------------- |
| `recipe`      | `data/<ns>/recipe/<id>.json`          | `minecraft:oak_planks`     |
| `loot_table`  | `data/<ns>/loot_table/<id>.json`      | `minecraft:blocks/stone`   |
| `tag`         | `data/<ns>/tags/<registry>/<id>.json` | `#minecraft:planks` (item) |
| `advancement` | `data/<ns>/advancement/<id>.json`     | `minecraft:story/root`     |
| `function`    | `data/<ns>/function/<id>.mcfunction`  | `my_pack:start`            |
| `other`       | Any other `data/<ns>/....json`        | `my_pack:predicate/is_day` |

Tag registries take one folder (`item`, `block`, `entity_type`...) or two for worldgen (`worldgen/biome`).
Characters are those of resource locations: lowercase letters, digits, `_`, `-`, `.` and `/`.

## Checks

`checkDataText(text, kind, ctx, registry)` runs in the editor (150 ms after typing stops), in the Pack Doctor
(`doctor.invalidData` / `doctor.dataWarnings`), in data pack exports, and in the creation agent's `write_json`:

1. **Syntax**, strict like Minecraft: no comments, no trailing commas (`data.issue.syntax` with a
   `data.syntax.<code>` reason).
2. **Schema** (`schemas.ts`, zod): recipes (shaped with the pattern / key cross-checks Minecraft makes, shapeless,
   the four cooking types, stonecutting, smithing transform and trim, transmute; other types only need a `type`),
   loot tables (pools need `rolls` and `entries`, each entry type its own field, children checked recursively), tags
   (`values` of ids, `#tags` or `{id, required}`) and advancements (criteria with triggers, requirements naming
   them, display icon / title / description).
3. **Warnings** for ids the game does not have: items and blocks from the vanilla item definitions and blockstates,
   tags from vanilla and the pack's own tags. Only the `minecraft` namespace is checked (other namespaces may come
   from mods), and nothing is checked when vanilla is not extracted.

Formats change between versions (26.1 renamed loot table `conditions` to `condition` and `functions` to `modifier`;
1.21.5 changed the transmute result), so the schemas check strictly what every supported version shares and let the
rest through: extra fields are allowed, conditions and functions are not checked, an unknown `minecraft:` recipe type
is a warning. `tests/real-jar/datapack-schemas.test.ts` runs every vanilla data file of each installed version of the
support window through the checks and expects no error and no warning (1.21.4 and 26.3: 4,000+ files each).

Each issue has a JSON path; `text.ts` turns it into a range with `jsonc-parser` (a missing key marks its parent's
key, a long object or array marks its key rather than the whole value).

## Editor

The data browser (`DataList.vue`) lists files per kind with search, a Changed / Vanilla filter and **New file**. The
editor (`DataEditor.vue`, CodeMirror 6 in `CodeEditor.vue`) has JSON highlighting, folding, its own undo, lint marks
in the gutter, a clickable issue list with line numbers, completion of item ids and `#tags` inside strings,
**Format**, **Compare** (Minecraft's file side by side, read-only), **Use vanilla text**, **Revert to vanilla** /
**Delete** and **Save** (also Ctrl/Cmd+S). Leaving with unsaved changes asks to save or discard. Function files are
plain text (not checked).

**New file** picks the kind, a template (shaped / shapeless / smelting / stonecutting / smithing recipe, block / chest
/ mob loot, empty tag, advancement, function, empty JSON), the namespace (the pack name as a namespace, or
`minecraft` to replace a vanilla file), the tag registry and the name. Templates are valid in every supported
version. An existing path offers **Open it** instead.

## IPC

| Channel        | Input                    | Output         | Notes                                                |
| -------------- | ------------------------ | -------------- | ---------------------------------------------------- |
| `data.list`    | `{ packId }`             | `DataList`     | Entries (pack + vanilla), `vanillaData`, ids         |
| `data.read`    | `{ packId, path }`       | `DataFileData` | Text (pack, else vanilla), origin, vanilla text      |
| `data.save`    | `{ packId, path, text }` | `DataEntry`    | One history entry; equal to vanilla removes the copy |
| `data.create`  | `{ packId, path, text }` | `DataEntry`    | Refused when the pack or vanilla has the path        |
| `data.delete`  | `{ packId, path }`       | `void`         | Removes the pack's copy (back to vanilla, or gone)   |
| `pack.setKind` | `{ packId, kind }`       | `PackSummary`  | Rewrites the folder's pack.mcmeta format             |

Paths are validated by the contract (`data/<ns>/....json|.mcfunction`, no `.` / `..` / empty segment) and again in
main (`parseDataPath`, resolved inside the pack). Files are limited to 1 MiB.

| Error code         | When                                           |
| ------------------ | ---------------------------------------------- |
| `data.invalidPath` | Not a data file path, or invalid characters    |
| `data.tooLarge`    | Over 1 MiB                                     |
| `data.exists`      | `data.create` on an existing path              |
| `data.notInPack`   | `data.delete` on a file the pack does not have |

History labels: `saveData`, `createData`, `deleteData`, and `aiDataFiles` for the files of an AI plan.

## Merge

Data pack tags are combined automatically (merge kind `tag`), the way Minecraft stacks packs: values from the top
source down, and a source with `"replace": true` hides the sources below it (the result keeps `replace`). Other data
files are conflicts when they differ.

## Creation agent

On data packs and combined packs the creation agent (whole pack) also gets `list_data`, `read_json` and `write_json`;
on a data pack it gets only those (plus `set_pack_meta` and `update_style_brief`). See
[ai-agents.md](ai-agents.md#data-pack-tools).
