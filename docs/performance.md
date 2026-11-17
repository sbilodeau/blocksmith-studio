# Performance on huge packs

How Blocksmith Studio was measured on very large packs (M11 performance pass), what changed, and how to run the
measurements again. Code: `scripts/make-big-pack.mjs`, `scripts/measure-perf.mjs`,
`tests/perf/pack-service.perf.test.ts`.

## Test pack

`scripts/make-big-pack.mjs` writes a synthetic pack (generated pixels only, never Mojang assets) into a workspace:

| Content          | Count  | Size                                                      |
| ---------------- | ------ | --------------------------------------------------------- |
| 16x16 textures   | 10,000 | spread over block, item, entity, particle, gui            |
| 512x512 textures | 1,950  | about 460 KB each (noise, so they compress like real art) |
| 512x4096 strips  | 50     | 8 frames each, with a `.png.mcmeta`                       |
| Total            | 12,000 | 1 GiB on disk                                             |

The pack is empty-based (no vanilla needed), so every file is the pack's own: the worst case for the texture
index, Pack Doctor and export.

## Method

- **Main process** (`tests/perf/pack-service.perf.test.ts`, vitest project `perf`): the pack service on its own,
  timed with `performance.now()`. "Cold" is a fresh service (empty file info cache), as after an app start; the
  OS file cache is warm since the pack was just written. "Longest event-loop block" is the longest gap seen by a
  5 ms interval timer during the operation: how long main could not answer anything else (IPC, thumbnails).
- **App** (`scripts/measure-perf.mjs`): drives the built app with Playwright on the same pack, viewport 1400x900.
  Each UI timing runs inside the page from the action to the second animation frame after it, so it includes
  Vue's update, layout and paint. Two frames at 60 Hz are 17 to 33 ms: that is the floor of these numbers.
  Selection timings are the median of 5 runs. Scrolling moves one viewport per frame through the whole grid.
- Machine: Apple M2 Pro, 32 GB, macOS 27.2, Node 24.8, Electron 45. "Before" is the M10 code (`1ad0cdc`), "after"
  is this branch, both measured the same day with the same scripts.

## Results

### Main process (ms)

| Operation                                    | Before | After |
| -------------------------------------------- | -----: | ----: |
| `packs.list`, cold (home screen after start) |    873 |   325 |
| `pack.textures`, cold (12,000 textures)      |    822 |   286 |
| Tab load (get + textures + categories), cold |  2,434 |   282 |
| Tab load (get + textures + categories), warm |    294 |    99 |
| `pack.textures`, warm                        |     94 |    97 |
| `pack.textures`, one file changed            |    118 |   122 |
| Structured clone of the list (IPC cost)      |     18 |    14 |
| `pack.doctor`                                |    567 |   275 |
| `pack.export` (1 GiB zip)                    |  3,476 | 3,701 |
| `pack.export`: longest event-loop block      |  2,752 | 2,860 |

### App (ms unless noted)

| Operation                                      |   Before |   After |
| ---------------------------------------------- | -------: | ------: |
| Launch to pack card visible                    |    1,797 |   1,697 |
| Open the pack tab (overview shown)             |      298 |     168 |
| Open the "All" grid (first paint)              |      429 |      25 |
| Tiles in the DOM                               |   12,000 |     120 |
| DOM elements                                   |   48,462 |     893 |
| Renderer JS heap (MiB)                         |       82 |      28 |
| Scroll the whole grid, total                   |    8,697 |   2,638 |
| Scroll frame, median / p95                     |  51 / 77 | 17 / 19 |
| Renderer memory after scrolling it all (MiB)   |    1,018 |     532 |
| Scroll the 512 px textures, frame median / p95 | 51 / 149 | 17 / 71 |
| Click one tile                                 |       64 |      33 |
| Shift-click a range                            |      221 |      34 |
| Select all (Ctrl+A)                            |       52 |      33 |
| Escape (clear the selection)                   |      215 |      35 |
| Search, one keystroke (mean / max)             | 70 / 331 | 33 / 35 |
| Open the editor on a 512x512 texture           |      768 |     155 |
| Paint at fit zoom, frame median / p95          |  18 / 35 | 17 / 34 |
| Paint at 32x zoom, frame median / p95          | 41 / 357 | 16 / 34 |
| Paint at 32x zoom, 60 mouse moves              |   24,396 |   2,086 |
| Back from the editor to the grid               |      329 |     128 |
| Pack Doctor (open to result)                   |    1,420 |     302 |
| Export (click to report)                       |    4,815 |   4,345 |

## What changed

- **One scan per request burst.** Concurrent requests for a pack's texture list (a tab asks for `pack.get`,
  `pack.textures` and `pack.categories` at once) share one scan: `TextureIndexer.textures` in `textures.ts`.
- **Hash only when it matters.** Only a pack file the same size as its vanilla counterpart is read in full and
  hashed (it may be an identical copy). Any other file is `added` or `modified` from its size, and only its 33-byte
  PNG header is read (`FileInfoCache.pngHeader` in `files.ts`).
