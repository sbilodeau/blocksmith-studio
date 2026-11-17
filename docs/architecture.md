# Architecture

Blocksmith Studio is an Electron app with a Vue 3 renderer. This document describes what exists in the codebase
today; [PLAN.md](../PLAN.md) describes where it is going.

## Processes

```
+---------------------------+        contextBridge         +-------------------------------+
| MAIN (Node, privileged) | <--------------------------> | RENDERER (Vue 3, sandboxed) |
| index.ts      lifecycle | window.blocksmith            | App shell, tabs, settings   |
| window.ts     windows   | .invoke(channel, payload)    | Pinia stores, vue-i18n      |
| security*.ts  hardening | .on(event, listener)         | Naive UI components         |
| ipc/          handlers  |                              | No Node.js, no network      |
| services/     settings, | PRELOAD                      |                             |
| updater                 | whitelists channels only     |                             |
+---------------------------+                              +-------------------------------+
```

- **Main** (`src/main/`) owns the file system, settings, updates, vanilla assets, packs, API keys and every AI provider call (see
  [ai-providers.md](ai-providers.md) and [ai-agents.md](ai-agents.md)).
- **Preload** (`src/preload/index.ts`) exposes exactly two functions on `window.blocksmith`: `invoke` and `on`.
  It rejects any channel not listed in `src/shared/ipc/channels.ts`.
- **Renderer** (`src/renderer/`) is a Vue 3 app. It never talks to the network or the disk directly.
- **Shared** (`src/shared/`) holds pure TypeScript used by all three: IPC channel names and contract, data models
  (zod schemas) and locale files. It must not import Electron or DOM APIs.

## IPC contract

`src/shared/ipc/contract.ts` is the single source of truth:

- `inputSchemas`: a zod schema per invoke channel. Main validates every payload before calling the handler.
- `InvokeOutputs` / `EventPayloads`: compile-time types for responses and events.
- Every response is a `Result<T>`: `{ ok: true, value }` or `{ ok: false, error: { code, params } }`.
  Error codes map to i18n keys `errors.<code>` in the renderer.

Adding a channel:

1. Add the name to `INVOKE_CHANNELS` (or `EVENT_CHANNELS`) in `src/shared/ipc/channels.ts`.
2. Add its input schema and output type in `src/shared/ipc/contract.ts` (TypeScript fails until both exist).
3. Register the handler in `src/main/ipc/handlers.ts` with `handle(channel, fn)`.
4. Call it from the renderer with `call(channel, payload)` from `src/renderer/services/ipc.ts`.

Channels are domain operations (`settings.update`), never generic ones ("read any file"). Paths received from the
renderer must be resolved and checked to stay inside an allowed root.

## Security model

| Measure                                    | Where                                                    |
| ------------------------------------------ | -------------------------------------------------------- |
| `contextIsolation`, `sandbox`, no Node     | `src/main/window.ts`                                     |
| Strict CSP (meta tag + response header)    | `src/main/security-policy.ts`, `electron.vite.config.ts` |
| No navigation, no new windows, no webview  | `src/main/security.ts`                                   |
| External links: https only, system browser | `src/main/security-policy.ts`                            |
| Permission requests denied                 | `src/main/security.ts`                                   |
| IPC only from the app's own frames         | `isTrustedSender` in `src/main/security-policy.ts`       |
| Payload validation with zod                | `src/main/ipc/registry.ts`                               |
| Electron fuses (no RunAsNode, ASAR only)   | `electron-builder.yml`                                   |

These are covered by `tests/unit/security-policy.test.ts`, `tests/unit/ipc-contract.test.ts` and
`tests/e2e/security.spec.ts` (which checks the running app: no `require`/`process` in the renderer, sandbox and
context isolation enabled, unknown channels refused, CSP present, remote fetch blocked).

## Main-process services

| Service        | Folder / file                     | Responsibility                                                                                    |
| -------------- | --------------------------------- | ------------------------------------------------------------------------------------------------- |
| Settings       | `src/main/services/settings.ts`   | `settings.json` in userData (see below)                                                           |
| Updater        | `src/main/services/updater.ts`    | Self-update (see [releasing.md](releasing.md))                                                    |
| Vanilla store  | `src/main/services/vanilla/`      | Launcher detection, Mojang download, jar extraction (worker thread), index                        |
| Pack service   | `src/main/services/packs/`        | Workspace, packs, texture index, categories, zip import and export                                |
| Texture edit   | `src/main/services/packs/`        | Texture read / save / revert (`textures-edit.ts`), recorded in history                            |
| Data files     | `src/main/services/packs/data.ts` | Data pack files: list (pack + vanilla), read, save, create, delete ([datapacks.md](datapacks.md)) |
| History        | `src/main/services/history/`      | Per-pack journal, content-addressed blobs, undo / redo with conflict check                        |
| Bulk           | `src/main/services/bulk/`         | Bulk operations on many textures (worker thread), see [bulk.md](bulk.md)                          |
| AI agents      | `src/main/services/ai/agent/`     | Editor and navigation agents, proposals, conversations (ai-agents.md)                             |
| Asset protocol | `src/main/protocol.ts`            | Read-only `bs-asset://` URLs for thumbnails (pack file, else vanilla file)                        |
| Job reporter   | `src/main/jobs.ts`                | Throttled `job.progress` events for long operations                                               |

