# Architecture

Blocksmith Studio is an Electron app with a Vue 3 renderer. This document describes what exists in the codebase
today; [PLAN.md](../PLAN.md) describes where it is going.

## Processes

```
+---------------------------+        contextBridge         +-------------------------------+
| MAIN (Node, privileged)   | <--------------------------> | RENDERER (Vue 3, sandboxed)   |
|  index.ts      lifecycle  |   window.blocksmith          |  App shell, tabs, settings    |
|  window.ts     windows    |   .invoke(channel, payload)  |  Pinia stores, vue-i18n       |
|  security*.ts  hardening  |   .on(event, listener)       |  Naive UI components          |
|  ipc/          handlers   |                              |  No Node.js, no network       |
|  services/     settings,  |        PRELOAD               |                               |
|                updater    |  whitelists channels only    |                               |
+---------------------------+                              +-------------------------------+
```

- **Main** (`src/main/`) owns the file system, settings, updates and (later) packs, vanilla assets and AI providers.
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

## Settings

`src/main/services/settings.ts` stores `settings.json` in Electron's `userData` folder. The schema lives in
`src/shared/model/settings.ts` (language defaults to English, theme defaults to system). Writes are atomic, and a
corrupted file is backed up as `settings.json.bak` before falling back to defaults. API keys will never be stored
here; they will use `safeStorage` in a separate encrypted file (milestone M3).

`BLOCKSMITH_USER_DATA` overrides the user data folder (used by the E2E tests).

## Renderer

- `main.ts` loads settings and updater status from main before mounting, so the first paint uses the right language and theme.
- `App.vue` wraps everything in Naive UI's config provider (theme, locale) and keeps vue-i18n in sync with settings.
- `stores/tabs.ts` manages workspace tabs: a permanent home tab now, one tab per open pack from M1.
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
scripts/       release tooling (CalVer)
docs/          project documentation
build/         icons and macOS entitlements used by electron-builder
resources/     runtime resources shipped with the app
```
