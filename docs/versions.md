# Minecraft versions and vanilla assets

How Blocksmith Studio knows which Minecraft Java releases exist, which ones it supports, how it writes
`pack.mcmeta`, and where it gets the vanilla textures from. Code: `src/shared/versions/` and
`src/main/services/vanilla/`.

## Version table

`resources/data/versions.json` lists every Java **release** from 1.21 to the latest one, newest first. It is
validated by `VersionTableSchema` (`src/shared/model/versions.ts`) and imported statically by
`src/shared/versions/table.ts`, so electron-vite bundles it into main and the renderer.

```json
{
  "id": "26.3",
  "releaseTime": "2026-09-15T11:23:02+00:00",
  "resourcePack": { "major": 97, "minor": 1 },
  "dataPack": { "major": 121, "minor": 0 },
  "mcmetaStyle": "minmax"
}
```

Values as of 2026-11-15:

| Minecraft      | Released   | Resource pack | Data pack | pack.mcmeta style |
| -------------- | ---------- | ------------- | --------- | ----------------- |
| 26.3           | 2026-09-15 | 97.1          | 121.0     | `minmax`          |
| 26.2           | 2026-06-16 | 88.0          | 107.1     | `minmax`          |
| 26.1 - 26.1.2  | 2026-03-24 | 84.0          | 101.1     | `minmax`          |
| 1.21.11        | 2025-12-09 | 75.0          | 94.1      | `minmax`          |
| 1.21.9-1.21.10 | 2025-09-30 | 69.0          | 88.0      | `minmax`          |
| 1.21.7-1.21.8  | 2025-06-30 | 64            | 81        | `pack_format`     |
| 1.21.6         | 2025-06-17 | 63            | 80        | `pack_format`     |
| 1.21.5         | 2025-03-25 | 55            | 71        | `pack_format`     |
| 1.21.4         | 2024-12-03 | 46            | 61        | `pack_format`     |
| 1.21.2-1.21.3  | 2024-10-22 | 42            | 57        | `pack_format`     |
| 1.21-1.21.1    | 2024-06-13 | 34            | 48        | `pack_format`     |

### Regenerating it

```sh
node scripts/update-versions.mjs            # fetch, cross-check the latest jar, write the file
node scripts/update-versions.mjs --no-jar   # skip the jar cross-check
node scripts/update-versions.mjs --dry-run  # print instead of writing
```

Sources:

- Release ids and dates: Mojang's manifest
  `https://piston-meta.mojang.com/mc/game/version_manifest_v2.json` (`type: "release"` only).
- Pack formats: `https://raw.githubusercontent.com/misode/mcmeta/summary/versions/data.json`, fields
  `resource_pack_version`, `resource_pack_version_minor`, `data_pack_version`, `data_pack_version_minor`.
- `mcmetaStyle` is `minmax` when the resource pack format is 65 or more (1.21.9+), else `pack_format`.
- Cross-check: the script downloads the latest release's client jar once into a temp folder (deleted afterwards,
  never inside the repo), verifies its SHA1 and compares its `version.json` with the table. Review the diff in a
  PR like any other change.

### `version.json` inside a client jar

The jar's own `version.json` is authoritative for its pack formats; the vanilla index stores what the jar says
and main logs a warning if it differs from the table. Two shapes exist (checked on the real 1.21.4 and 26.3 jars):

| Versions        | `pack_version`                                                                      |
| --------------- | ----------------------------------------------------------------------------------- |
| 1.17 - 1.21.8   | `{ "resource": 46, "data": 61 }`                                                    |
| 1.21.9 (25w31a) | `{ "resource_major": 97, "resource_minor": 1, "data_major": 121, "data_minor": 0 }` |

Source: <https://minecraft.wiki/w/Version.json> (history entry for 1.21.9 / 25w31a).

## Support window

`supportedVersions(table, now)` returns the releases whose `releaseTime` is within the last
`SUPPORT_WINDOW_MONTHS` (24) calendar months, boundary included, plus the latest release even if older, newest
first. On 2026-11-15 the window starts on 2024-11-15, so it covers **1.21.4 to 26.3** (13 releases). Older
versions drop out automatically as time passes; nothing is hard-coded.

Other helpers in `src/shared/versions/support.ts`:

- `latest(table)`: most recent release (by `releaseTime`, not file order).
- `findVersion(table, id)`: exact id match.
- `versionForPackFormat(table, { major })`: release with the same resource pack **major** format. When several
  releases share it (1.21.7 and 1.21.8 are both 64), the newest wins.
- `comparePackFormats(a, b)`: orders `{ major, minor }` pairs.

## pack.mcmeta rules

Verified on 2026-11-15 against <https://minecraft.wiki/w/Pack.mcmeta> and
<https://minecraft.wiki/w/Pack_format>:

- **Up to 1.21.8** (resource pack format below 65): `pack.pack_format` (integer) is required. Since 1.20.2 an
  optional `supported_formats` (integer, `[min, max]` or `{ "min_inclusive", "max_inclusive" }`) widens the range
  and must contain `pack_format`.
