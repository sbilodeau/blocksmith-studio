# Changelog

All notable changes to this project are documented here. Versions follow CalVer `yy.ww.fix`
(ISO week-year, ISO week, fix number within the week).

## Unreleased

### M6 - Creation agent

- Creation agent for the whole pack: on the pack overview, **Ask the AI (whole pack)** and describe the pack you
  want, in French or English ("fais un pack de feu", "make every ore glow red"). It proposes a style brief (theme,
  palette, rules), category-by-category operations (`apply_to_all` on categories, folders or name patterns) and a
  new pack name or description
- Plans are reviewed step by step: what each step covers (categories, number of textures) with a few sample
  textures before and after. Each applied step is its own history entry (checkpoint), so the last steps can be
  undone without losing the others; **Stop after this step** halts a long plan
- Works on empty packs too: the agent starts from Minecraft's textures ("un squelette en glace" finds the skeleton
  textures) and adds the transformed ones to the pack
- The creation agent's requests are logged in the shared style brief, like the other agents', so the editor and
  navigation agents know what was done
- FR/EN evaluation: 6 creation cases (42 cases in total)

### App

- The Blocksmith anvil icon now shows in the macOS Dock (and the Windows/Linux taskbar) when running from source
  (`npm run dev`), instead of the Electron icon

### Export

- Exported file names say what they are: `<name>-<version>-resource-pack.zip`, and the dialog says to install it
  from Options > Resource Packs (a resource pack dropped on a world's Data Packs screen shows "made for an older
  version"). Data pack export is built and checked in the real games but stays hidden until data pack editing
  (M10)
- New export option **Also accept newer Minecraft versions (snapshots)**: the exported pack is listed as
  compatible by newer versions such as 26.4 snapshots (format 103) instead of "made for an older version". Pack
  formats were re-checked against the 26.3 jar, the Minecraft Wiki and the game code: 26.3 is format 97.1 and the
  app's `min_format` / `max_format` values are correct for it
- pack.mcmeta for 1.21.9+ targets now reads like a hand-written file: for 26.3,
  `"pack_format": 97, "min_format": [97, 0], "max_format": [97, 1]`, with number arrays on one line
- A Minecraft folder or jar added by hand in Settings now wins over the same version found in a launcher
  folder
- The export version list only shows versions the pack can really be exported to: the pack's version and newer
  snapshots (no more greyed-out entries)
- New test: every export is loaded by the game's own pack code from your real Minecraft jars (26.3 and
  26.4-snapshot-8 checked: all 28 exports rated as expected)
- **26.4-snapshot-8** is now in the export version list. The zip gets the snapshot's format (103.0); textures are
  exported as they are. Snapshots are export targets only: new packs still use the latest release (26.3)

### M5 - Navigation agent and bulk operations

- Navigation agent next to the grid: select textures, click **Ask the AI** and ask for a change in French or
  English ("mets tout plus rouge", "darken only the ores"); color and transform operations apply to the whole
  selection or to the textures the agent names. Vision models see the selection as numbered contact sheets
- Plans over many textures are reviewed texture by texture: before and after for each changed texture, with a
  checkbox per texture and per step; applying writes one change
- **Edit selection...** in the grid applies the same operations without AI: hue, saturation, brightness, replace
  a color, apply a palette (or the style brief palette), outline, flip and rotate, chained in order. Animated
  textures are changed frame by frame. The work runs in a background thread with a progress bar
- **History** button in the pack header: undo or redo any saved change (bulk edits and AI plans included) without
  opening the editor
- The FR/EN model test now covers the navigation agent too (72 phrases, 18 in the quick test)
- The texture grid keeps its scroll position when you close the editor, and shows the texture you were editing
- `AGENTS.md` explains the codebase conventions to AI coding agents

### M4 - OpenAI-compatible providers and AI settings

- New providers: OpenAI, OpenRouter (many models with one key) and any OpenAI-compatible server (vLLM, LM Studio,
  Groq, DeepSeek...), next to Ollama Cloud and a local Ollama; pick a preset in Settings > AI > "Add a provider",
  edit its name, URL and extra headers at any time
- Streaming answers, tool calls, images and reasoning work the same with every provider; the reasoning level maps
  to what each server understands
- Prices: from OpenRouter, from a small built-in table for well-known OpenAI models (shown as "estimated"), or your
  own; the model picker shows `$` / `$$` / `$$$` and each AI answer shows its cost when the price is known
- Settings > AI > Models lists every model with what it can do and its price; adjust a model when its provider gets
  its capabilities wrong or gives no price, change the cost tier limits, or also offer models without tools
- Default model, reasoning, round trips and image mode for each agent (navigation and creation are ready for
  their milestones)
- "Test models" compares several models side by side (French and English scores, gap, latency, cost) and copies a
  Markdown report; `npm run test:ai` does the same from the command line with OpenAI and OpenRouter keys too

### M3b - Entity models read from the Minecraft jar

- The 3D preview reads every entity model from your own Minecraft jar (26.1 and later): 361 models in 26.3,
  including all baby mobs, block entities (such as chests, banners, the conduit and the decorated pot) and new mobs, exact and
  up to date with each version; nothing from Mojang is bundled
- A table maps 708 of the 743 entity textures of 26.3 to their model; the preview shows a "game model" tag when the
  model comes from your game files
