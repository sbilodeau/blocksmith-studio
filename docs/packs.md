# Packs

How Blocksmith Studio stores, lists, edits, imports and exports resource packs. Code: `src/main/services/packs/`,
`src/main/services/history/`, `src/main/protocol.ts`, `src/main/ipc/pack-handlers.ts` and
`src/main/ipc/texture-handlers.ts`.

## Workspace

- Root: `settings.workspacePath`, or `<Documents>/Blocksmith Studio` when unset.
- Packs live in `<root>/packs/<folder>/`. The folder name is a slug of the pack name made unique (`fire-pack`,
  `fire-pack-2`); the pack id is a short random id (12 base-36 characters) stored in `project.json`, so renaming
  or moving a folder inside `packs/` keeps the pack working.
- `workspace.choose` opens a folder picker, creates `<chosen>/packs/` and persists the choice through the settings
  service (the renderer can never send a path itself).

## Pack folder layout

The pack folder is a valid resource pack on its own:

```
fire-pack/
  pack.mcmeta                 generated for the authoring version
  pack.png                    64x64, generated at creation
  assets/<ns>/...             only files that differ from vanilla, or new files
  .blocksmith/project.json    id, name, description, authoring version, base, dates (ProjectSchema)
  .blocksmith/history/        pack journal for undo / redo (see History)
```

A vanilla-based pack is **copy-on-write**: vanilla textures are read from the extracted vanilla cache until a file
is written in the pack folder. Hidden entries (`.blocksmith/`, `.git/`...) and OS junk are never exported.

## Creating a pack

`packs.create` validates the input, requires the authoring version to be in the support window, and, for a vanilla
base, requires the vanilla assets of that version to be extracted already (`packs.vanillaNotReady` otherwise: the UI
runs `vanilla.prepare` first, nothing is downloaded implicitly). The default `pack.png` is the vanilla grass block
side upscaled with nearest-neighbour, or a generated pixel pattern for empty packs.

## Texture index

`pack.textures` merges:

1. the vanilla index entries under `assets/<ns>/textures/**.png` (vanilla base only),
2. the pack's own `assets/<ns>/textures/**.png` files.

| Status     | Meaning                                                |
| ---------- | ------------------------------------------------------ |
| `vanilla`  | Not in the pack, or byte-identical to vanilla (sha256) |
| `modified` | In the pack and different from the vanilla file        |
| `added`    | In the pack with no vanilla counterpart                |

Width and height come from the PNG IHDR header; `animated` / `frameCount` from the sibling `.png.mcmeta` (a pack
file overrides vanilla). Categories come from the [category engine](categories.md). Each entry has a
`bs-asset://pack/<id>/<path>?v=<hash>` URL whose `v` changes when the file changes, so thumbnails refresh.

Results are cached per pack. A refresh lists and stats the pack's texture files and only re-hashes files whose size
or mtime changed. Measured on a test machine with 4000 vanilla textures and 1000 pack files: about 50 ms cold and
20 ms warm (textures + categories).

`pack.categories` returns, in display order, every category that has at least one texture: count, changed count
and an icon URL.

## Texture editing

`src/main/services/packs/textures-edit.ts`. Every path is validated again in main: it must match
`assets/<ns>/textures/**.png`, use only `[a-z0-9_.-/]`, have no `.`, `..`, empty or hidden segment, and resolve
inside the pack folder (`texture.invalidPath` otherwise). Writes also refuse a target whose folder resolves outside
the pack through a symbolic link (`packs.unsafePath`).

- `texture.read` returns the pack file if present, else the vanilla file of the authoring version (vanilla base
  only), else `png: null` with `origin: 'none'`. `vanillaPng` is the vanilla file (vanilla base only) and
  `mcmeta` the text of the sibling `.png.mcmeta` (pack first, then vanilla).
- `texture.save` checks the PNG (signature, IHDR, sides 1..4096, decodes; `texture.invalidPng` otherwise). Bytes
  identical to vanilla delete the pack copy instead (the pack keeps only changed files). The write is atomic and
  creates folders. It records a history entry (`source: 'editor'`, label `save` with `params.name` = file name
  without `.png`) and returns the fresh texture entry (status, cache-busted URL...).