- **Since 1.21.9** (snapshot 25w31a, resource pack format 65 and up):
  - `pack.min_format` and `pack.max_format` are required. Each is an integer or a `[major, minor]` array.
  - An integer `min_format` (or `[major]`) means `[major, 0]`.
  - An integer `max_format` (or `[major]`) means any minor of that major (minor `0x7fffffff`).
  - `pack_format` became optional and `supported_formats` was removed. Both are still **required** when the
    declared range includes a pre-1.21.9 format (resource < 65, data < 82) so that old versions can read the
    pack, and `supported_formats` **must be absent** otherwise.
  - Overlay entries follow the same rules (`min_format` / `max_format`, legacy `formats` only for old ranges).

`buildResourcePackMcmeta(description, target)` (`src/shared/versions/mcmeta.ts`) writes the minimal file the
target accepts:

| Target style  | Output                                                                          |
| ------------- | ------------------------------------------------------------------------------- |
| `pack_format` | `{ "pack": { "pack_format": 46, "description": "..." } }`                       |
| `minmax`      | `{ "pack": { "min_format": [97, 1], "max_format": 97, "description": "..." } }` |

`min_format` pins the exact format of the target (content may use features of that minor revision) and
`max_format` accepts later minor revisions of the same major format. No legacy field is written because a single
1.21.9+ target never includes a format below 65. Multi-version ranges (export to older versions) come in M7 and
must follow the compatibility rules above.

### Export option "Also accept newer Minecraft versions"

A pack whose `max_format` is below the game's format is listed as "made for an older version" (for example a
26.3 pack, format 97.1, in a 26.4 snapshot, format 103.0). With the export option ticked (`pack.export`
`acceptNewer: true`), `max_format` becomes `OPEN_MAX_FORMAT` (999), so newer games list the pack as compatible:

| Target style  | Output with the option                                                                       |
| ------------- | -------------------------------------------------------------------------------------------- |
| `minmax`      | `{ "min_format": [97, 1], "max_format": 999 }`                                               |
| `pack_format` | `{ "pack_format": 46, "supported_formats": [46, 999], "min_format": 46, "max_format": 999 }` |

For a pre-1.21.9 target the open range spans format 65, so both declarations are written and agree: old games
read `pack_format` / `supported_formats`, newer games `min_format` / `max_format` (the game refuses a pack whose
two declarations disagree). The app cannot check that the textures still match versions it does not know; the
dialog says so. The option only changes the exported zip, never the pack folder's own `pack.mcmeta`.

## Finding client jars

`detectInstalls` (`src/main/services/vanilla/detect.ts`) looks in these folders. Missing folders are skipped.
Only release ids present in the version table are reported; snapshots and other jars are ignored.

| Launcher       | Windows                                                   | macOS                                                                   | Linux                                                                                           | Jar location in that folder                                     |
| -------------- | --------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Official       | `%APPDATA%\.minecraft`                                    | `~/Library/Application Support/minecraft`                               | `~/.minecraft`                                                                                  | `versions/<id>/<id>.jar`                                        |
| Prism Launcher | `%APPDATA%\PrismLauncher`                                 | `~/Library/Application Support/PrismLauncher`                           | `$XDG_DATA_HOME/PrismLauncher`, `~/.var/app/org.prismlauncher.PrismLauncher/data/PrismLauncher` | `libraries/com/mojang/minecraft/<id>/minecraft-<id>-client.jar` |
| MultiMC        | portable, add it by hand                                  | `~/Library/Application Support/MultiMC`                                 | `$XDG_DATA_HOME/multimc`                                                                        | `libraries/com/mojang/minecraft/<id>/minecraft-<id>-client.jar` |
| Modrinth App   | `%APPDATA%\com.modrinth.theseus`, `%APPDATA%\ModrinthApp` | `~/Library/Application Support/com.modrinth.theseus`, `.../ModrinthApp` | `$XDG_DATA_HOME/com.modrinth.theseus`, `$XDG_DATA_HOME/ModrinthApp`                             | `meta/versions/<id>/<id>.jar`                                   |
| CurseForge     | `%USERPROFILE%\curseforge\minecraft\Install`              | `~/Documents/curseforge/minecraft/Install`                              | not supported                                                                                   | `versions/<id>/<id>.jar`                                        |

`$XDG_DATA_HOME` defaults to `~/.local/share`; `%APPDATA%` defaults to `%USERPROFILE%\AppData\Roaming`.

**Manual entries** (`settings.minecraftPaths`, added with the `minecraft.addPath` picker) can be:

- a folder in any of the layouts above (launcher root, CurseForge folder, or a bare `versions` folder holding
  `<id>/<id>.jar`);
- a client `.jar` directly (macOS picker only, since Windows and Linux dialogs cannot mix files and folders). The
  version comes from the file name (`<id>.jar`, `minecraft-<id>-client.jar`) or else from the jar's
  `version.json`.