- **Pack Doctor** reads only the PNG header of images (`doctor` in `packs/service.ts`).
- **Virtual texture grid.** Tiles have a fixed size per zoom level and only the rows in view, plus three above and
  below, are rendered (`TextureGrid.vue`, `grid-layout.ts`, `TextureTile.vue`).
- **Pack store.** Shallow refs for the texture list and the selection (no reactive proxy per entry), search keys
  computed once per load, `selectedPaths` computed once in the store (`stores/pack.ts`).
- **Thumbnails.** `bs-asset://...?thumb=<size>` serves a downscaled PNG (the first frame of a strip) from a 64 MiB
  LRU cache; a tile asks for one when the original is more than four times the size it is shown at
  (`protocol.ts`, `thumbnails.ts`, `shared/assets.ts`, `TextureTile.vue`).
- **Editor.** The checkerboard and the pixel grid are drawn only where the image is on screen (`PixelCanvas.vue`,
  `editor/geometry.ts`). At 32x a 512 px texture is 16,384 px wide, and the checkerboard alone was two million
  rectangles per frame.

Thumbnails were kept after measuring them on top of the virtual grid. Without them, scrolling the 512 px textures
had a p95 frame of 134 ms (max 338 ms) and the renderer reached 1.2 GiB after scrolling the grid, since Chromium
decodes and caches every full image; with them, 84 ms (max 108 ms) and 520 MiB. A thumbnail costs about 5 ms
of main-process time for a 512x512 PNG and 20 ms for a 512x4096 strip (native decode, measured with `nativeImage`),
once per file and size thanks to the cache.

A texture whose status did not need a hash gets a URL version token that changes each time the file is read
again (after a size or mtime change, or an in-app save) instead of a hash prefix, so its thumbnail still refreshes.

## Measured but not changed

- **Export blocks the main process.** A 1 GiB export holds every file in memory (process RSS about 2.6 GiB) and
  builds the zip with `zipSync`, which blocks main for about 3 s: IPC and thumbnails wait meanwhile. The export
  takes about 4 s in total, close to disk speed. The fix is a streaming, deterministic zip writer in a worker
  thread (like the bulk worker), reading one file at a time; it changes `exporter.ts` and `zip.ts` and their
  determinism tests, so it is left for a separate change.
- **Warm refresh, about 100 ms.** Each `pack.textures` lists and stats the 12,000 files to detect changes (every
  `packs.changed`, for example after a save). A file watcher could replace the stat pass, at the cost of
  platform-specific behavior; not worth it at this size.
- **Launch.** About 1.4 s of the 1.7 s is Electron starting; the cold pack list is about 0.3 s of it.
- **Editor upload.** `PixelCanvas` uploads the whole image with `putImageData` on every frame (1 MiB at 512x512);
  frames stay at 60 fps (p95 two frames), so it was left alone while the editor is being reworked for layers.
- **Renderer memory after scrolling everything**, about 530 MiB, is mostly Chromium's image cache (12,000
  thumbnails and small textures) and shrinks under memory pressure.

## Regression guards

- `tests/integration/textures-index.test.ts` ("texture index I/O"): a tab's three concurrent requests read each
  file at most once, only same-size vanilla copies are read in full, a warm refresh reads nothing, a rewritten
  header-only texture gets a new URL, and Pack Doctor never reads a PNG in full.
- `tests/component/texture-grid.test.ts`: with 10,000 textures the grid renders fewer than 300 tiles, follows the
  scroll position, keeps click / shift / Ctrl+A / Escape selection, restores the scroll position and reveals the
  last edited tile. `tests/component/grid-layout.test.ts` covers the layout math.
- `tests/unit/thumbnails.test.ts`: thumbnail sizes, URLs, crop and resize plan, LRU cache, served bytes.
- `tests/component/editor-geometry.test.ts`: the visible span the editor draws.

None of them asserts a duration, so they do not depend on the CI machine.

## Running the measurements

```sh
# Main process: generates the pack in a temp folder (or reuses BLOCKSMITH_PERF_WORKSPACE) and prints a table.
BLOCKSMITH_PERF=1 npx vitest run --project perf --silent=false

# App: builds, then drives the real app on the same kind of pack.
npm run build
node scripts/measure-perf.mjs

# Generate the pack once and reuse it (sizes are options of all three).
node scripts/make-big-pack.mjs /tmp/big-ws --small 10000 --large 2000 --animated 50
BLOCKSMITH_PERF=1 BLOCKSMITH_PERF_WORKSPACE=/tmp/big-ws npx vitest run --project perf --silent=false
node scripts/measure-perf.mjs --workspace /tmp/big-ws
```

The perf project is skipped unless `BLOCKSMITH_PERF` is set, so `npm test` never runs it. Numbers vary between
runs by about 10 percent; compare before and after on the same machine.