- `texture.revert` deletes the pack copy so the vanilla texture shows again (a pack `.png.mcmeta` is kept in M2).
  It records a `revert` entry. `texture.notInPack` when the pack has no copy, `texture.noVanilla` when there is
  no vanilla counterpart (empty pack or added texture).

Both writes invalidate the cached hashes of the path and the pack's texture list (`PackCacheControl.invalidate`;
size + mtime alone can miss a same-size rewrite) and emit `packs.changed`.

## History

`src/main/services/history/` keeps one persisted undo / redo stack per pack (level 2 of PLAN.md section 4.3; the
pixel editor keeps its own in-memory undo while a texture is open).

```
.blocksmith/history/
  journal.jsonl          one entry per line, oldest first
  state.json             { "schemaVersion": 1, "head": "<id of the newest applied entry>" | null }
  blobs/<sha256>.bin     content-addressed file versions
```

A journal entry (one line on disk, shown indented here):

```json
{
  "v": 1,
  "id": "7f0c2a9e-…",
  "at": "2026-11-15T10:00:00.000Z",
  "source": "editor",
  "label": { "key": "save", "params": { "name": "stone" } },
  "changes": [
    { "path": "assets/minecraft/textures/block/stone.png", "before": null, "after": "<sha256>" }
  ]
}
```

`before` / `after` are blob hashes of the file content before and after the change, `null` when the file is
absent. Entries up to `head` are applied, later ones are undone (redoable). A missing or invalid `state.json`, or
an unknown head, means every entry is applied.

- **Record**: `apply(packId, { source, label, changes: [{ path, after }] })` snapshots the current files, writes
  the new contents (null deletes) and records one entry; `record(...)` records a change the caller already made
  (before and after given). Multi-file entries are supported, for AI proposals (M3), imports and merges (M8).
  New entries are appended; when undone entries exist they are dropped first (redo tail).
- **Undo / redo** restore the `before` (or `after`) state of one entry, writing or deleting files, move `head`,
  and emit `packs.changed`. With nothing to undo or redo they return the state unchanged.
- **Conflicts**: before writing anything, every file of the entry must still hold the expected content. A file
  already in the target state is accepted (resumes an interrupted operation); any other content means it was
  edited outside the app and the operation is refused with `history.conflict` (`params.path`).
- **Limits**: at most 200 entries per pack (`maxEntries`). Dropping the redo tail or trimming old entries rewrites
  the journal atomically and deletes every blob no remaining entry references.
- **Robustness**: corrupted lines (invalid JSON, schema mismatch, unsafe path, duplicate id) are skipped with a
  warning; an append after a partial last line starts on a new line. Blobs are checked against their hash when
  read (`history.blobMissing` otherwise). Operations on one pack run one at a time (promise queue).
- `history.get` returns the entries newest first with `applied`, `canUndo` and `canRedo`. Importing a zip does not
  record history in M2.

## Import (.zip)

1. Safety checks run before anything is decompressed: zip-slip (absolute paths, drive letters, `..`, `.`, empty
   segments, backslashes, NUL), at most 20,000 entries, 64 MiB per file, 1 GiB in total (declared sizes, which also
   bound memory since entries are inflated into buffers of the declared size).
2. OS junk is skipped (`__MACOSX/`, `.DS_Store`, `._*`, `Thumbs.db`, `desktop.ini`), and so are hidden entries.
3. The pack root is where `pack.mcmeta` is: at the root, or inside exactly one top-level folder.
4. The declared format (`pack.pack_format`, else `pack.min_format`; an integer or `[major, minor]`) is mapped to a
   Minecraft version. M1 always uses the latest supported version as the authoring version and warns
   `import.formatMismatch` when the pack was made for another one (upgrade migrations come in M7).
5. Files byte-identical to that version's vanilla files are dropped. When vanilla is not extracted, everything is
   kept and the report warns `import.vanillaNotReady`.
6. The pack name is the zip file name; the description is the `pack.mcmeta` description flattened to plain text.
   `pack.mcmeta` is regenerated for the authoring version, keeping extra sections such as `language`.