- Older versions keep the built-in models; textures without a model keep the flat view with its notice
- `npm run test:real-jar` checks the extraction and the table against your local jar (never in CI)
- The editor AI receives the 3D model layout of the open texture (which rectangle is the head front, the left leg,
  the top of the block...), so changes like "give it red eyes" land on the right pixels and on every face

### M3 - Editor AI agent (MVP complete)

- AI tab in the editor: describe a change in French or English, follow the streamed answer, the model's reasoning
  and its tool calls, with token usage per request; Stop at any time; one conversation per pack tab that follows
  you from one texture to the next
- Plans instead of edits: every change is a step with a localized description ("Rotation 90° antihoraire") and a
  before/after preview; apply all, some or none; the result is one undoable edit in the editor
- 21 tools for the model: rotate, flip, shift, resize, set_pixels, lines, rectangles, fill, erase, replace color,
  palette, hue, saturation, brightness, outline, reading pixels, palette, the vanilla texture and the style brief
- Style brief per pack (theme, palette, rules, decisions, request log), editable in a side panel; agents read it and
  propose changes as plan steps
- Ollama Cloud provider (native API: streaming, tools, images, thinking, model capabilities); self-hosted Ollama on
  localhost without a key; API keys encrypted with the system keychain, never sent to the renderer
- 3D preview matches 26.3 textures: new models for horses, donkeys and mules (with horse armor and saddles), elytra,
  26.3 cow and pig variants (64 x 64, with the cold fur layer), wolf armor; new chicken and sheep wool paths; a model
  whose layout does not fit the texture size, and baby mob textures, now use the flat view instead of a wrong render
- Reasoning level (off, low, medium, high) as a default in Settings and per tab in the AI panel
- Settings > AI: providers, keys, connection test, default model and options for the editor agent, and
  "Test a model" (quick or full FR/EN evaluation)
- FR/EN evaluation suite (60 phrases), `npm run test:ai`, and a CI job on pull requests that touch AI code

### M2b - Live 3D preview

- 3D panel in the editor (3D button or key 3, resizable): updates on every stroke, orbit/zoom/pan, preset views,
  auto-rotate, floor grid, in-game or studio lighting, backgrounds
- Blocks shown on their real model resolved from vanilla and pack blockstates/models (parents, texture variables,
  element rotation, uv rotation, tints); about 96% of 1.21.4 block textures resolve to a real model, the rest use a
  cube
- Items shown as an extruded sprite; entities shown on built-in geometry for 20 definitions (zombie, husk, drowned,
  skeleton family, player wide/slim, armor stand, armor layers, creeper, pig, cow, sheep, chicken, spider, enderman,
  villager, wolf, cat) with a walk animation
- Animated textures play with their .png.mcmeta timing; linked hover between the 2D canvas and the 3D model

### M2 - Pixel editor

- 1:1 editor in the pack tab: pencil, eraser, paint bucket (tolerance, contiguous), eyedropper, line, rectangle
  (outline or filled), selection with move, copy, cut, paste and delete
- Mirror painting, rotate 90° and flip for the selection or the whole texture, integer zoom around the cursor,
  scroll/space-drag panning, pixel grid, frame guides for animated strips
- Color pickers with alpha, texture palette, recent colors, keyboard shortcuts
- Unsaved edits with undo/redo (minimal patches), saved pack history with undo/redo that refuses to overwrite
  files changed outside the app
- Compare with vanilla side by side or hold C, revert to vanilla, previous/next texture, unsaved-changes prompt
- Shared image core (`src/shared/image`): transforms, drawing, flood fill, palette, color adjustments, patches,
  exact PNG decode/encode for every PNG color type
- Fix: invisible Naive UI spinners no longer block clicks

### M1 - Vanilla assets, packs, tabs and browsing

- Minecraft detection (official launcher, Prism, MultiMC, Modrinth App, CurseForge) plus folders added by hand
- Vanilla textures extracted from a local jar or downloaded from Mojang (opt-in), SHA1-verified, in a worker thread
- Version table for Minecraft 1.21 to 26.3 with a rolling 24-month support window and pack.mcmeta generation
  (`pack_format` up to 1.21.8, `min_format`/`max_format` from 1.21.9)
- Workspace of packs: create (vanilla or empty base), import .zip (with safety limits), delete to trash, show folder
- One tab per pack, category overview and sidebar (12 categories, editable mapping), texture grid with pixelated
  thumbnails, search, changed/vanilla filter, zoom, multi-selection and modified/added badges
- Export to a ready-to-use .zip with only changed files, regenerated pack.mcmeta and validation warnings
- Read-only `bs-asset://` protocol for thumbnails
- Fix: clicking the Packs tab from Settings now returns to the pack list

### M0 - Foundation and delivery pipeline

- Electron + Vue 3 + TypeScript app scaffold (electron-vite), Naive UI, Pinia, vue-router
- Security baseline: sandboxed renderer with context isolation, strict CSP, whitelisted and validated IPC,
  navigation/new-window/permission blocking
- App shell with tab bar and Settings screen: language (English default, French), theme (system, light, dark),
  automatic update checks, version and platform info
- English and French translations with a lint rule forbidding hard-coded UI text
- Settings persisted in the user data folder with atomic writes and corruption recovery
- Unit, integration, component (Vitest) and end-to-end (Playwright) tests
- Original pixel-art app icon (anvil forging a glowing block)
