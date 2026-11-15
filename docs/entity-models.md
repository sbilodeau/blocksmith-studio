# Entity models

Minecraft keeps entity geometry in its Java code, not in the assets. The 3D preview gets it in two ways:

1. **From the user's own Minecraft jar** (26.1 and later, whose code is not obfuscated): every model the game
   registers, read when the version is extracted. This covers all entities, babies and block entities. See
   [Models read from the jar](#models-read-from-the-jar).
2. **Built-in definitions** for older versions and as a fallback, described in the rest of this page.

The preview uses the jar model when the texture -> layer table names one, then the built-in definition, then the flat
view.

## Models read from the jar

Since 26.1 the Minecraft client jar keeps readable class and method names. The model code is a sequence of builder
calls (`CubeListBuilder.texOffs(..).addBox(..)`, `PartPose.offsetAndRotation(..)`, `addOrReplaceChild(..)`),
registered in `LayerDefinitions.createRoots()` under named layers (`ModelLayers.AXOLOTL_BABY` = `axolotl_baby#main`).

| Piece                                                                           | Role                                                                                                                                        |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| [`classfile.ts`](../src/main/services/entity-models/classfile.ts)               | Reads JVM class files (constant pool, methods, code, bootstrap methods)                                                                     |
| [`interpreter.ts`](../src/main/services/entity-models/interpreter.ts)           | Symbolic JVM interpreter: runs the bytecode of `client/model/**` and the entity / block-entity renderers, simulates the JDK pieces they use |
| [`extract.ts`](../src/main/services/entity-models/extract.ts)                   | Runs the registry, converts each layer to the preview format, writes `entity-models.json`                                                   |
| [`resources/data/entity-layers.json`](../resources/data/entity-layers.json)     | Texture -> layer table (names only, hand-maintained)                                                                                        |
| [`src/shared/preview/entity-layers.ts`](../src/shared/preview/entity-layers.ts) | Table lookup (`findEntityLayer`)                                                                                                            |

How it runs:

- **When**: during vanilla extraction (`userData/vanilla/<version>/entity-models.json`, next to `index.json`), or on
  first use for versions extracted before this feature (from the same jar). 26.3 gives 361 layers in about 0.2 s.
- **What is executed**: nothing natively. The interpreter only steps through bytecode. Classes outside the model and
  renderer packages are simulated (lists, maps, sets, iterators, Guava builders, boxing, `Math`, `Mth`,
  `Direction`, `Identifier`, JOML `Vector3f`, lambdas, string concatenation, Mojang's seeded `RandomSource`) or
  become an unknown value. Branching on an unknown value, throwing, or running out of budget aborts that method
  only; the layer that needed it is skipped, never guessed.
- **Conversion**: Mojang's coordinates (y down, entity front at -z, offsets relative to the parent part) become the
  preview's (y up, front +z, absolute pivots): `y' = 24 - y`, `z' = -z`, rotations `(x, -y, -z)`. Mesh transformers
  (baby scaling) are kept as a part `scale`; per-axis inflation, `texScale` (`uvScale`) and visible faces (`faces`)
  are carried over.
- **Nothing is redistributed**: the geometry stays in the user's `userData`, like the extracted textures.

Limits: armor model sets depend on a map keyed by `EquipmentSlot` that is built outside the model code, so their
"keep only these parts" step is not applied (the table does not use armor layers; humanoid armor keeps its built-in
definition). Animations (`setupAnim`) are not interpreted: models show their rest pose, with the preview's own walk
animation when the part names match.

### The texture -> layer table

`resources/data/entity-layers.json` maps texture globs to layer ids:

```json
{ "textures": ["assets/minecraft/textures/entity/axolotl/axolotl_*_baby.png"], "layer": "axolotl_baby#main" }
```

Rules: one entry per texture at most (tested); overlays (eyes, collars, markings, saddles, armor) use the layer they
are drawn on; baby textures use the `*_baby` layers. To check the table against a real jar and its textures:

```bash
BLOCKSMITH_REAL_JAR="<userData>/jars/26.3.jar" \
BLOCKSMITH_REAL_JAR_TEXTURES="<userData>/vanilla/26.3" npm run test:real-jar
```

It fails when an entry names a layer the jar does not have, or a texture whose size does not fit its layer.
`BLOCKSMITH_REAL_JAR_DUMP=<file.json>` also writes the extracted models for inspection. This test never runs in CI and
reads only your local files.

### Tests without Mojang code

[`scripts/lib/class-assembler.mjs`](../scripts/lib/class-assembler.mjs) writes class files from a short instruction
list. [`scripts/lib/synthetic-models.mjs`](../scripts/lib/synthetic-models.mjs) uses it to build stand-in model code
with the same package and field names (our own simplified bodies): a demo model (children, rotation, a loop, string
concatenation, mirror, inflate, visible faces), a scaled baby layer through a lambda, a `zombie#main` layer, and a
model that throws. The 26.3 fixture jar includes these classes, so the extraction, the store, the preview and the E2E
test all go through the jar path.

## Built-in definitions

The app ships its own geometry definitions: one data-only JSON file per entity in
[`resources/data/entity-models/`](../resources/data/entity-models/). They were written for Blocksmith Studio from
the publicly known box sizes, positions and texture offsets of the vanilla models, and are MIT licensed like the rest of
the repository. Nothing is copied from Mojang code, Blockbench or OptiFine CEM templates, and no Mojang asset is in the
repository.

The format is the `EntityDefinition` contract of [`src/shared/model/preview.ts`](../src/shared/model/preview.ts),
validated by the zod schema in [`src/shared/preview/entity-schema.ts`](../src/shared/preview/entity-schema.ts). The
texture mapping is the Minecraft "box UV" layout implemented in
[`src/shared/preview/box-uv.ts`](../src/shared/preview/box-uv.ts).

## Loading

[`src/shared/preview/entities.ts`](../src/shared/preview/entities.ts) imports every JSON file statically and exposes:

- `entityDefinitions()`: all definitions, validated once (an invalid file throws with its file name).
- `findEntityDefinition(packPath)`: the first definition whose `textures` globs match the pack path
  (`assets/minecraft/textures/entity/zombie/zombie.png`), or `undefined` (the preview then falls back to the flat view).
  Baby textures (`*_baby.png`, own layouts since 26.1) never match: they use the flat view until they get definitions.
- `entityFitsTexture(definition, width, height)`: whether the texture has the aspect ratio of the definition's
  `textureSize`. The preview draws the flat view instead of a model whose layout does not fit (a texture whose layout
  changed between versions), while HD textures (a multiple of the size) still fit.

The files are plain static imports rather than `import.meta.glob`, because `import.meta.glob` has no types in the node
tsconfig and is not guaranteed outside Vite. Static JSON imports work the same in the main process, the renderer,
Vitest and `tsc`. The cost is one line per file in `entities.ts`; `tests/unit/entity-models.test.ts` fails when a JSON
file of the folder is not registered there, or when a file is not named `<id>.json`.

Globs use the shared matcher of [`src/shared/categories/glob.ts`](../src/shared/categories/glob.ts) (`*`, `**`, `?`,
`{a,b}`), matched against the whole pack path. A texture path must match at most one definition (tested against the
known 1.21.4 and 26.3 entity textures). When Minecraft changes a layout (26.3 farm animal variants are 64 x 64), the
old paths keep their definition and the new paths get a new one (`pig` / `pig_variants`, `cow` / `cow_variants`).

## Format

```json
{
  "id": "pig",
  "textureSize": [64, 32],
  "animation": "quadruped",
  "textures": ["assets/minecraft/textures/entity/pig/pig.png"],
  "parts": [
    {
      "name": "body",
      "role": "body",
      "pivot": [0, 13, -2],
      "rotation": [90, 0, 0],
      "boxes": [{ "origin": [-5, 7, -3], "size": [10, 16, 8], "uv": [28, 8] }]
    }
  ]
}
```

| Field           | Meaning                                                                                                   |
| --------------- | --------------------------------------------------------------------------------------------------------- |
| `id`            | `[a-z0-9_]`, unique, equal to the file name                                                               |
| `textureSize`   | Size in pixels the UVs refer to; an HD texture (a multiple of it) is scaled                               |
| `textures`      | Pack paths of the textures using this geometry, globs allowed                                             |
| `animation`     | `biped`, `quadruped` or `none`: which idle/walk animation the preview may play                            |
| `parts[].name`  | `[a-z0-9_]`, unique within the definition                                                                 |
| `parts[].role`  | What the animation moves: `head`, `body`, arms, legs, `tail`, `wing` (unique per definition except wings) |
| `parts[].pivot` | Rotation pivot, absolute entity coordinates                                                               |
| `rotation`      | Rest rotation in degrees `[x, y, z]`, around the pivot                                                    |
| `boxes[]`       | Cubes of the part (see below)                                                                             |
| `children`      | Sub-parts that follow the part (only used under parts without rest rotation)                              |
| `origin`        | Minimum corner of the box, absolute entity coordinates                                                    |
| `size`          | `[width (x), height (y), depth (z)]` in pixels; 0 is allowed for flat planes                              |
| `uv`            | Top-left corner of the box UV layout in the texture                                                       |
| `mirror`        | Mirrors the texture like Minecraft's mirrored limbs                                                       |
| `inflate`       | Grows the box by this many pixels on every side without changing its UV (negative shrinks)                |

### Coordinates

- Units are texture pixels (16 per block). `y` is up and the feet stand on `y = 0`.
- The entity faces **+z**. Its **right** side is **-x** and its left side is **+x** (this is what `box-uv.ts` expects:
  the layout's "right" strip goes on the -x face, "left" on +x, "front" on +z, "back" on -z, "top" on +y).
- Box origins and part pivots are **absolute** coordinates of the rest pose (not relative to the pivot or the parent).
- A part's transform is `translate(pivot) * R * translate(-pivot)`, composed with its parent's transform for children.
- `R` rotates around **x first, then y, then z** (matrix `Rz * Ry * Rx`, which is three.js Euler order `'ZYX'`), the
  same order as Minecraft. Angles follow the right-hand rule.

### Box UV layout

For a box of size `(w, h, d)` at `uv (u, v)`:

```
          u     u+d    u+d+w  u+2d+w  u+2d+2w
   v      .     [ top ][bottom]   .
   v+d    [right][front][ left ][ back ]
   v+d+h
```

The layout covers `(2d + 2w) x (d + h)` pixels; its two top corners are unused and Minecraft often packs small boxes
(horns, ears) there.

## Converting vanilla model numbers

Vanilla models use a different space: `y` down, feet at `y = 24`, front towards `-z`, and boxes relative to their
part pivot. For a vanilla part with pivot `(px, py, pz)`, box offset `(ox, oy, oz)` and size `(w, h, d)`:

| Our value       | Formula                                         |
| --------------- | ----------------------------------------------- |
| box `origin`    | `[px + ox, 24 - (py + oy + h), -(pz + oz + d)]` |
| part `pivot`    | `[px, 24 - py, -pz]`                            |
| part `rotation` | `[deg(xRot), -deg(yRot), -deg(zRot)]`           |
| `size`, `uv`    | unchanged                                       |
| `mirror`        | unchanged                                       |
| `inflate`       | the box's cube deformation                      |

The conversion is a 180 degree turn around x, so it keeps x rotations and negates y and z rotations. The rest pose
should be the pose the vanilla model shows when idle, including rotations its animation code always applies (the
spider's leg angles, the cat's tail, the zombie's raised arms).

## Conventions and decisions

- **Lying bodies** (pig, cow, sheep, wool, wolf body and mane, cat, chicken): the body box is authored **standing**,
  with the sizes of its texture layout, and the part is rotated `[90, 0, 0]` around its pivot, as in vanilla. A box
  authored directly in its lying orientation would need a layout with depth and height swapped, which does not match
  the textures. After the rotation the layout's **back** face is on top (the animal's back), the **front** face is the
  belly, **top** faces the head and **bottom** faces the tail. For the pig this puts the curly tail drawing (bottom
  region) on the rear, and for the cow the pink udder patch (front region) under the belly. A unit test checks the face
  directions.
- **Mirroring**: legacy 64x32 humanoids and the zombie (64x64 texture but legacy model) reuse the right arm and leg
  layouts for the left limbs with `mirror: true`. Player skins and the drowned have separate left limbs at
  `uv(32, 48)` and `uv(16, 48)`, without mirror.
- **Overlays** are extra boxes in the same part with `inflate`: hat `uv(32, 0)` +0.5, player jacket, sleeves and pants
  +0.25, villager hat +0.51 and robe +0.5. Armor layers use inflate 1.0 (head, body, arms), 0.9 (boots, as vanilla
  shrinks the legs by 0.1) and 0.5 / 0.4 for leggings.
- **Shared layouts**: boxes with the same `uv` and `size` share their pixels on purpose (mirrored limbs, quadruped
  legs, cow horns, spider legs). The tests reject any other overlap between the used faces of two boxes.
- **Separate definitions** for layers whose geometry differs: `sheep_wool` (`sheep_fur.png`: smaller head, short legs,
  big inflates), `skeleton_overlay` (stray and bogged clothing: full-width limbs with inflate 0.25),
  `humanoid_leggings`. Layers with the same geometry share the definition: `drowned_outer_layer.png` uses the drowned
  geometry (vanilla only inflates it by 0.25), `pig_saddle.png` the pig, mooshrooms the cow, `wolf_collar.png` and the
  wolf armor crackiness overlays the wolf, `cat_collar.png` and the ocelot the cat, villager types, professions and
  level badges the villager.
- **Ground**: vanilla sinks the enderman's 30 px legs 1 px into the ground and the cat's front legs 0.1 px; our
  enderman is lifted by 1 px and the cat's front legs start at y = 10, so every model stands on `y = 0`. The spider's
  straight legs end about 0.3 to 0.6 px above the ground, as in vanilla.
- **Poses**: zombie and drowned arms are raised forward (`-80` degrees around x, the idle zombie pose); skeleton arms
  hang. The armor stand has `animation: "none"` (it never walks).
- **Small vanilla details kept**: legs at `x = +-1.9` (they overlap by 0.2 px so their inner faces never z-fight), the
  enderman head 1 px into the body, the enderman's inner jaw (`uv(0, 16)`, inflate -0.5, hidden at rest).
- **Not modeled**: armor stand arms/base variants, the bogged mushrooms, saddles and collars as separate geometry,
  ears and cloaks of player skins.

## Adding an entity

1. Create `resources/data/entity-models/<id>.json` following the format above (Prettier formats it; keep one box per
   line).
2. Register it in `src/shared/preview/entities.ts` (one import and one entry in `RAW_DEFINITIONS`).
3. Add its known texture paths and PNG sizes to `KNOWN_ENTITY_TEXTURES` and its height to `EXPECTED_HEIGHTS` in
   `tests/unit/entity-models.test.ts`, and a lookup case to `tests/unit/entity-lookup.test.ts`.
4. Check the UV layout against the real texture from your extracted vanilla cache:
   `node scripts/entity-uv-overlay.mjs resources/data/entity-models/<id>.json <vanilla>/.../texture.png out.png`
   draws every box's faces over the texture; all painted pixels must sit inside the outlines. Never commit the
   output (Mojang pixels).
5. Run `npx vitest run tests/unit/entity-` and check the model visually in the preview.

`node scripts/audit-entity-models.mjs <userData>/vanilla/<version>` lists, for an extracted version, the textures
each definition matches, the ones with another size than its layout, and the entity folders without a definition.

The tests check: schema validity; unique ids, part names and roles; the roles needed by the animation; that every glob
matches a known vanilla texture and every known texture matches exactly one definition with the right texture size;
that every UV layout is inside the texture and does not overlap another layout; that the model stands on `y = 0`, has
its expected height and is symmetric around `x = 0`; for bipeds, head on the body, legs under it and arms beside it.

## Definitions

"Texture region" is the full box UV layout `u1,v1 - u2,v2` (see the layout above for the six faces inside it).
Positions and pivots are in the JSON files.

### zombie

Texture 64 x 64, animation `biped`. Textures: `entity/zombie/zombie.png`, `entity/zombie/husk.png`.

| Part        | Role     | Size (w x h x d) | UV     | Texture region | Notes                           |
| ----------- | -------- | ---------------- | ------ | -------------- | ------------------------------- |
| `head`      | head     | 8 x 8 x 8        | 0, 0   | 0,0 - 32,16    |                                 |
|             |          | 8 x 8 x 8        | 32, 0  | 32,0 - 64,16   | inflate 0.5                     |
| `body`      | body     | 8 x 12 x 4       | 16, 16 | 16,16 - 40,32  |                                 |
| `right_arm` | rightArm | 4 x 12 x 4       | 40, 16 | 40,16 - 56,32  | part rotation -80, 0, 0         |
| `left_arm`  | leftArm  | 4 x 12 x 4       | 40, 16 | 40,16 - 56,32  | part rotation -80, 0, 0, mirror |
| `right_leg` | rightLeg | 4 x 12 x 4       | 0, 16  | 0,16 - 16,32   |                                 |
| `left_leg`  | leftLeg  | 4 x 12 x 4       | 0, 16  | 0,16 - 16,32   | mirror                          |

### drowned

Texture 64 x 64, animation `biped`. Textures: `entity/zombie/drowned.png`, `entity/zombie/drowned_outer_layer.png`.

| Part        | Role     | Size (w x h x d) | UV     | Texture region | Notes                   |
| ----------- | -------- | ---------------- | ------ | -------------- | ----------------------- |
| `head`      | head     | 8 x 8 x 8        | 0, 0   | 0,0 - 32,16    |                         |
|             |          | 8 x 8 x 8        | 32, 0  | 32,0 - 64,16   | inflate 0.5             |
| `body`      | body     | 8 x 12 x 4       | 16, 16 | 16,16 - 40,32  |                         |
| `right_arm` | rightArm | 4 x 12 x 4       | 40, 16 | 40,16 - 56,32  | part rotation -80, 0, 0 |
| `left_arm`  | leftArm  | 4 x 12 x 4       | 32, 48 | 32,48 - 48,64  | part rotation -80, 0, 0 |
| `right_leg` | rightLeg | 4 x 12 x 4       | 0, 16  | 0,16 - 16,32   |                         |
| `left_leg`  | leftLeg  | 4 x 12 x 4       | 16, 48 | 16,48 - 32,64  |                         |

### skeleton

Texture 64 x 32, animation `biped`. Textures: `entity/skeleton/skeleton.png`, `entity/skeleton/stray.png`, `entity/skeleton/wither_skeleton.png`, `entity/skeleton/bogged.png`.

| Part        | Role     | Size (w x h x d) | UV     | Texture region | Notes       |
| ----------- | -------- | ---------------- | ------ | -------------- | ----------- |
| `head`      | head     | 8 x 8 x 8        | 0, 0   | 0,0 - 32,16    |             |
|             |          | 8 x 8 x 8        | 32, 0  | 32,0 - 64,16   | inflate 0.5 |
| `body`      | body     | 8 x 12 x 4       | 16, 16 | 16,16 - 40,32  |             |
| `right_arm` | rightArm | 2 x 12 x 2       | 40, 16 | 40,16 - 48,30  |             |
| `left_arm`  | leftArm  | 2 x 12 x 2       | 40, 16 | 40,16 - 48,30  | mirror      |
| `right_leg` | rightLeg | 2 x 12 x 2       | 0, 16  | 0,16 - 8,30    |             |
| `left_leg`  | leftLeg  | 2 x 12 x 2       | 0, 16  | 0,16 - 8,30    | mirror      |

### skeleton_overlay

Texture 64 x 32, animation `biped`. Textures: `entity/skeleton/stray_overlay.png`, `entity/skeleton/bogged_overlay.png`.

| Part        | Role     | Size (w x h x d) | UV     | Texture region | Notes                |
| ----------- | -------- | ---------------- | ------ | -------------- | -------------------- |
| `head`      | head     | 8 x 8 x 8        | 0, 0   | 0,0 - 32,16    | inflate 0.25         |
|             |          | 8 x 8 x 8        | 32, 0  | 32,0 - 64,16   | inflate 0.75         |
| `body`      | body     | 8 x 12 x 4       | 16, 16 | 16,16 - 40,32  | inflate 0.25         |
| `right_arm` | rightArm | 4 x 12 x 4       | 40, 16 | 40,16 - 56,32  | inflate 0.25         |
| `left_arm`  | leftArm  | 4 x 12 x 4       | 40, 16 | 40,16 - 56,32  | mirror, inflate 0.25 |
| `right_leg` | rightLeg | 4 x 12 x 4       | 0, 16  | 0,16 - 16,32   | inflate 0.25         |
| `left_leg`  | leftLeg  | 4 x 12 x 4       | 0, 16  | 0,16 - 16,32   | mirror, inflate 0.25 |

### player_wide

Texture 64 x 64, animation `biped`. Textures: `entity/player/wide/*.png`.

| Part        | Role     | Size (w x h x d) | UV     | Texture region | Notes        |
| ----------- | -------- | ---------------- | ------ | -------------- | ------------ |
| `head`      | head     | 8 x 8 x 8        | 0, 0   | 0,0 - 32,16    |              |
|             |          | 8 x 8 x 8        | 32, 0  | 32,0 - 64,16   | inflate 0.5  |
| `body`      | body     | 8 x 12 x 4       | 16, 16 | 16,16 - 40,32  |              |
|             |          | 8 x 12 x 4       | 16, 32 | 16,32 - 40,48  | inflate 0.25 |
| `right_arm` | rightArm | 4 x 12 x 4       | 40, 16 | 40,16 - 56,32  |              |
|             |          | 4 x 12 x 4       | 40, 32 | 40,32 - 56,48  | inflate 0.25 |
| `left_arm`  | leftArm  | 4 x 12 x 4       | 32, 48 | 32,48 - 48,64  |              |
|             |          | 4 x 12 x 4       | 48, 48 | 48,48 - 64,64  | inflate 0.25 |
| `right_leg` | rightLeg | 4 x 12 x 4       | 0, 16  | 0,16 - 16,32   |              |
|             |          | 4 x 12 x 4       | 0, 32  | 0,32 - 16,48   | inflate 0.25 |
| `left_leg`  | leftLeg  | 4 x 12 x 4       | 16, 48 | 16,48 - 32,64  |              |
|             |          | 4 x 12 x 4       | 0, 48  | 0,48 - 16,64   | inflate 0.25 |

### player_slim

Texture 64 x 64, animation `biped`. Textures: `entity/player/slim/*.png`.

| Part        | Role     | Size (w x h x d) | UV     | Texture region | Notes        |
| ----------- | -------- | ---------------- | ------ | -------------- | ------------ |
| `head`      | head     | 8 x 8 x 8        | 0, 0   | 0,0 - 32,16    |              |
|             |          | 8 x 8 x 8        | 32, 0  | 32,0 - 64,16   | inflate 0.5  |
| `body`      | body     | 8 x 12 x 4       | 16, 16 | 16,16 - 40,32  |              |
|             |          | 8 x 12 x 4       | 16, 32 | 16,32 - 40,48  | inflate 0.25 |
| `right_arm` | rightArm | 3 x 12 x 4       | 40, 16 | 40,16 - 54,32  |              |
|             |          | 3 x 12 x 4       | 40, 32 | 40,32 - 54,48  | inflate 0.25 |
| `left_arm`  | leftArm  | 3 x 12 x 4       | 32, 48 | 32,48 - 46,64  |              |
|             |          | 3 x 12 x 4       | 48, 48 | 48,48 - 62,64  | inflate 0.25 |
| `right_leg` | rightLeg | 4 x 12 x 4       | 0, 16  | 0,16 - 16,32   |              |
|             |          | 4 x 12 x 4       | 0, 32  | 0,32 - 16,48   | inflate 0.25 |
| `left_leg`  | leftLeg  | 4 x 12 x 4       | 16, 48 | 16,48 - 32,64  |              |
|             |          | 4 x 12 x 4       | 0, 48  | 0,48 - 16,64   | inflate 0.25 |

### armor_stand

Texture 64 x 64, animation `none`. Textures: `entity/armorstand/*.png`.

| Part         | Role     | Size (w x h x d) | UV     | Texture region | Notes  |
| ------------ | -------- | ---------------- | ------ | -------------- | ------ |
| `head`       | head     | 2 x 7 x 2        | 0, 0   | 0,0 - 8,9      |        |
| `body`       | body     | 12 x 3 x 3       | 0, 26  | 0,26 - 30,32   |        |
|              |          | 2 x 7 x 2        | 16, 0  | 16,0 - 24,9    |        |
|              |          | 2 x 7 x 2        | 48, 16 | 48,16 - 56,25  |        |
|              |          | 8 x 2 x 2        | 0, 48  | 0,48 - 20,52   |        |
| `right_arm`  | rightArm | 2 x 12 x 2       | 24, 0  | 24,0 - 32,14   |        |
| `left_arm`   | leftArm  | 2 x 12 x 2       | 32, 16 | 32,16 - 40,30  | mirror |
| `right_leg`  | rightLeg | 2 x 11 x 2       | 8, 0   | 8,0 - 16,13    |        |
| `left_leg`   | leftLeg  | 2 x 11 x 2       | 40, 16 | 40,16 - 48,29  | mirror |
| `base_plate` |          | 12 x 1 x 12      | 0, 32  | 0,32 - 48,45   |        |

### humanoid_armor

Texture 64 x 32, animation `biped`. Textures: `entity/equipment/humanoid/*.png`.

| Part        | Role     | Size (w x h x d) | UV     | Texture region | Notes               |
| ----------- | -------- | ---------------- | ------ | -------------- | ------------------- |
| `head`      | head     | 8 x 8 x 8        | 0, 0   | 0,0 - 32,16    | inflate 1           |
|             |          | 8 x 8 x 8        | 32, 0  | 32,0 - 64,16   | inflate 1.5         |
| `body`      | body     | 8 x 12 x 4       | 16, 16 | 16,16 - 40,32  | inflate 1           |
| `right_arm` | rightArm | 4 x 12 x 4       | 40, 16 | 40,16 - 56,32  | inflate 1           |
| `left_arm`  | leftArm  | 4 x 12 x 4       | 40, 16 | 40,16 - 56,32  | mirror, inflate 1   |
| `right_leg` | rightLeg | 4 x 12 x 4       | 0, 16  | 0,16 - 16,32   | inflate 0.9         |
| `left_leg`  | leftLeg  | 4 x 12 x 4       | 0, 16  | 0,16 - 16,32   | mirror, inflate 0.9 |

### humanoid_leggings

Texture 64 x 32, animation `biped`. Textures: `entity/equipment/humanoid_leggings/*.png`.

| Part        | Role     | Size (w x h x d) | UV     | Texture region | Notes               |
| ----------- | -------- | ---------------- | ------ | -------------- | ------------------- |
| `body`      | body     | 8 x 12 x 4       | 16, 16 | 16,16 - 40,32  | inflate 0.5         |
| `right_leg` | rightLeg | 4 x 12 x 4       | 0, 16  | 0,16 - 16,32   | inflate 0.4         |
| `left_leg`  | leftLeg  | 4 x 12 x 4       | 0, 16  | 0,16 - 16,32   | mirror, inflate 0.4 |

### creeper

Texture 64 x 32, animation `quadruped`. Textures: `entity/creeper/creeper.png`.

| Part              | Role          | Size (w x h x d) | UV     | Texture region | Notes |
| ----------------- | ------------- | ---------------- | ------ | -------------- | ----- |
| `head`            | head          | 8 x 8 x 8        | 0, 0   | 0,0 - 32,16    |       |
| `body`            | body          | 8 x 12 x 4       | 16, 16 | 16,16 - 40,32  |       |
| `right_hind_leg`  | backRightLeg  | 4 x 6 x 4        | 0, 16  | 0,16 - 16,26   |       |
| `left_hind_leg`   | backLeftLeg   | 4 x 6 x 4        | 0, 16  | 0,16 - 16,26   |       |
| `right_front_leg` | frontRightLeg | 4 x 6 x 4        | 0, 16  | 0,16 - 16,26   |       |
| `left_front_leg`  | frontLeftLeg  | 4 x 6 x 4        | 0, 16  | 0,16 - 16,26   |       |

### pig

Texture 64 x 32, animation `quadruped`. Textures: `entity/pig/pig.png`, `entity/pig/pig_saddle.png`.

| Part              | Role          | Size (w x h x d) | UV     | Texture region | Notes                  |
| ----------------- | ------------- | ---------------- | ------ | -------------- | ---------------------- |
| `head`            | head          | 8 x 8 x 8        | 0, 0   | 0,0 - 32,16    |                        |
|                   |               | 4 x 3 x 1        | 16, 16 | 16,16 - 26,20  |                        |
| `body`            | body          | 10 x 16 x 8      | 28, 8  | 28,8 - 64,32   | part rotation 90, 0, 0 |
| `right_hind_leg`  | backRightLeg  | 4 x 6 x 4        | 0, 16  | 0,16 - 16,26   |                        |
| `left_hind_leg`   | backLeftLeg   | 4 x 6 x 4        | 0, 16  | 0,16 - 16,26   |                        |
| `right_front_leg` | frontRightLeg | 4 x 6 x 4        | 0, 16  | 0,16 - 16,26   |                        |
| `left_front_leg`  | frontLeftLeg  | 4 x 6 x 4        | 0, 16  | 0,16 - 16,26   |                        |

### cow

Texture 64 x 32, animation `quadruped`. Textures: `entity/cow/*.png`.

| Part              | Role          | Size (w x h x d) | UV    | Texture region | Notes                  |
| ----------------- | ------------- | ---------------- | ----- | -------------- | ---------------------- |
| `head`            | head          | 8 x 8 x 6        | 0, 0  | 0,0 - 28,14    |                        |
|                   |               | 1 x 3 x 1        | 22, 0 | 22,0 - 26,4    |                        |
|                   |               | 1 x 3 x 1        | 22, 0 | 22,0 - 26,4    |                        |
| `body`            | body          | 12 x 18 x 10     | 18, 4 | 18,4 - 62,32   | part rotation 90, 0, 0 |
|                   |               | 4 x 6 x 1        | 52, 0 | 52,0 - 62,7    |                        |
| `right_hind_leg`  | backRightLeg  | 4 x 12 x 4       | 0, 16 | 0,16 - 16,32   |                        |
| `left_hind_leg`   | backLeftLeg   | 4 x 12 x 4       | 0, 16 | 0,16 - 16,32   |                        |
| `right_front_leg` | frontRightLeg | 4 x 12 x 4       | 0, 16 | 0,16 - 16,32   |                        |
| `left_front_leg`  | frontLeftLeg  | 4 x 12 x 4       | 0, 16 | 0,16 - 16,32   |                        |

### sheep

Texture 64 x 32, animation `quadruped`. Textures: `entity/sheep/sheep.png`.

| Part              | Role          | Size (w x h x d) | UV    | Texture region | Notes                  |
| ----------------- | ------------- | ---------------- | ----- | -------------- | ---------------------- |
| `head`            | head          | 6 x 6 x 8        | 0, 0  | 0,0 - 28,14    |                        |
| `body`            | body          | 8 x 16 x 6       | 28, 8 | 28,8 - 56,30   | part rotation 90, 0, 0 |
| `right_hind_leg`  | backRightLeg  | 4 x 12 x 4       | 0, 16 | 0,16 - 16,32   |                        |
| `left_hind_leg`   | backLeftLeg   | 4 x 12 x 4       | 0, 16 | 0,16 - 16,32   |                        |
| `right_front_leg` | frontRightLeg | 4 x 12 x 4       | 0, 16 | 0,16 - 16,32   |                        |
| `left_front_leg`  | frontLeftLeg  | 4 x 12 x 4       | 0, 16 | 0,16 - 16,32   |                        |

### sheep_wool

Texture 64 x 32, animation `quadruped`. Textures: `entity/sheep/sheep_fur.png`.

| Part              | Role          | Size (w x h x d) | UV    | Texture region | Notes                                |
| ----------------- | ------------- | ---------------- | ----- | -------------- | ------------------------------------ |
| `head`            | head          | 6 x 6 x 6        | 0, 0  | 0,0 - 24,12    | inflate 0.6                          |
| `body`            | body          | 8 x 16 x 6       | 28, 8 | 28,8 - 56,30   | part rotation 90, 0, 0, inflate 1.75 |
| `right_hind_leg`  | backRightLeg  | 4 x 6 x 4        | 0, 16 | 0,16 - 16,26   | inflate 0.5                          |
| `left_hind_leg`   | backLeftLeg   | 4 x 6 x 4        | 0, 16 | 0,16 - 16,26   | inflate 0.5                          |
| `right_front_leg` | frontRightLeg | 4 x 6 x 4        | 0, 16 | 0,16 - 16,26   | inflate 0.5                          |
| `left_front_leg`  | frontLeftLeg  | 4 x 6 x 4        | 0, 16 | 0,16 - 16,26   | inflate 0.5                          |

### chicken

Texture 64 x 32, animation `none`. Textures: `entity/chicken.png`.

| Part         | Role     | Size (w x h x d) | UV     | Texture region | Notes                  |
| ------------ | -------- | ---------------- | ------ | -------------- | ---------------------- |
| `head`       | head     | 4 x 6 x 3        | 0, 0   | 0,0 - 14,9     |                        |
|              |          | 4 x 2 x 2        | 14, 0  | 14,0 - 26,4    |                        |
|              |          | 2 x 2 x 2        | 14, 4  | 14,4 - 22,8    |                        |
| `body`       | body     | 6 x 8 x 6        | 0, 9   | 0,9 - 24,23    | part rotation 90, 0, 0 |
| `right_leg`  | rightLeg | 3 x 5 x 3        | 26, 0  | 26,0 - 38,8    |                        |
| `left_leg`   | leftLeg  | 3 x 5 x 3        | 26, 0  | 26,0 - 38,8    |                        |
| `right_wing` | wing     | 1 x 4 x 6        | 24, 13 | 24,13 - 38,23  |                        |
| `left_wing`  | wing     | 1 x 4 x 6        | 24, 13 | 24,13 - 38,23  |                        |

### spider

Texture 64 x 32, animation `none`. Textures: `entity/spider/spider.png`, `entity/spider/cave_spider.png`, `entity/spider_eyes.png`.

| Part                     | Role | Size (w x h x d) | UV    | Texture region | Notes                         |
| ------------------------ | ---- | ---------------- | ----- | -------------- | ----------------------------- |
| `head`                   | head | 8 x 8 x 8        | 32, 4 | 32,4 - 64,20   |                               |
| `neck`                   | body | 6 x 6 x 6        | 0, 0  | 0,0 - 24,12    |                               |
| `abdomen`                |      | 10 x 8 x 12      | 0, 12 | 0,12 - 44,32   |                               |
| `right_hind_leg`         |      | 16 x 2 x 2       | 18, 0 | 18,0 - 54,4    | part rotation 0, -45, 45      |
| `left_hind_leg`          |      | 16 x 2 x 2       | 18, 0 | 18,0 - 54,4    | part rotation 0, 45, -45      |
| `right_middle_hind_leg`  |      | 16 x 2 x 2       | 18, 0 | 18,0 - 54,4    | part rotation 0, -22.5, 33.3  |
| `left_middle_hind_leg`   |      | 16 x 2 x 2       | 18, 0 | 18,0 - 54,4    | part rotation 0, 22.5, -33.3  |
| `right_middle_front_leg` |      | 16 x 2 x 2       | 18, 0 | 18,0 - 54,4    | part rotation 0, 22.5, 33.3   |
| `left_middle_front_leg`  |      | 16 x 2 x 2       | 18, 0 | 18,0 - 54,4    | part rotation 0, -22.5, -33.3 |
| `right_front_leg`        |      | 16 x 2 x 2       | 18, 0 | 18,0 - 54,4    | part rotation 0, 45, 45       |
| `left_front_leg`         |      | 16 x 2 x 2       | 18, 0 | 18,0 - 54,4    | part rotation 0, -45, -45     |

### enderman

Texture 64 x 32, animation `biped`. Textures: `entity/enderman/*.png`.

| Part        | Role     | Size (w x h x d) | UV     | Texture region | Notes        |
| ----------- | -------- | ---------------- | ------ | -------------- | ------------ |
| `head`      | head     | 8 x 8 x 8        | 0, 0   | 0,0 - 32,16    |              |
|             |          | 8 x 8 x 8        | 0, 16  | 0,16 - 32,32   | inflate -0.5 |
| `body`      | body     | 8 x 12 x 4       | 32, 16 | 32,16 - 56,32  |              |
| `right_arm` | rightArm | 2 x 30 x 2       | 56, 0  | 56,0 - 64,32   |              |
| `left_arm`  | leftArm  | 2 x 30 x 2       | 56, 0  | 56,0 - 64,32   | mirror       |
| `right_leg` | rightLeg | 2 x 30 x 2       | 56, 0  | 56,0 - 64,32   |              |
| `left_leg`  | leftLeg  | 2 x 30 x 2       | 56, 0  | 56,0 - 64,32   | mirror       |

### villager

Texture 64 x 64, animation `biped`. Textures: `entity/villager/**/*.png`.

| Part           | Role     | Size (w x h x d) | UV     | Texture region | Notes                       |
| -------------- | -------- | ---------------- | ------ | -------------- | --------------------------- |
| `head`         | head     | 8 x 10 x 8       | 0, 0   | 0,0 - 32,18    |                             |
|                |          | 8 x 10 x 8       | 32, 0  | 32,0 - 64,18   | inflate 0.51                |
|                |          | 2 x 4 x 2        | 24, 0  | 24,0 - 32,6    |                             |
| `head/hat_rim` |          | 16 x 16 x 1      | 30, 47 | 30,47 - 64,64  | part rotation -90, 0, 0     |
| `body`         | body     | 8 x 12 x 6       | 16, 20 | 16,20 - 44,38  |                             |
|                |          | 8 x 20 x 6       | 0, 38  | 0,38 - 28,64   | inflate 0.5                 |
| `arms`         |          | 4 x 8 x 4        | 44, 22 | 44,22 - 60,34  | part rotation -42.972, 0, 0 |
|                |          | 4 x 8 x 4        | 44, 22 | 44,22 - 60,34  | mirror                      |
|                |          | 8 x 4 x 4        | 40, 38 | 40,38 - 64,46  |                             |
| `right_leg`    | rightLeg | 4 x 12 x 4       | 0, 22  | 0,22 - 16,38   |                             |
| `left_leg`     | leftLeg  | 4 x 12 x 4       | 0, 22  | 0,22 - 16,38   | mirror                      |

### wolf

Texture 64 x 32, animation `quadruped`. Textures: `entity/wolf/*.png`.

| Part              | Role          | Size (w x h x d) | UV     | Texture region | Notes                  |
| ----------------- | ------------- | ---------------- | ------ | -------------- | ---------------------- |
| `head`            | head          | 6 x 6 x 4        | 0, 0   | 0,0 - 20,10    |                        |
|                   |               | 2 x 2 x 1        | 16, 14 | 16,14 - 22,17  |                        |
|                   |               | 2 x 2 x 1        | 16, 14 | 16,14 - 22,17  |                        |
|                   |               | 3 x 3 x 4        | 0, 10  | 0,10 - 14,17   |                        |
| `body`            | body          | 6 x 9 x 6        | 18, 14 | 18,14 - 42,29  | part rotation 90, 0, 0 |
| `mane`            |               | 8 x 6 x 7        | 21, 0  | 21,0 - 51,13   | part rotation 90, 0, 0 |
| `right_hind_leg`  | backRightLeg  | 2 x 8 x 2        | 0, 18  | 0,18 - 8,28    |                        |
| `left_hind_leg`   | backLeftLeg   | 2 x 8 x 2        | 0, 18  | 0,18 - 8,28    |                        |
| `right_front_leg` | frontRightLeg | 2 x 8 x 2        | 0, 18  | 0,18 - 8,28    |                        |
| `left_front_leg`  | frontLeftLeg  | 2 x 8 x 2        | 0, 18  | 0,18 - 8,28    |                        |
| `tail`            | tail          | 2 x 8 x 2        | 9, 18  | 9,18 - 17,28   | part rotation 36, 0, 0 |

### cat

Texture 64 x 32, animation `quadruped`. Textures: `entity/cat/*.png`.

| Part              | Role          | Size (w x h x d) | UV    | Texture region | Notes                      |
| ----------------- | ------------- | ---------------- | ----- | -------------- | -------------------------- |
| `head`            | head          | 5 x 4 x 5        | 0, 0  | 0,0 - 20,9     |                            |
|                   |               | 3 x 2 x 2        | 0, 24 | 0,24 - 10,28   |                            |
|                   |               | 1 x 1 x 2        | 0, 10 | 0,10 - 6,13    |                            |
|                   |               | 1 x 1 x 2        | 6, 10 | 6,10 - 12,13   |                            |
| `body`            | body          | 4 x 16 x 6       | 20, 0 | 20,0 - 40,22   | part rotation 90, 0, 0     |
| `tail1`           |               | 1 x 8 x 1        | 0, 15 | 0,15 - 4,24    | part rotation 51.566, 0, 0 |
| `tail2`           |               | 1 x 8 x 1        | 4, 15 | 4,15 - 8,24    | part rotation 99, 0, 0     |
| `right_hind_leg`  | backRightLeg  | 2 x 6 x 2        | 8, 13 | 8,13 - 16,21   |                            |
| `left_hind_leg`   | backLeftLeg   | 2 x 6 x 2        | 8, 13 | 8,13 - 16,21   |                            |
| `right_front_leg` | frontRightLeg | 2 x 10 x 2       | 40, 0 | 40,0 - 48,12   |                            |
| `left_front_leg`  | frontLeftLeg  | 2 x 10 x 2       | 40, 0 | 40,0 - 48,12   |                            |

### 26.3 additions

Checked with `scripts/entity-uv-overlay.mjs` against the 26.3 textures; positions and pivots are in the JSON files.

| Definition     | Texture | Textures                                                                             | Notes                                                                                  |
| -------------- | ------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `horse`        | 64 x 64 | `entity/horse/horse_*.png` (coats, markings, skeleton, zombie), horse armor, saddles | body 10x10x22 `uv(0,32)`, neck/head/mouth/mane/ears tilted 30 degrees, legs 4x11x4     |
| `donkey`       | 64 x 64 | `entity/horse/{donkey,mule}.png`, donkey and mule saddles                            | horse geometry with long ears 2x7x1 `uv(0,12)`; chests not modeled                     |
| `cow_variants` | 64 x 64 | `entity/cow/cow_{cold,temperate,warm}.png`, `mooshroom_{red,brown}.png`              | cow geometry plus muzzle 6x3x1 `uv(1,33)` and fur layer `uv(20,32)`; horns not modeled |
| `pig_variants` | 64 x 64 | `entity/pig/pig_{cold,temperate,warm}.png`, `equipment/pig_saddle/*.png`             | pig geometry plus the cold pig's fur layer `uv(28,32)` (inflate 0.5)                   |
| `elytra`       | 64 x 32 | `entity/equipment/wings/*.png`                                                       | two wings 10x20x2 `uv(22,0)`, inflate 1, tilted 15 degrees out                         |

Also extended: `chicken` (`chicken_{cold,temperate,warm}.png`), `sheep_wool` (`sheep_wool.png`,
`sheep_wool_undercoat.png`), `wolf` (wolf armor `equipment/wolf_body/*.png`).

## Visual checks

Numbers are tested; orientation still needs eyes. Check first:

1. **Rotation order** on the spider: legs must splay sideways and slope down to the ground, hind legs angled back and
   front legs angled forward. Wrong order (`'XYZ'` instead of `'ZYX'`) pushes the legs 2 px into the ground.
2. **Lying bodies**: pig belly pattern underneath, curly tail drawing on the rear face; cat white belly stripe
   underneath; cow udder box under the rear half of the belly.
3. **Mirroring**: on the zombie, the left arm and leg show the right limb's texture flipped (outer side out).
4. **Right / left**: on a player skin, the right arm (`uv(40, 16)`) is on the model's right, which is the viewer's left
   when looking at its face.
5. **Overlays**: hat, jacket, sleeves and pants float 0.25 to 0.5 px above the base boxes with transparent pixels
   cut out.
6. **Villager**: arms crossed in front of the chest (tilted forward about 43 degrees), nose on the face, hat rim (only
   painted on profession textures) flat around the head at forehead height.
