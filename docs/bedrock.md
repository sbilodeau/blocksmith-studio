# Bedrock Edition: investigation note

PLAN M11 asks for an investigation of Bedrock support, not an implementation. This page lists what differs from
Java Edition, where vanilla assets could come from, what support would take in Blocksmith Studio, and a
recommendation. Nothing here is built yet.

## How Bedrock resource packs differ

| Topic           | Java Edition (what the app does today)                    | Bedrock Edition                                                                                        |
| --------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Metadata        | `pack.mcmeta` with a pack format number per version       | `manifest.json`: header (name, description, UUID, version, `min_engine_version`) and modules           |
| Pack identity   | None (the folder or zip name)                             | Two UUIDs (header and `resources` module) that must stay the same across updates of the pack           |
| Version target  | Pack format number (`pack_format` / `min_format`)         | `min_engine_version` (the oldest game version the pack was written for); no format table to follow     |
| File            | `.zip`                                                    | `.mcpack` (a zip); several packs together in an `.mcaddon`                                             |
| Icon            | `pack.png`                                                | `pack_icon.png`                                                                                        |
| Texture folders | `assets/<ns>/textures/block/`, `item/`, `entity/`         | `textures/blocks/`, `textures/items/`, `textures/entity/` (no namespaces)                              |
| Texture names   | Java names (`block/oak_log.png`, `block/grass_block_top`) | Often different (`blocks/log_oak.png`, `blocks/grass_top.png`); many one-to-one, many renamed or split |
| Texture atlases | Built by the game from the model files                    | `textures/terrain_texture.json` and `item_texture.json` map short names to paths (needed for new ones) |
| Image formats   | PNG                                                       | PNG and TGA (some vanilla textures are TGA); optional texture sets for PBR / ray tracing               |
| Animations      | `.png.mcmeta` next to the texture                         | `textures/flipbook_textures.json` for block textures; entity animations are separate files             |
| Block models    | `blockstates/` and `models/` JSON                         | Mostly built into the game; custom geometry belongs to add-ons, not texture packs                      |
| Entity models   | In the Java code (the app reads them from the jar)        | Shipped in the vanilla resource pack as geometry JSON (`models/entity/*.geo.json`)                     |
| GUI             | Sprites under `textures/gui/`                             | JSON UI definitions plus textures, organized very differently                                          |
| Languages       | `lang/*.json`                                             | `texts/*.lang` (key=value lines)                                                                       |

## Where vanilla assets could come from

Java support reads the client jar from the user's installation. Bedrock has no equivalent:

- The game is not a jar. On Windows it is a protected app package (Microsoft Store / Xbox app folders); mobile and
  console installs are not readable at all; there is no macOS client.
- Mojang publishes the whole vanilla Bedrock resource pack in the
  [bedrock-samples](https://github.com/Mojang/bedrock-samples) repository (`resource_pack/`, with the releases on
  the [releases page](https://github.com/Mojang/bedrock-samples/releases)). Its
  [license](https://www.github.com/Mojang/bedrock-samples/blob/main/LICENSE.md) is "all rights reserved", subject
  to the Minecraft EULA. That fits the app's existing rule for Java: download at runtime with the user's consent
  (like the Mojang jar download), keep it in `userData`, never bundle or commit it.

## What support would take

**Option A - export a Java pack to Bedrock (`.mcpack`).** The pack stays a Java pack; the export dialog gains a
Bedrock target.

1. A Java -> Bedrock texture path table (data file, like the migration tables): derived from vanilla Bedrock's
   `terrain_texture.json` / `item_texture.json` plus hand-written rules for renames and splits, checked by a local
   test against a downloaded bedrock-samples release.
2. `manifest.json` generation, with the two UUIDs created once and stored in `project.json` so updates replace the
   installed pack instead of adding a copy; `min_engine_version` from the export target.
3. `flipbook_textures.json` from the `.png.mcmeta` files; atlas entries for added textures; `pack_icon.png`.
4. Warnings for what does not convert: block models and blockstates, entity textures whose UV layout differs, GUI
   sprites, fonts, language files.
5. Existing converters show the approach and its limits (best effort, textures only): GeyserMC
   [PackConverter](https://github.com/GeyserMC/PackConverter) and Microsoft's guide
   [Converting Texture Packs from Java to Bedrock](https://learn.microsoft.com/en-us/minecraft/creator/documents/convertingtexturepacks).

Estimated size: one milestone, similar to M7 (multi-version export).

**Option B - native Bedrock projects.** A second pack kind with its own vanilla source (bedrock-samples download),
category mapping, texture index, preview models (the `.geo.json` geometry would make entity previews easier than on
Java), atlas and flipbook editing, `manifest.json` editing, and AI tool context. Most services take the edition as a
new parameter. Estimated size: several milestones.

## Risks

- Texture names and layouts drift between the two editions with every release; the mapping table needs upkeep like
  `versions.json` and the migration tables.
- Entity texture layouts differ for some mobs, so a straight copy can look wrong in game.
- Testing needs Bedrock assets that cannot go in the repository: synthetic fixtures for CI, plus an optional
  local-only test against a downloaded bedrock-samples release (like `npm run test:real-jar`).
- Bedrock cannot be tested in game on macOS, the main development machine.

## Recommendation

Do not start native Bedrock projects (option B). If Bedrock is wanted, plan option A as its own milestone after M11:
texture export to `.mcpack` with a mapping table, stable UUIDs and clear warnings for what does not convert. Decide
first whether the target users actually play Bedrock, since the app's main strengths (models, previews from the jar,
data packs) are Java-only.
