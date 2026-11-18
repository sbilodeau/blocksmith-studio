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
**Format**, **Compare** (Minecraft's file side by side, read-only), **AI**, **More** (**Use vanilla text**, **Revert
to vanilla** / **Delete**, with a confirmation) and **Save** (also Ctrl/Cmd+S). Leaving with unsaved changes asks to
save or discard. Function files are plain text (not checked).

Files generated from a custom item (its recipe and give function, see [custom-items.md](custom-items.md)) open
read-only with a notice and an **Open item** button: they are written again each time the item is saved.

**AI** opens a side panel with two tabs:

- **Chat**: the data agent helps refine the open file ("drop 2 to 4 arrows", "make it give 8 slabs", or a question).
  It proposes a new version of the file; **Apply to editor** puts it in the editor, unsaved (Ctrl/Cmd+Z undoes it),
  and the user saves it. See [Data agent](#data-agent).
- **Explain**: the AI describes in simple terms, in the UI language, what the file does in game and what it changes
  compared with Minecraft's original. See [Explain](#explain).

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

The AI panel uses `ai.data.send` (`{ packId, path, message, text, model, language, thinking? }`) for the chat and
`ai.data.explain` (`{ packId, path, text, model, language, thinking? }`) for explanations. Both return `{ runId }`,
stream as `ai.event` and stop with `ai.agent.stop`; the chat's conversation is read and cleared with
`ai.agent.conversation` / `ai.agent.clear` (agent `data`).

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

## Explain

The **Explain** tab of the AI panel asks the AI for a plain-language explanation of the open file
(`src/main/services/ai/agent/explain.ts`, `DataExplain.vue`). It is one answer without tools: nothing is proposed or
written. The model defaults to the creation agent's model (Settings > AI) and can be switched in the panel; the panel
flags an explanation older than the editor text, and a new file needs a new click (each one is a paid request).
Opening the tab asks for the first explanation.

Main builds the context itself (the renderer only sends the editor text, unsaved edits included), so the model has
facts rather than guesses:

| Part                 | What the model gets                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------- |
| Instructions         | Reply language, plain-text format (one summary sentence, then up to 6 effects), game terms for numbers  |
| Kind guide           | How Minecraft reads that kind of file (recipe types, loot pools / conditions / functions, tags...)      |
| Situation            | Replaces a vanilla file, new file, or identical to vanilla; saved, unsaved, or not in the pack yet      |
| Original and current | Vanilla's file (whatever the pack's base) and the editor text, both formatted, cut at 12,000 characters |
| Changes              | Path-by-path differences computed by the app (`jsonChanges`: `result.count: 6 -> 3`)                    |
| Tag effect           | For tags: ids the game gains and loses, and vanilla ids removed from the file that the game still keeps |
| Checks               | Errors (Minecraft will not load the file) and warnings, from the same checks as the editor              |
| Tags used            | Content in game of up to 10 `#tags` the file names (pack file merged with vanilla's), 40 ids each       |
| Names                | English names of up to 80 ids, from vanilla's `en_us.json` (the model translates them)                  |

## Data agent

The **Chat** tab of the AI panel talks to the data agent (`src/main/services/ai/agent/data-agent.ts`,
`DataAgentPanel.vue`), which works on the ONE file open in the editor. Each message sends the editor text; main adds
the same file context as [Explain](#explain) (original, computed changes, checks, tag effect, tags used, names), the
kind guide and the format notes, plus the earlier messages of the pack's conversation (each tagged with its file,
`.blocksmith/conversations/data.jsonl`).

| Tool        | What it does                                                                                    |
| ----------- | ----------------------------------------------------------------------------------------------- |
| `edit_file` | Proposes the WHOLE new file (`json` for JSON files, `text` for functions); errors refuse it     |
| `read_json` | Reads another data file (the pack's, else vanilla's); the open file returns the latest proposal |
| `list_data` | Lists the pack's and vanilla's data files (same filters as the creation agent)                  |

`edit_file` runs the editor's checks: a file Minecraft would reject is refused with the reasons, so the model fixes
it; warnings (unknown ids) are returned with the proposal. The last valid version becomes a `DataFileProposal`
(`before`, `after`, `warnings`) shown under the answer with the computed changes and the whole file. It is never
stored in main: **Apply to editor** sets the editor text (unsaved, undoable) and **Discard** drops it; nothing is
written until the user saves, which makes one history entry like any save. Requests that need another file get an
answer saying so (the user opens or creates it). The agent has its own defaults in Settings > AI (**Data agent**:
model, reasoning, round trips); without a default model it starts from the creation agent's.

## Creation agent

On data packs and combined packs the creation agent (whole pack) also gets `list_data`, `read_json` and `write_json`;
on a data pack it gets only those (plus `set_pack_meta` and `update_style_brief`). See
[ai-agents.md](ai-agents.md#data-pack-tools).
