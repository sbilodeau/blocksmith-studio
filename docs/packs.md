# Packs

How Blocksmith Studio stores, lists, imports and exports resource packs. Code: `src/main/services/packs/`,
`src/main/protocol.ts` and `src/main/ipc/pack-handlers.ts`.

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
