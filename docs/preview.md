# 3D preview

How Blocksmith Studio decides what to show in the 3D preview for the texture open in the editor (PLAN 3.4).
The model contract is `PreviewModel` in `src/shared/model/preview.ts`.

## Main process: model resolution

Code: `src/main/services/preview/` and `src/main/ipc/preview-handlers.ts`.

### `texture.preview`

`texture.preview { packId, path } -> PreviewModel`. The kind depends only on the texture folder:

| Texture path                       | Result                                                                                              |
| ---------------------------------- | --------------------------------------------------------------------------------------------------- |
| `assets/<ns>/textures/entity/**`   | `{ kind: 'entity', definition }` when `findEntityDefinition(path)` matches, else `{ kind: 'flat' }` |
| `assets/<ns>/textures/item/**`     | `{ kind: 'item' }` (items whose model is block geometry are not detected yet)                       |
| `assets/<ns>/textures/block/**`    | `{ kind: 'block', modelId, elements, tints }`, see below                                            |
| anything else (gui, particle, ...) | `{ kind: 'flat' }`                                                                                  |

Errors (i18n `errors.<code>`):

| Code                  | When                                                                                                |
| --------------------- | --------------------------------------------------------------------------------------------------- |
| `packs.notFound`      | Unknown pack id (params: `packId`)                                                                  |
| `texture.invalidPath` | Not `assets/<ns>/textures/...png`, invalid characters, traversal or hidden segment (params: `path`) |
| `ipc.invalidInput`    | Payload rejected by the channel's zod schema                                                        |

Block resolution never fails: invalid JSON, missing parents, cycles or I/O errors end in the fallback cube and a
`console.warn`.

### Block model sources

- Vanilla-based packs: every `assets/minecraft/models/**.json` and `assets/minecraft/blockstates/**.json` listed in
  the vanilla index of the pack's authoring version (read through `VanillaStore.resolveFile`).
- The pack's own `assets/<ns>/models/**.json` and `assets/<ns>/blockstates/**.json` (any namespace) replace vanilla
  files with the same id. An invalid pack file replaces the vanilla one too (like in game) and counts as broken.
- Empty packs only use their own files, so their models cannot inherit from vanilla templates such as
  `block/cube_all`.

### Parsing models

- `parent` chains are followed (`block/cube_all` -> `block/cube` -> `block/block`), at most 32 levels, with cycle
  detection. Ids without a namespace are `minecraft:`. Parents under `builtin/` (`builtin/generated`,
  `builtin/entity`) end the chain with no elements.
- `textures` merge along the chain, the child winning. Values are texture ids or `#var` references, resolved
  recursively (a cycle or an undefined variable drops the face). The 1.21.6+ object form `{ "sprite": "..." }` is
  accepted.
- `elements` of the nearest model that defines them replace the parent's. Each element keeps `from`, `to`,
  `rotation` (`origin` defaults to `[8, 8, 8]`), `shade: false` and, per face, `uv`, `rotation` (90/180/270) and
  `tintindex` (>= 0). `cullface` is dropped. Malformed elements and faces are skipped.
- A face without `uv` gets Minecraft's default, the element's projection on that face (rounded to 4 decimals):

| Face    | Default uv `[u1, v1, u2, v2]`          |
| ------- | -------------------------------------- |
| `down`  | `[x1, 16 - z2, x2, 16 - z1]`           |
| `up`    | `[x1, z1, x2, z2]`                     |
| `north` | `[16 - x2, 16 - y2, 16 - x1, 16 - y1]` |
| `south` | `[x1, 16 - y2, x2, 16 - y1]`           |
| `west`  | `[z1, 16 - y2, z2, 16 - y1]`           |
| `east`  | `[16 - z2, 16 - y2, 16 - z1, 16 - y1]` |

- Face textures become pack paths: `minecraft:block/stone` or `block/stone` ->
  `assets/minecraft/textures/block/stone.png`.

### Choosing the model of a block texture

A reverse index maps each texture path to the models whose faces use it after resolution (item models under
`<ns>:item/` are not indexed). Among those models, in order:

1. **Blockstate**: the blockstate named like the texture, or like one of its `_` prefixes, longest first
   (`grass_block_top` -> `grass_block`, `oak_log_top` -> `oak_log`, `furnace_front_on` -> `furnace`). Its variants
   (weighted lists flattened) and multipart `apply` entries are scanned in file order; the first model that uses
   the texture and has no `x`/`y` rotation wins, else the first one that uses it. Variant rotations are not applied
   in M2b, so a rotated variant is shown in its unrotated model orientation.