Services talk to each other through the interfaces in `src/main/services/contracts.ts` (`VanillaStore`,
`JobReporter`), so each one is tested with in-memory fakes of the others. `src/main/index.ts` wires the real
implementations together with Electron (dialogs, shell, `net.fetch`).

Details: [versions.md](versions.md) (version table, support window, pack.mcmeta rules, vanilla extraction),
[packs.md](packs.md) (pack layout, texture statuses, texture editing, history, import/export rules), [categories.md](categories.md)
(category mapping), [datapacks.md](datapacks.md) (pack kinds, data files and their checks).

### History

Each pack keeps a persisted undo / redo journal in `.blocksmith/history/` (`journal.jsonl`, `state.json` with the
undo pointer, and content-addressed `blobs/<sha256>.bin`). The history service is the single entry point for
recorded file changes: `apply` snapshots, writes and records in one step (editor saves and reverts, bulk edits
and navigation-agent plans through `saveMany`; imports and merges later). Undo and redo refuse to overwrite files edited outside the app
(`history.conflict`). Operations on one pack are serialized. Format and rules: [packs.md](packs.md#history).

### Data files

| File                             | Content                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------ |
| `resources/data/versions.json`   | Java releases with pack formats; regenerate with `scripts/update-versions.mjs` |
| `resources/data/categories.json` | Default texture categories (glob rules); see categories.md                     |

Both are imported statically and bundled into the main process.

### Vanilla assets and the `bs-asset://` protocol

Vanilla textures are never bundled. The vanilla store extracts the needed folders of a client jar (local install or
Mojang download with consent), including the vanilla recipes, loot tables, tags and advancements, into
`userData/vanilla/<version>/` and writes `index.json` last. A vanilla-based pack
stores only changed and added files; everything else is read from that cache. The renderer shows thumbnails through
`bs-asset://pack/<packId>/<path>` (pack file, else vanilla) and `bs-asset://vanilla/<version>/<path>`. The protocol
only serves `.png`, `.json` and `.mcmeta` files and checks every resolved path stays inside its root. A
`thumb=64|128|256` parameter on a PNG serves a downscaled copy (first frame of a strip), made with Electron's
`nativeImage` and kept in a 64 MiB LRU cache (`src/main/thumbnails.ts`); the texture grid asks for one when the
original is more than four times the size it is shown at. See [performance.md](performance.md).

## Settings

`src/main/services/settings.ts` stores `settings.json` in Electron's `userData` folder. The schema lives in
`src/shared/model/settings.ts` (language defaults to English, theme defaults to system). Writes are atomic, and a
corrupted file is backed up as `settings.json.bak` before falling back to defaults. API keys will never be stored
here; they will use `safeStorage` in a separate encrypted file (milestone M3).

`BLOCKSMITH_USER_DATA` overrides the user data folder (used by the E2E tests).

## Renderer

- `main.ts` loads settings and updater status from main before mounting, so the first paint uses the right language and theme.
- `App.vue` wraps everything in Naive UI's config provider (theme, locale) and keeps vue-i18n in sync with settings.
- `stores/tabs.ts` manages workspace tabs: a permanent home tab plus one tab per open pack.
- `stores/pack.ts` creates one Pinia store per open pack (`pack/<id>`), holding its textures, categories and view
  state (category, search, status filter, zoom, selection). It is disposed when the tab closes. The texture list and
  the selection are shallow refs, replaced on change and never edited in place.
- `components/pack/TextureGrid.vue` is a virtual grid: tiles have a fixed size per zoom level
  (`components/pack/grid-layout.ts`) and only the rows in view, plus three above and below, are rendered, so a pack
  of 10,000 textures keeps about a hundred tiles in the DOM.
- `stores/packs.ts` (pack list), `stores/vanilla.ts` (installs and versions), `stores/jobs.ts` (progress).
- `stores/editor.ts` creates one pixel-editor store per open pack (`editor/<packId>`); see [editor.md](editor.md).
- `src/shared/image/` is the pure image core (RGBA buffers, transforms, drawing, colors, PNG); see
  [image-core.md](image-core.md). It runs unchanged in the renderer, in main and in tests.
- `router/` uses hash history (works with `file://`).

## Updates

See [releasing.md](releasing.md) for the release workflow and how updates behave on each platform.

## Folder layout

```
src/
  main/        Electron main process (lifecycle, windows, security, IPC handlers, services)
  preload/     contextBridge script and global window typings
  shared/      pure TS shared by all processes: ipc/, model/, locales/
  renderer/    Vue app: components/, views/, stores/, composables/, router/, services/, styles/
tests/
  unit/  integration/  component/  e2e/
scripts/       CalVer, version table generator, synthetic fixture jar
docs/          project documentation
build/         icons and macOS entitlements used by electron-builder
resources/     runtime resources: icon, data/versions.json, data/categories.json
```
