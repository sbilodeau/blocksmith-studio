# Changelog

All notable changes to this project are documented here. Versions follow CalVer `yy.ww.fix`
(ISO week-year, ISO week, fix number within the week).

## Unreleased

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