A manual path is saved only if it holds at least one supported release (else `minecraft.noVersionsFound`).

## Vanilla cache

`VanillaStore.prepare(versionId)` makes the assets of a version available in `userData/vanilla/<id>/`:

1. Already extracted (`index.json` present): done.
2. A jar on disk (detected launchers first, then `userData/jars/<id>.jar` from an earlier download): extract it.
3. Otherwise, if `settings.allowMojangDownload` is on: download it from Mojang (manifest -> version JSON ->
   `downloads.client { url, sha1, size }`), streamed to `userData/jars/<id>.jar.part`, SHA1 and size checked,
   then renamed. Without consent: `vanilla.downloadNotAllowed`.

Extraction runs in a `worker_threads` worker (`extract-worker.ts`, bundled through electron-vite's
`?modulePath` import) and reports progress phases `download`, `extract` and `index`. It copies only:

- `assets/minecraft/{textures,models,blockstates,items,atlases,font}/**`
- `assets/minecraft/lang/en_us.json`, `pack.png`, `version.json`

Entry names are checked (no `..`, absolute path, backslash or empty segment) so a crafted jar cannot write
outside the cache. `index.json` (`VanillaIndex`) is written **last** through a tmp file and a rename: a folder
without it is an interrupted extraction and is redone from scratch. Each entry has the file's sha256 and size,
PNG width and height (read from the IHDR header) and, for PNGs with a `.png.mcmeta` holding `animation`,
`animated: true` and `frameCount` (height / frame height, frame height = `animation.height` or the width).

`resolveFile(versionId, packPath)` only returns existing files inside `userData/vanilla/<id>/` of an extracted
version, and rejects `..`, absolute paths and backslashes.

Concurrent `prepare()` calls for the same version share one promise (progress goes to every caller).

### Error codes

| Code                         | When                                                             |
| ---------------------------- | ---------------------------------------------------------------- |
| `vanilla.versionUnknown`     | Version not in the table, or not in Mojang's manifest            |
| `vanilla.downloadNotAllowed` | No local jar and the user has not allowed Mojang downloads       |
| `vanilla.downloadFailed`     | Network or HTTP error, or no client download in the version JSON |
| `vanilla.checksumMismatch`   | Downloaded jar has the wrong SHA1 or size                        |
| `vanilla.invalidJar`         | Jar unreadable, not a zip, or without a valid `version.json`     |
| `vanilla.jarVersionMismatch` | The jar's `version.json` id is not the expected version          |
| `vanilla.extractFailed`      | Any other extraction failure (disk full, worker crash...)        |
| `minecraft.noVersionsFound`  | A folder / jar picked by hand holds no supported release         |

## Test fixtures

No Mojang asset is ever committed. `scripts/make-fixture-jar.mjs` generates synthetic client jars for two fake
versions:

| Fixture  | `version.json` `pack_version`                                               | Extra content                                     |
| -------- | --------------------------------------------------------------------------- | ------------------------------------------------- |
| `1.21.4` | `{ resource: 46, data: 61 }`                                                | none                                              |
| `26.3`   | `{ resource_major: 97, resource_minor: 1, data_major: 121, data_minor: 0 }` | `item/copper_sword.png`, `block/copper_torch.png` |

Each jar holds about 20 generated PNGs at real vanilla paths (`block/stone.png`, `block/grass_block_top.png`,
`item/diamond_sword.png`, `entity/zombie/zombie.png` 64x64, `gui/...`, `particle/...`, an animated
`block/fire_0.png` 16x512 strip with its `.png.mcmeta`), a few models, a blockstate, an item definition, an atlas,
a font, `lang/en_us.json`, `pack.png`, `version.json`, and files the extractor must skip (`*.class`, `META-INF/`,
`data/`, shaders, `lang/deprecated.json`, `sounds.json`, other namespaces).

```ts
import {
  makeFixtureJar, // (outPath, versionId, { includeUnsafeEntries? }) => Promise<outPath>
  fixtureJarBytes, // (versionId, options?) => Uint8Array
  fixtureJarFiles, // (versionId, options?) => Record<path, Uint8Array>
  expectedExtractedPaths, // (versionId) => string[] the extractor must produce
  FIXTURE_VERSIONS // { '1.21.4': {...}, '26.3': {...} } with pack formats
} from '../../scripts/make-fixture-jar.mjs'

await makeFixtureJar(join(home, 'Library/Application Support/minecraft/versions/26.3/26.3.jar'), '26.3')
```

`includeUnsafeEntries: true` adds zip-slip entries for security tests. From a shell:
`node scripts/make-fixture-jar.mjs <outDir>` writes `<outDir>/1.21.4.jar` and `<outDir>/26.3.jar`.

`tests/integration/vanilla-extract.test.ts` also runs against the real
`~/Library/Application Support/minecraft/versions/1.21.4/1.21.4.jar` when it exists (skipped otherwise).