2. **Same name**: the model `<ns>:block/<texture name>`.
3. **Fewest elements** (ties: shortest id, then alphabetical), which favors plain cubes over stairs, slabs or
   fences.
4. **Fallback cube**: a full cube with the texture on all six faces and `modelId: 'blocksmith:builtin/cube'`. When
   the texture belongs to a known tinted block (`water_flow`, `oak_leaves`...) every face gets `tintindex: 0` with
   that block's color.

On the real jars, 1001 of the 1039 block textures of 1.21.4 and 1250 of the 1300 of 26.3 get a model. The others
are textures without block model geometry: shulker boxes, bells, the conduit, destroy stages, flowing water and
lava, particle-only textures and debug textures.

### Default tints

`tints` holds a color for every `tintindex` used by the chosen model. The color comes from the block name (the
matched blockstate, else the model's last path segment), looked up as is, then with trailing `_` segments removed
(`water_cauldron_level1` -> `water_cauldron`). Unknown `*_leaves` use the foliage color; anything else uses the
grass color. In game these colors come from biome colormaps and Java code; the preview uses plains values.

| Blocks                                                                                                                                   | Color     |
| ---------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `grass_block`, `short_grass`, `tall_grass`, `fern`, `large_fern`, `potted_fern`, `sugar_cane`, `pink_petals`                             | `#91bd59` |
| `oak_leaves`, `jungle_leaves`, `acacia_leaves`, `dark_oak_leaves`, `mangrove_leaves`, `vine`                                             | `#77ab2f` |
| `birch_leaves`                                                                                                                           | `#80a755` |
| `spruce_leaves`                                                                                                                          | `#619961` |
| `water`, `bubble_column`, `water_cauldron`                                                                                               | `#3f76e4` |
| `redstone_wire` (`redstone_dust_*` models), power 15                                                                                     | `#ff3300` |
| `melon_stem`, `pumpkin_stem`, `attached_melon_stem`, `attached_pumpkin_stem` (fully grown)                                               | `#e0c71c` |
| `lily_pad`                                                                                                                               | `#208030` |
| `cherry_leaves`, `pale_oak_leaves`, `bamboo`, `bamboo_sapling`, `stonecutter`, `small_dripleaf`, `lava_cauldron`, `powder_snow_cauldron` | `#ffffff` |
| any other `*_leaves`                                                                                                                     | `#77ab2f` |
| anything else (default)                                                                                                                  | `#91bd59` |

`#ffffff` (untinted) is for blocks whose models have a `tintindex` but no color handler in game. The table lives in
`src/main/services/preview/tints.ts`.

### Caching and performance

- Parsed vanilla files are cached per version and reloaded when the version is re-extracted (`index.createdAt`
  changes).
- Block indexes are cached by vanilla version + pack model files. Every request lists the pack's
  `models/` and `blockstates/` folders and compares paths, sizes and mtimes, so edits made outside the app are
  picked up on the next request. Packs without model files share the vanilla index of their version. Up to 8
  indexes are kept (least recently used evicted).
- Measured on an M-series Mac: 1.21.4 (1998 models) builds in about 110 ms, 26.3 (2650 models) in about 205 ms,
  including reading the files; a request on a warm index takes under 0.1 ms. The build time is logged with
  `console.info`.

### Tests

- `tests/unit/preview-models.test.ts`: parent chains, `#var` cycles, default uvs, texture id -> path.
- `tests/unit/preview-choice.test.ts`: blockstate parsing, reverse index, model choice rules, fallback cube.
- `tests/unit/preview-tints.test.ts`: tint table.
- `tests/integration/preview-service.test.ts`: hand-written vanilla models (cube_all stone, tinted grass block,
  oak log column, cross plant, broken parent, invalid JSON) with pack overrides, empty packs and errors.
- `tests/integration/preview-real-jar.test.ts`: optional, runs against
  `~/Library/Application Support/minecraft/versions/1.21.4/1.21.4.jar` (or `BLOCKSMITH_REAL_JAR`) when present.
  Models and blockstates are extracted into a temp folder that is deleted afterwards; nothing from the jar is
  committed.