| Error code          | When                                                                   |
| ------------------- | ---------------------------------------------------------------------- |
| `import.invalidZip` | Not a readable zip                                                     |
| `import.notAPack`   | No single pack root, or `pack.mcmeta` is not a JSON object with `pack` |
| `import.unsafePath` | An entry name could escape the pack folder                             |
| `import.tooLarge`   | Entry count, file size or total size limit exceeded (`params.reason`)  |

| Warning code             | When                                                    |
| ------------------------ | ------------------------------------------------------- |
| `import.formatMismatch`  | Declared format maps to another version (or to none)    |
| `import.formatMissing`   | `pack.mcmeta` declares no format                        |
| `import.vanillaNotReady` | Vanilla not extracted: identical files were not dropped |

## Export (.zip)

M1 exports to the pack's authoring version only (`export.targetNotSupported` otherwise; multi-version export with
migrations is M7).

1. **Collect** every file of the pack folder except hidden entries (`.blocksmith/`, `.git/`...), OS junk and files
   byte-identical to the target's vanilla (reported in `skipped` with reason `identicalToVanilla`).
2. **pack.mcmeta** is always regenerated from the project description and the target version; extra top-level
   sections of the pack's own `pack.mcmeta` (`language`, `filter`, `overlays`...) are kept.
3. **Validate** (Pack Doctor basics, reported as warnings, never silently fixed).
4. **Write** a deterministic zip: `pack.mcmeta` and `pack.png` first, then entries sorted by path, forward slashes,
   fixed timestamps, no directory entries. PNGs are stored, other files deflated. Two exports of the same content
   are byte-identical.

| Warning code               | When                                                                |
| -------------------------- | ------------------------------------------------------------------- |
| `export.vanillaNotReady`   | Target vanilla not extracted: identical files could not be skipped  |
| `export.invalidMcmeta`     | The pack's own `pack.mcmeta` does not parse (it is replaced)        |
| `export.missingPackPng`    | No `pack.png` at the root                                           |
| `export.invalidPng`        | Bad PNG signature or IHDR                                           |
| `export.invalidJson`       | A `.json` or `.mcmeta` file does not parse                          |
| `export.invalidPath`       | A path under `assets/` uses characters outside `[a-z0-9_.-/]`       |
| `export.nonPowerOfTwo`     | A `block/` or `item/` texture (or its frames) is not a power of two |
| `export.animationMismatch` | An animated texture is not a whole number of frames                 |

## Asset protocol

`bs-asset://` serves read-only files to the renderer (format in `src/shared/assets.ts`):

- `bs-asset://pack/<packId>/<path>`: the pack file if present, otherwise the vanilla file of the pack's authoring
  version (vanilla base only).
- `bs-asset://vanilla/<versionId>/<path>`: a file of the extracted vanilla cache.

Only `.png`, `.json` and `.mcmeta` are served, hidden paths are refused, and the resolved real path (symlinks
followed) must stay inside its root; anything else is a 404. Responses carry `Cache-Control: no-cache`; the `v`
query parameter does the cache busting. The resolution logic (`resolveAssetUrl`) is a pure function covered by
`tests/integration/protocol-resolve.test.ts`.

## Other error codes

| Code                        | When                                                            |
| --------------------------- | --------------------------------------------------------------- |
| `packs.notFound`            | No pack with this id in the workspace                           |
| `packs.unsupportedVersion`  | Authoring version outside the support window                    |
| `packs.vanillaNotReady`     | Vanilla base but the version's vanilla assets are not extracted |
| `workspace.invalidPath`     | Chosen workspace is not absolute or cannot be created           |
| `export.targetNotSupported` | Export target other than the authoring version (M1)             |
| `packs.unsafePath`          | A write would follow a symbolic link out of the pack folder     |
| `texture.invalidPath`       | Not a safe `assets/<ns>/textures/**.png` path                   |
| `texture.invalidPng`        | Bad signature or IHDR, does not decode, or a side over 4096     |
| `texture.notInPack`         | Revert of a texture the pack does not contain                   |
| `texture.noVanilla`         | Revert of a texture with no vanilla counterpart                 |
| `history.conflict`          | Undo / redo over a file changed outside the app                 |
| `history.blobMissing`       | A stored file version is missing or corrupted                   |
| `history.invalidPath`       | A recorded change targets an unsafe pack path                   |
