# Changelog

All notable changes to this project are documented here. Versions follow CalVer `yy.ww.fix`
(ISO week-year, ISO week, fix number within the week).

## Unreleased

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
