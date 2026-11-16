# AGENTS.md

Instructions for AI coding agents (Claude Code, Codex, Cursor and others) working in this repository. Humans
should read [CONTRIBUTING.md](CONTRIBUTING.md) first; this file repeats its rules and adds what an agent needs.

## The project

Blocksmith Studio is an Electron + Vue 3 + TypeScript desktop app for creating Minecraft Java resource packs: a
pixel editor, a live 3D preview and AI agents that only propose changes the user reviews. MIT licensed.

- [PLAN.md](PLAN.md) is the source of truth for scope, architecture and milestones (section 12). Read the
  relevant section before changing behavior, and update it when a decision changes.
- `docs/` explains each subsystem (start with [docs/architecture.md](docs/architecture.md)).
- Work goes one milestone at a time on a branch `m<N>-<name>`, merged through a pull request once CI is green.

## Commands

| Command                    | What it does                                                          |
| -------------------------- | --------------------------------------------------------------------- |
| `npm run dev`              | Runs the app with hot reload                                          |
| `npm run lint`             | ESLint, including the no-raw-text i18n rule                           |
| `npm run typecheck`        | `tsc` for main, preload and shared; `vue-tsc` for the renderer        |
| `npm test`                 | Vitest: unit, integration and component tests                         |
| `npm run test:e2e`         | Builds, then runs Playwright against the real Electron app            |
| `npm run format`           | Prettier (single quotes, no semicolons, 100 columns)                  |
| `npm run test:ai`          | Live FR/EN model evaluation; skipped without a provider key           |
| `npm run test:real-jar`    | Checks against a local Minecraft jar; skipped without one             |

Before you call a change done, run `npm run lint && npm run typecheck && npm test`. Also run `npm run test:e2e`
when you touched the UI, IPC or main-process wiring.

## Layout

| Path                           | Contents                                                                  |
| ------------------------------ | ------------------------------------------------------------------------- |
| `src/main/`                    | Main process: services (packs, vanilla, history, AI, bulk), IPC handlers  |
| `src/preload/`                 | `window.blocksmith` bridge: `invoke` and `on`, whitelisted channels only  |
| `src/renderer/`                | Vue app: views, components, Pinia stores (one pack store per tab)         |
| `src/shared/`                  | Pure TypeScript used everywhere: models, zod schemas, image core, tools   |
| `src/shared/ipc/`              | `channels.ts` (whitelist) and `contract.ts` (input schemas, output types) |
| `src/shared/ai/tools/`         | AI tool registry: zod schema, description, `describe()`, `execute()`      |
| `src/shared/locales/`          | `en.json` and `fr.json` (same keys)                                       |
| `resources/data/`              | Hand-maintained data: versions, categories, entity layers, prices, evals  |
| `tests/`                       | `unit/`, `integration/`, `component/`, `e2e/`, `ai-eval/`, `real-jar/`    |
| `tests/fixtures/`              | Synthetic jar builder, recorded provider streams, fake HTTP server        |

## Rules that must not be broken

- **No Mojang assets in the repository.** Vanilla textures, models and jars are read from the user's installation
  at runtime. Tests use synthetic fixtures (`scripts/make-fixture-jar.mjs`, `scripts/lib/`).
- **Renderer security.** The renderer is sandboxed, has no Node.js and no network (CSP `connect-src 'self'`). Every
  new main-process feature is a domain-specific IPC channel, never a generic "read this path" channel. Main
  validates every payload with zod and re-checks every path stays inside the pack.
- **API keys never leave main.** They are encrypted with `safeStorage`. The renderer only gets `hasKey`. Never log
  a key or put one in an error.
- **The AI never writes files.** Tools run on in-memory drafts and produce a proposal. Only the user's apply
  writes, as one undoable history entry (`history.apply` / `textures.saveMany`).
- **No hard-coded UI text.** Every visible string goes through vue-i18n. Add the key to both `en.json` and
  `fr.json`; a test checks that the keys and placeholders match. French UI text addresses the user as "vous".
- **No real network in tests.** Provider adapters and E2E specs use the local fake server
  (`tests/fixtures/ai/server.ts`), and the agent runtime uses the scripted fake adapter
  (`tests/unit/ai-agent-fakes.ts`). Only `tests/ai-eval/` and the live provider test call real services, and only
  when a key is set.

## How to

- **Add an IPC channel:** add its name to `INVOKE_CHANNELS` in `src/shared/ipc/channels.ts`, its zod input to
  `inputSchemas` and its output type to `InvokeOutputs` in `contract.ts`, then register it with `handle()` in a
  `src/main/ipc/*-handlers.ts` file. The renderer calls it through `call()` in `src/renderer/services/ipc.ts`.
  Payloads must be plain data: wrap reactive objects with `toPlain()`.
- **Add an AI tool:** define it with `defineTool` in `src/shared/ai/tools/`. Give it a zod schema, an English
  description with French and English example phrases, `describe()` returning an `ops.*` i18n key, and an
  `execute()` that never mutates its input. Add the `ops.*` strings to both locales, an evaluation case in
  `resources/data/ai-eval/phrases.json`, and unit tests with exact pixel assertions.
- **Change data tables:** `resources/data/*.json` files are validated by zod at load time and covered by tests.
  Keep each table's `description` accurate.
- **Electron APIs:** keep the logic in pure functions or inject dependencies (see `src/main/security-policy.ts`
  and `src/main/services/updater.ts`) so it can be tested without Electron.
- **Long work in main:** CPU-heavy batches run in a worker thread loaded with electron-vite's `?modulePath`
  import (see `src/main/services/vanilla/worker-runner.ts` and `src/main/services/bulk/`). They report progress
  through `job.progress`.

## Conventions

- Code, comments, file names, commits and docs are in English.
- Validate external data and IPC input with zod at the boundary. Inside, trust the types.
- Errors that reach the user are typed `AppError` codes with an `errors.<code>` i18n message.
- Tests sit next to the layer they cover. Fixtures may be checked out with CRLF line endings on Windows, so never
  split fixture text on a bare `\n\n` (normalize first).
- Markdown: Prettier skips `*.md`. Align table columns by hand in the raw source, and use "-" instead of em dashes.
- Commits: small and focused, with conventional prefixes (`feat:`, `fix:`, `test:`, `docs:`, `ci:`, `chore:`,
  `refactor:`). Do not add AI attribution trailers (`Co-Authored-By`) or "Generated with" footers.
- When a feature changes, update the matching `docs/` page, `CHANGELOG.md` (Unreleased) and, for user-facing
  changes, `README.md`.
