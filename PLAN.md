# Blocksmith Studio - Implementation Plan

## Context

A desktop Electron + Vue app that creates and edits Minecraft Java resource packs (data packs later), with a pixel
editor, a live 3D preview and three AI agents (Creation, Navigation, Editor) that only propose tool calls the user
validates. The decisions below come from the planning interview (2026-11-15). The app is built one milestone at a
time; each milestone ends with a working app, green tests and updated docs, then a stop for manual testing.

Repository: `github.com/sbilodeau/blocksmith-studio` - License: MIT

---

## 0. Decisions log

| Topic             | Decision                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------- |
| Name              | **Blocksmith Studio** (no "Minecraft" in the name, per Mojang brand guidelines)                               |
| Runtime / UI      | Electron + Vue 3 + TypeScript                                                                                 |
| Platforms         | Windows (x64) and macOS (arm64 + x64). Linux builds are a free bonus, not a target                            |
| Edition           | Java first. Bedrock maybe later (out of scope for this plan)                                                  |
| Version model     | Author against the **latest release**, export down to any version released in the **last 24 months**          |
| Vanilla assets    | Never bundled. Read from the local jar (`.minecraft`, other launchers, manual pick) or downloaded from Mojang |
| Export content    | Only changed/added files (Minecraft falls back to vanilla). No redistribution of Mojang assets                |
| Pack storage      | Unzipped folder per pack in a user-chosen workspace + hidden `.blocksmith/` metadata folder                   |
| Multi-pack        | Tab-based, 1 tab = 1 pack, several open at once                                                               |
| Merge             | Priority-ordered sources + per-file conflict review, deep-merge for mergeable JSON, undoable                  |
| Data packs        | Resource packs first. Data packs in a later milestone                                                         |
| Animated textures | Strip editing with frame guides in MVP. Timeline/playback in a later milestone                                |
| UI library        | Naive UI                                                                                                      |
| AI providers      | Ollama Cloud (native API) by default, any OpenAI-compatible endpoint as an option                             |
| Releases          | Manual "Release" GitHub Actions workflow, assets on **GitHub Releases**                                       |
| Versioning        | CalVer `yy.ww.fix` (ISO week-year + ISO week, no leading zeros, fix resets weekly), e.g. `26.46.0`            |
| Code signing      | None for now. Windows self-updates. macOS: update detected, DMG downloaded and opened for the user            |
| Tests             | Unit + integration + E2E. AI FR/EN suite runs automatically when an API key is available (see 9.4)            |
| Default language  | **English** by default; French selectable in Settings (no automatic system-locale switch)                     |
| Model cost        | Model picker shows a cost tier `$` / `$$` / `$$$` when pricing is known (see 7.4)                             |
| Git / GitHub      | Repo `sbilodeau/blocksmith-studio` created and pushed first (Step 0); commits pushed as work progresses       |
| Parallel work     | Sub-agents in separate git worktrees for independent tasks within a milestone (see 12)                        |
| Live 3D preview   | three.js panel next to the editor, updates on every stroke, free orbit; blocks, items, entities (see 3.4)     |

Note on "install from GitHub package": GitHub *Packages* is a registry for npm/containers and cannot host desktop installers.
GitHub *Releases* is the standard place for installers and is what `electron-updater` reads, so we use Releases.

---

## 1. Market research - existing tools

| Tool                                                                                                 | Type            | Notable features                                                                                                                                                                                              | Gaps we fill                           |
| ---------------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| [resourcepackcreator.com](https://resourcepackcreator.com)                                           | Web app         | Pixel editor with layers, mirror, palette; live preview; 3D mob preview; animation + GIF import; GUI maker with bulk recolor; Pack Doctor; export to chosen Java version and Bedrock `.mcpack`; co-op editing | No AI, single pack, no merge, web only |
| [PackSheep](https://bitkid.itch.io/pack-sheep-studio)                                                | Windows desktop | 2D pixel editor, real-time 3D preview, import/export helpers                                                                                                                                                  | Windows only, no AI                    |
| [Nautilus Studio](https://www.curseforge.com/minecraft/mc-mods/packs-editor)                         | In-game mod     | Data + resource pack IDE, previews, syntax highlighting                                                                                                                                                       | Needs modded client                    |
| [CraftStudio](https://modrinth.com/mod/craftstudio), [Packified](https://modrinth.com/mod/packified) | In-game mods    | In-game texture/model editing, backups, ZIP export with checks                                                                                                                                                | Single version, needs mod loader       |
| [Blockbench](https://www.blockbench.net)                                                             | Desktop/web     | Reference 3D model editor with texture painting                                                                                                                                                               | Model-centric, not pack-centric        |

Features worth borrowing (scheduled in milestones): mirror painting, palette extraction, bulk recolor, a "Pack Doctor"
validator, export-time version choice, live 3D block preview, GIF import for animations.

**Our differentiators:** AI agents with a validate-before-apply plan, a shared style brief, multi-pack tabs, merging,
category browsing, and export down to older versions.

---

## 2. Technology stack

| Concern             | Choice                                                     | Why                                                                                                                  |
| ------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Runtime             | Electron (latest stable)                                   | Requested; mature `safeStorage`, `utilityProcess`, auto-update ecosystem                                             |
| Build tooling       | **electron-vite** + Vite                                   | One config for main/preload/renderer, fast HMR, first-class TS                                                       |
| Packaging           | **electron-builder**                                       | NSIS (Windows) + DMG/ZIP (macOS), native `electron-updater` integration with GitHub Releases                         |
| Updates             | **electron-updater** (GitHub provider)                     | Reads `latest.yml` / `latest-mac.yml` from Releases                                                                  |
| UI framework        | **Vue 3** (Composition API, `<script setup>`) + TypeScript | Requested                                                                                                            |
| Components          | **Naive UI**                                               | TS-first, dense desktop-style components (tabs, tree, data table, split panes), built-in dark theme                  |
| State               | **Pinia**                                                  | Official Vue store, devtools, easy per-pack store instances (one store per open tab)                                 |
| Routing             | **vue-router** (hash mode)                                 | Screens within a tab: navigator / grid / editor / settings                                                           |
| i18n                | **vue-i18n** + `@intlify/eslint-plugin-vue-i18n`           | Locale JSON files, `no-raw-text` lint rule forbids hard-coded strings, missing-key detection                         |
| Canvas rendering    | Plain **Canvas 2D** (`imageSmoothingEnabled = false`)      | Textures are tiny (16x16 to 512x512); Canvas 2D is enough and simple. WebGL only for the later 3D preview (three.js) |
| Image core          | Pure TS on `Uint8ClampedArray` RGBA buffers                | One implementation runs in renderer, main and tests; deterministic and unit-testable without a DOM                   |
| PNG codec           | **fast-png**                                               | Pure JS, works in Node and browser, keeps exact pixels (no color management surprises)                               |
| ZIP                 | **fflate**                                                 | Pure JS, fast, streaming, works in workers                                                                           |
| Schema / validation | **zod** (v4, native JSON Schema output)                    | Single source for IPC payload validation, tool parameter schemas sent to the LLM, settings files                     |
| Live 3D preview     | **three.js** (+ OrbitControls)                             | Mature WebGL lib; `NearestFilter` textures keep pixels crisp; cheap texture re-upload on every stroke                |
| Unit/integration    | **Vitest**                                                 | Vite-native, fast, works for shared/main/renderer code                                                               |
| Component tests     | **@vue/test-utils** + Vitest                               | Vue component behavior                                                                                               |
| E2E                 | **Playwright** (`_electron` API)                           | Drives the real packaged app on Windows and macOS                                                                    |
| Lint/format         | ESLint (flat config) + Prettier + `vue-tsc`                | Type safety across `.vue` files                                                                                      |
| Node version        | Node 22 LTS                                                | Matches Electron's bundled Node                                                                                      |

---

## 3. Electron architecture

### 3.1 Processes

```
+---------------------------------------------------------------------------------+
| MAIN PROCESS (Node, privileged)                                                 |
|  services/                                                                      |
|   workspace   pack CRUD on disk, file watching, atomic writes                   |
|   vanilla     .minecraft detection, Mojang download, jar extraction cache       |
|   versions    version table, support window, pack.mcmeta generation             |
|   importer    .zip import, validation                                           |
|   exporter    .zip export per target version, migration table                   |
|   merger      multi-pack merge with conflict report                             |
|   history     pack-level operation journal (bulk ops undo)                      |
|   secrets     safeStorage-encrypted API keys (never leave main)                 |
|   ai/         provider adapters, agent runtime, tool executor, eval runner      |
|   updater     electron-updater + macOS manual flow                              |
|   settings    app settings (JSON, schema-validated)                             |
|  ipc/         typed handlers, zod-validated inputs                              |
|  protocol     bs-asset:// read-only protocol for images                         |
|  workers      utilityProcess for heavy batch ops (apply_to_all, export)         |
+-------------------------------+-------------------------------------------------+
                                | contextBridge (typed, whitelisted)
+-------------------------------v-------------------------------------------------+
| PRELOAD  - exposes window.blocksmith = { invoke(channel,payload), on(event) }   |
|            Only channels listed in shared/ipc/contract.ts are allowed.          |
+-------------------------------+-------------------------------------------------+
                                |
+-------------------------------v-------------------------------------------------+
| RENDERER (Vue 3, sandboxed, no Node)                                            |
|  tabs (1 per pack) -> navigator / grid / editor ; settings ; AI panels          |
|  Holds the *open* texture buffer for live editing (fast local undo)             |
|  Uses shared/image core for interactive tools                                   |
+---------------------------------------------------------------------------------+
```

### 3.2 Security baseline (enforced and tested)

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity: true`, `webviewTag: false`.
- Strict CSP: `default-src 'self'; img-src 'self' bs-asset: data: blob:; connect-src 'self'` (no network from renderer:
  all HTTP goes through main, so API keys and provider calls never touch the renderer).
- `setWindowOpenHandler` denies everything; `will-navigate` blocked; external links go through `shell.openExternal` with an allowlist (https only).
- IPC: one contract file (`shared/ipc/contract.ts`) maps channel -> zod input schema -> output type. Preload rejects unknown
  channels; main validates every payload. No generic "read file at path" channel: every channel is a domain operation
  (`pack.readTexture(packId, texturePath)`), with paths resolved and checked to stay inside the pack root (no path traversal).
- `bs-asset://<packId>/<relpath>` and `bs-asset://vanilla/<version>/<relpath>` custom protocol: read-only, PNG/JSON only,
  path-validated. Lets grids load hundreds of thumbnails efficiently with `<img>`/`createImageBitmap` without IPC base64 overhead.
- Secrets: API keys encrypted with `safeStorage` (DPAPI on Windows, Keychain on macOS) in `userData/secrets.bin`.
  The renderer only receives `{ providerId, hasKey: boolean }`. Keys are redacted from logs and error messages.
- Electron fuses: disable `RunAsNode`, `EnableNodeCliInspectArguments`; enable `EnableCookieEncryption`, ASAR integrity.

### 3.3 IPC style

- Request/response: `invoke('pack.create', {...})` -> `Promise<Result<T, AppError>>` (errors are typed, i18n-keyed).
- Events from main: `on('ai.stream', ...)`, `on('pack.changed', ...)`, `on('job.progress', ...)`, `on('updater.status', ...)`.
- Long jobs (vanilla extraction, export, apply_to_all, merge) return a `jobId`; progress and cancellation flow through events.

### 3.4 Live 3D preview (textures, blocks, items, entities)

Goal: repaint a zombie (or a block, an item, armor) and see it live on the 3D model, rotating it in every direction.

- **Panel**: dockable/resizable panel next to the 2D editor (can also be popped out to a second window). Toggle with a toolbar button.
- **Live**: the editor's RGBA buffer is the texture source. Each stroke marks the texture dirty; on the next animation
  frame the buffer is copied into a three.js `DataTexture` (`NearestFilter`, no mipmaps, sRGB) and `needsUpdate` is set.
  No IPC and no file save involved, so latency is one frame. AI draft previews use the same path (preview the proposal in 3D).
- **Controls**: free orbit in all directions (drag), zoom (wheel/pinch), pan (right-drag), preset views (front, back, left,
  right, top, bottom, 3/4), auto-rotate toggle, reset view, background (dark / light / checker / sky), lighting toggle
  (flat "in-game" shading vs studio light), optional floor grid.
- **Linked cursor**: hovering the 3D model highlights the matching pixel on the 2D canvas, and hovering the 2D canvas
  highlights the face/pixel on the model (raycast -> UV -> pixel). Painting directly on the 3D model comes in M11.
- **Model sources**:
  - **Blocks**: real geometry from the vanilla cache: `blockstates/*.json` -> `models/block/*.json` (parent inheritance,
    `elements` boxes, per-face UVs, rotations, `tintindex` with a default biome tint for grass/leaves). Unsupported
    special renderers (chests, signs, beds, banners, shulker boxes) fall back to entity-style definitions below.
  - **Items**: flat sprite extruded 1 px deep (the in-hand look), or the item's 3D model when its definition points to block geometry.
  - **Entities**: entity geometry lives in Minecraft's Java code, not in the assets, so we ship our **own geometry
    definitions** as data files (`resources/data/entity-models/<entity>.json`: boxes, pivots, UV offsets, texture size),
    authored by us under MIT. The format is data-only so contributors can add entities without touching code.
    Starter set: humanoids (zombie, husk, drowned, skeleton, stray, player/Steve/Alex, armor stand + armor layers),
    creeper, pig, cow, sheep, chicken, spider, enderman, villager, wolf, cat. Others fall back to a flat texture view
    with labeled UV regions until a definition exists.
  - **Animated textures**: the preview plays the frames using the `.png.mcmeta` frametime.
- **Poses**: static pose by default; optional idle/walk animation for entities (simple limb swing) to check seams in motion.
- **Performance**: one shared WebGL context per window; the preview pauses when the panel is hidden or the window is unfocused.

---

## 4. Data model

All persisted JSON has a `schemaVersion` and a zod schema with migrations.

### 4.1 On-disk layout

```
<workspace>/                                  (default ~/Documents/Blocksmith Studio/)
  packs/
    fire-pack/                                (the pack folder IS a valid resource pack layout)
      pack.mcmeta
      pack.png
      assets/minecraft/textures/block/stone.png
      assets/minecraft/...                    (only files that differ from vanilla, or new files)
      .blocksmith/
        project.json                          (pack metadata, authoring version, base, categories override)
        style-brief.json                      (shared agent memory)
        conversations/<agentId>.jsonl         (one per agent, append-only)
        history/journal.jsonl                 (pack-level operations, for undo)
        history/blobs/<sha256>.png            (content-addressed previous versions, garbage-collected)
        export-profiles.json                  (saved export targets)

<userData>/                                   (Electron app.getPath('userData'))
  settings.json                               (language, theme, workspace path, providers (no keys), agent defaults)
  secrets.bin                                 (safeStorage-encrypted map providerId -> apiKey)
  vanilla/<mcVersion>/                        (extracted cache: textures, models, blockstates, items, lang, version.json)
  vanilla/<mcVersion>/index.json              (path -> sha256, size, width, height, animated)
  jars/<mcVersion>.jar                        (only for jars downloaded from Mojang)
  logs/
```

The `.blocksmith/` folder is excluded from export. Users can put a pack folder under git.

### 4.2 Core types (TypeScript, in `src/shared/model/`)

```ts
type McVersionId = string;            // "1.21.4", "26.3"
type PackId = string;                 // ULID
type TexturePath = string;            // "assets/minecraft/textures/block/stone.png" (POSIX, always)

interface Project {                   // .blocksmith/project.json
  schemaVersion: 1;
  id: PackId;
  name: string;
  description: string;                // pack.mcmeta description (plain text or JSON text component)
  authoringVersion: McVersionId;      // the vanilla version used as base/reference (latest at creation, upgradable)
  base: 'vanilla' | 'empty';
  createdAt: string; updatedAt: string;
  categoryOverrides?: CategoryRule[]; // per-pack additions to the global mapping
  defaultExportTargets: McVersionId[];
}

interface TextureEntry {              // computed index, not persisted as-is
  path: TexturePath;
  namespace: string;                  // "minecraft"
  folder: string;                     // "block", "item", "entity/zombie", "gui/sprites/hud" ...
  width: number; height: number;
  animated: boolean;                  // has .png.mcmeta with "animation"
  frameCount?: number;
  status: 'vanilla' | 'modified' | 'added';   // sha256 compared with vanilla index
  categories: CategoryId[];           // from the mapping table
}

interface CategoryRule {              // resources/data/categories.json (global default, user-editable copy in userData)
  id: CategoryId;                     // "blocks", "ores", "tools", "weapons", "armor", "food", "materials", "entities", "gui", "particles", "other"
  i18nKey: string;                    // "category.tools"
  icon: TexturePath;                  // preview tile
  include: string[];                  // globs on texture path: "textures/item/*_pickaxe.png"
  exclude?: string[];
  priority: number;                   // for "primary category" display; a texture can be in several categories
}

interface StyleBrief {                // shared memory, .blocksmith/style-brief.json
  schemaVersion: 1;
  theme: string;                      // "Fire / volcanic"
  palette: { hex: string; role?: string }[];   // "#ff6a00 - highlights"
  rules: string[];                    // "Keep vanilla silhouettes", "Outline ores with dark red"
  decisions: { at: string; by: 'user' | AgentKind; text: string }[];
  requestLog: { at: string; agent: AgentKind; summary: string }[];  // compacted, last N kept
  updatedAt: string;
}

type AgentKind = 'creation' | 'navigation' | 'editor';

interface ConversationTurn {          // one JSONL line in conversations/<agent>.jsonl
  id: string; at: string;
  role: 'user' | 'assistant' | 'tool';
  content?: string;
  thinking?: string;
  toolCalls?: { id: string; name: string; args: unknown }[];
  toolResult?: { callId: string; ok: boolean; summary: string; data?: unknown };
  attachments?: { kind: 'image'; ref: TexturePath; scale: number }[];  // references, not base64
  model: string; providerId: string;
  usage?: { inputTokens?: number; outputTokens?: number; costUsd?: number };
  proposalId?: string;
}

interface Proposal {                  // the plan shown to the user before anything is applied
  id: string; agent: AgentKind; packId: PackId;
  steps: ProposalStep[];
  status: 'pending' | 'applied' | 'partially-applied' | 'rejected';
}

interface ProposalStep {
  id: string; callId: string;
  tool: string; args: unknown;
  targets: TexturePath[];
  dependsOn: string[];                // earlier steps this one was computed on top of
  preview: { before: TexturePath | 'draft'; after: 'draft'; diffPixelCount: number }[];
  descriptionKey: string; descriptionParams: Record<string, unknown>;  // localized "Rotation 90° counterclockwise"
  accepted: boolean;                  // user toggle
}
```

### 4.3 Undo / redo

Two levels, one stack per tab (pack):

1. **Editor-local undo** (renderer, per open texture): command pattern. Each stroke or tool application stores a
   `PixelPatch { rect, before: Uint8ClampedArray, after: Uint8ClampedArray }`. Patches are memory-cheap for small textures.
   Unlimited depth while the texture is open (configurable cap). Saving a texture writes the file and records one
   journal entry (level 2) so it can still be undone after the editor closes.
2. **Pack journal** (main, persisted in `history/journal.jsonl`): each entry =
   `{ id, at, source: 'user' | 'ai' | 'merge' | 'import', label, files: [{ path, beforeBlob?: sha256, afterBlob?: sha256 }] }`.
   Undo restores the `beforeBlob` (or deletes an added file). Covers bulk AI operations (one entry per applied proposal),
   merges and imports. Blobs are content-addressed and garbage-collected when trimmed (default: keep last 200 entries).

Applied AI proposals are always one journal entry, so "undo the AI" is a single action, with a history panel listing entries.

---

## 5. Project folder structure

```
blocksmith-studio/
  .github/
    workflows/
      ci.yml                    lint, typecheck, unit, integration, e2e (win + mac), AI eval when applicable
      release.yml               manual: compute CalVer, build, publish GitHub Release
    ISSUE_TEMPLATE/ , PULL_REQUEST_TEMPLATE.md
  build/                        icons, entitlements, NSIS includes
  docs/
    architecture.md  ai-agents.md  tools-reference.md (generated)  versions.md
    categories.md  testing.md  releasing.md  contributing.md
  resources/
    data/
      versions.json             version table (generated + reviewed, see 8.4)
      migrations/               per-version-pair texture rename/remove tables
      categories.json           default category mapping
      entity-models/            our own entity geometry definitions for the 3D preview (MIT, data-only)
      ai-eval/phrases.json      FR/EN phrase -> expected tool-call cases
  scripts/
    calver.mjs                  CLI: print next yy.ww.fix from git tags (logic in lib/calver.mjs)
    update-versions.mjs         refresh versions.json from Mojang manifest + misode/mcmeta
    gen-migrations.mjs          diff two vanilla indexes -> migration table draft
    gen-tools-doc.mjs           tools-reference.md from the tool registry
    make-fixture-jar.mjs        build the synthetic test jar (no Mojang assets in repo)
  src/
    main/
      index.ts  window.ts  menu.ts  protocol.ts  security.ts  security-policy.ts (pure, tested)
      ipc/                      handlers per domain (pack, vanilla, export, ai, settings, updater)
      services/                 workspace, vanilla, versions, importer, exporter, merger, history, secrets, settings, updater
      ai/
        providers/              base.ts, ollama.ts, openai-compatible.ts, registry.ts
        agents/                 runtime.ts, prompts/{creation,navigation,editor}.ts, context-builder.ts
        tools/executor.ts       runs shared tool implementations against drafts
        eval/                   runner.ts (FR/EN suite)
      workers/                  batch.worker.ts (utilityProcess)
      i18n.ts                   main-process strings (dialogs, menus) from the same locale files
    preload/
      index.ts  global.d.ts
    shared/                     pure TS, no Electron/DOM imports (runs everywhere)
      image/                    RgbaImage, transforms, drawing, color ops, palette, png io, diff
      tools/                    tool registry: zod schemas, descriptions, describe(), execute()
      model/                    types + zod schemas (Project, StyleBrief, ...)
      versions/                 support window, pack.mcmeta builder, migration logic
      categories/               mapping engine
      ipc/                      channels.ts (names, no deps) + contract.ts (zod schemas, types)
      locales/                  en.json  fr.json (shared by renderer and main)
    renderer/
      index.html  main.ts  App.vue
      router/  stores/ (app, tabs, pack(id), editor, ai, settings)
      views/                    PackSelector, Navigator, Grid, Editor, Settings, MergeWizard, ExportDialog
      components/
        editor/                 PixelCanvas, Toolbar, Palette, LayersPanel, CompareView, HistoryPanel
        preview3d/              Preview3D, ViewControls, model builders (block, item, entity), uv-picking
        grid/                   TextureTile, SelectionBar, Filters
        ai/                     AgentPanel, ModelPicker, ThinkingPanel, ToolCallList, ProposalReview, UsageBadge
        common/
      composables/  services/ (ipc call helper)  styles/
  tests/
    unit/                       mirrors src/shared, src/main/services
    component/                  Vue components/stores with a fake preload bridge (happy-dom)
    integration/                main services against a temp workspace + fixture jar; provider adapters vs fake HTTP server
    e2e/                        Playwright Electron specs
    ai-eval/                    live FR/EN suite (skipped without API key)
    fixtures/                   synthetic jar, sample packs, recorded provider responses
  electron.vite.config.ts  electron-builder.yml  vitest.config.mts  playwright.config.ts
  package.json  tsconfig*.json  eslint.config.mjs  .prettierrc.yaml
  README.md  LICENSE (MIT)  CHANGELOG.md  PLAN.md
```

---

## 6. AI agents

### 6.1 Principles

- **The AI never touches files.** The agent runtime runs tool calls against an in-memory **draft** (copy-on-write
  texture buffers). The user reviews the resulting **Proposal** (step list + before/after previews), toggles steps,
  then applies. Only "apply" writes files, as one undoable journal entry.
- **Read tools execute immediately** (get_pixels, get_palette, get_texture, list_textures, read_style_brief): they
  don't change anything and are needed for the multi-turn loop.
- **Mutating tools execute on the draft** so the model receives the new state (pixels/image) and can continue
  (rotate, then set_pixels on the rotated result). This implements the "request 1 -> rotate -> new state -> request 2" flow.
- **Round-trip budget**: max tool-loop iterations per user request (default 6, configurable per agent), and a
  token budget per request. When reached, the agent stops and the current draft becomes the proposal.
- **Partial acceptance**: steps carry `dependsOn`. Unchecking a step that later steps depend on shows a warning;
  applying re-plays only the accepted steps on the real textures, in order, so the result stays deterministic.
- **update_style_brief** is also a proposal step (shown as a text diff), never silently applied.

### 6.2 Agent runtime loop (main process)

```
user message
  -> context-builder: system prompt + style brief + scoped context (images/grids) + trimmed conversation history
  -> provider.chat(stream)  ---> stream thinking / text / tool calls to renderer (ai.stream events)
  -> for each tool call:
        validate args with zod (invalid -> return error to model as tool result, counts toward budget)
        read tool    -> execute, return result
        mutate tool  -> execute on draft, record ProposalStep, return compact new state (grid and/or image)
  -> loop until: model ends turn | iteration budget | token budget | user presses Stop
  -> emit Proposal to renderer -> user reviews -> apply/partial/reject
  -> result ("applied 3 of 4 steps") appended to the conversation so the agent knows what happened
```

### 6.3 Agents and scopes

| Agent      | Lives at                                                                 | Context it receives                                                                              | Tools available                                                                                                    |
| ---------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Creation   | Pack level (one per tab)                                                 | Pack meta, style brief, category list + counts, small contact sheet of representative textures   | All read tools, `apply_to_all`, `update_style_brief`, `set_pack_meta`, color ops via filters, `write_json` (later) |
| Navigation | Category / selection (one per tab)                                       | Selected texture list, contact sheet(s) of the selection in batches, per-texture palette summary | Read tools, color ops, transforms, `apply_to_all` limited to the selection                                         |
| Editor     | 1:1 editor (one per tab, persists across textures while the tab is open) | Current texture: upscaled image + JSON grid; vanilla reference on request                        | All texture tools: transforms, drawing, color, read, `open_texture`, `save_texture` (as a step)                    |

The editor agent's conversation persists when the user moves from one texture to the next. Every user message is
tagged with the currently open texture, so the model knows which one "it" refers to.

### 6.4 System prompts (outline; full text lives in `src/main/ai/agents/prompts/`)

Common preamble (all agents):

```
You are a Minecraft Java Edition resource pack artist assistant inside Blocksmith Studio.
You NEVER modify files directly. You act only by calling the provided tools; every change is shown to the user
as a plan they approve. Prefer few, precise tool calls.
Coordinates: origin (0,0) is the TOP-LEFT pixel; x grows to the right, y grows downward.
Colors are hex "#RRGGBBAA" (alpha optional, default FF). Transparent = "#00000000".
Rotation: "left"/"à gauche"/"anti-horaire" = counterclockwise; "right"/"à droite"/"horaire" = clockwise.
Flip: "horizontal" mirrors left<->right; "vertical" mirrors top<->bottom.
Respect the pack STYLE BRIEF below unless the user explicitly overrides it. If the user states a lasting
preference, propose update_style_brief.
Reply in {{uiLanguage}}. If the user writes in another language, reply in the user's language.
Keep text replies short; the plan UI already describes each operation.
STYLE BRIEF:
{{styleBriefJson}}
```

- **Creation**: "Your scope is the whole pack. First establish or refine the style brief (theme, 4-12 color palette
  with roles, visual rules). Then propose bulk operations using apply_to_all with filters (category, folder, glob).
  Work category by category; do not try to redraw every texture by hand."
- **Navigation**: "Your scope is the user's current selection of N textures (given in batches). Prefer global color
  operations (hue_shift, apply_palette, replace_color, brightness, saturation) over per-pixel drawing.
  Use get_pixels only on textures you need to inspect closely."
- **Editor**: "Your scope is the open texture W x H. You receive an upscaled image with a coordinate grid and a
  palette-indexed JSON grid. Use transforms for geometry, drawing tools for detail. Stay in the texture's existing
  palette or the style brief palette. Keep Minecraft's pixel-art style: no anti-aliasing, limited colors,
  1-pixel details, consistent light from the top-left."

### 6.5 Shared memory

- `style-brief.json` is per pack: all three agents of that pack read it (injected in the system prompt, and through
  `read_style_brief`) and propose changes through `update_style_brief`. The user edits it directly in a "Style brief" side panel.
- `requestLog` stores a one-line summary of each applied proposal (generated by the app, not the model) so other agents know what was done.
  It's compacted to the last 30 entries; older ones are summarized in one line.
- Each agent keeps its own conversation (`conversations/<agent>.jsonl`). Before sending, history is trimmed to a token budget:
  old turns are replaced by a summary turn, and old images are dropped (only the latest image state is ever sent).

### 6.6 Image + grid strategy

For a texture sent to a model:

1. **Upscaled PNG** (vision models only): nearest-neighbor scaled so the long side is about 512 px (16x16 -> 32x scale), with an optional
   1-px grid and axis labels (0..W-1, 0..H-1) in a margin. The labels make it much easier for the model to give precise coordinates.
   Transparent pixels are drawn on a checkerboard.
2. **Palette-indexed JSON grid** (all models, compact):

```json
{ "w": 16, "h": 16, "origin": "top-left",
  "palette": { ".": "#00000000", "a": "#7f7f7fff", "b": "#6b6b6bff", "c": "#8f8f8fff" },
  "rows": ["aabbaacc...", "..."] }
```

   One character per pixel (up to 62 colors + transparent). Textures with more colors fall back to `[hex,...]` rows.
   A 16x16 grid costs about 350 tokens; 64x64 and larger textures send the image plus a region on request (`get_pixels` with a rect).
3. **Mode per model capability**: vision + grid (default), grid only (non-vision models), image only (user option to save tokens).
4. **Batching (navigation/creation)**: textures go in as **contact sheets** (for example a 6x6 tile atlas, each tile labeled with its index)
   plus a text table `index -> path, size, top-5 colors`. Batch size is configurable (default 36 textures per sheet, max 3 sheets
   per request). The model calls `get_pixels` on specific ones if needed. `apply_to_all` lets one call cover hundreds of
   textures without sending them.
5. After a mutating tool, the tool result returns the **new grid** (and the new image every K steps, or on request), not the whole history.

### 6.7 Tool catalog

All tools are defined once in `src/shared/tools/` using this shape:

```ts
defineTool({
  name: 'rotate',
  kind: 'mutate',                          // 'read' | 'mutate' | 'pack' | 'memory'
  scopes: ['editor', 'navigation', 'creation'],
  description: `Rotate the texture by 90, 180 or 270 degrees.
Direction: "clockwise" (right / à droite / sens horaire) or "counterclockwise" (left / à gauche / sens anti-horaire).
Examples: "tourne de 90° à gauche" -> {degrees:90,direction:"counterclockwise"};
"rotate it right" -> {degrees:90,direction:"clockwise"}; "pivote-le à l'envers" / "upside down" -> {degrees:180,...}.`,
  params: z.object({
    degrees: z.union([z.literal(90), z.literal(180), z.literal(270)]),
    direction: z.enum(['clockwise', 'counterclockwise']).default('clockwise'),
    target: TargetSchema.optional(),       // defaults to the open texture / current selection
  }),
  describe: (p, t) => t('ops.rotate', { degrees: p.degrees, direction: t(`ops.dir.${p.direction}`) }),
  execute: (ctx, p) => ctx.draft.map(img => rotate(img, p.degrees, p.direction)),
});
```

The JSON Schema sent to providers is generated from zod. `docs/tools-reference.md` is generated from the registry.

| Group     | Tools                                                                                                                                                                                                            |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transform | `rotate(degrees, direction)`, `flip(axis: horizontal\|vertical)`, `shift(dx, dy, wrap)`, `resize(width, height)` nearest-neighbor                                                                                |
| Drawing   | `set_pixels(pixels:[{x,y,color}])`, `draw_line(x1,y1,x2,y2,color)`, `draw_rect(x,y,w,h,color)`, `fill_rect(...)`, `fill(x,y,color,tolerance,contiguous)`, `erase(pixels\|rect)`                                  |
| Color     | `replace_color(from,to,tolerance)`, `apply_palette(palette, mode: nearest\|ramp)`, `hue_shift(degrees)`, `saturation(delta)`, `brightness(delta)`, `outline(color, inside\|outside)`, `shade(direction, amount)` |
| Read      | `get_pixels(rect?)`, `get_palette()`, `get_texture(path, source: pack\|vanilla, as: grid\|image)`, `list_textures(filter)`                                                                                       |
| Pack      | `open_texture(path)`, `save_texture()`, `apply_to_all(operation, filter)`, `set_pack_meta(name?, description?)`, `write_json(path, json)` (data pack milestone)                                                  |
| Memory    | `read_style_brief()`, `update_style_brief(patch)`                                                                                                                                                                |

Every color tool accepts an optional `region` (rect or mask from the current selection) and `target`.
`apply_to_all.operation` is a nested `{ tool, args }` limited to color/transform tools; `filter` = `{ categories?, folders?, glob?, selection? }`.

### 6.8 Natural-language FR/EN mapping

- Tool names and parameters are English and technical; each description includes FR and EN examples (as above).
- The plan UI never shows raw tool names: every step uses `describe()` with i18n templates, e.g.
  `ops.rotate`: EN "Rotate {degrees}° {direction}" / FR "Rotation {degrees}° {direction}" with
  `ops.dir.counterclockwise`: EN "counterclockwise" / FR "antihoraire".
- The FR/EN eval suite (`resources/data/ai-eval/phrases.json`) holds about 60 cases (30 concepts x FR + EN):

```json
{ "id": "rotate-left-90", "context": "editor", "fixture": "arrow_16.png",
  "fr": "tourne de 90 à gauche", "en": "rotate it 90 degrees to the left",
  "expect": [{ "tool": "rotate", "args": { "degrees": 90, "direction": "counterclockwise" } }] }
{ "id": "make-redder", "context": "navigation", "fixture": "stone_selection",
  "fr": "mets tout plus rouge", "en": "make everything redder",
  "expectAnyOf": [{ "tool": "hue_shift" }, { "tool": "apply_palette" }, { "tool": "replace_color" }] }
```

  Matching rules: exact tool + required args, `expectAnyOf` for open-ended requests, numeric tolerances where needed.
  The report shows per-model scores, FR vs EN accuracy gap, latency and tokens. It runs from the CLI and from Settings > AI > "Test this model".

---

## 7. AI provider layer

### 7.1 Interface

```ts
interface ProviderAdapter {
  id: string; kind: 'ollama' | 'openai-compatible';
  listModels(): Promise<ModelInfo[]>;                 // with capabilities when known
  chat(req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatEvent>;
}
interface ModelInfo { id: string; label: string; capabilities: { vision?: boolean; tools?: boolean; thinking?: boolean }; contextLength?: number; pricing?: { inPerMTok: number; outPerMTok: number; source: 'provider' | 'hint' | 'user' }; costTier?: 1 | 2 | 3 }
type ChatEvent =
  | { type: 'thinking'; delta: string }
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; id: string; name: string; args: unknown }
  | { type: 'usage'; inputTokens?: number; outputTokens?: number; costUsd?: number }
  | { type: 'done'; stopReason: 'end' | 'tool_calls' | 'length' | 'error' };
```

Normalized messages: `{ role, text?, images?: Uint8Array[] (PNG), toolCalls?, toolCallId? }`. Each adapter converts them to its own wire format.

### 7.2 API differences to handle

| Aspect             | Ollama Cloud (native, `https://ollama.com/api`)                                                | OpenAI-compatible (`/v1/chat/completions`)                                                                |
| ------------------ | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Auth               | `Authorization: Bearer <key>`                                                                  | `Authorization: Bearer <key>` (+ optional extra headers, e.g. OpenRouter `HTTP-Referer`)                  |
| Model list         | `GET /api/tags`; capabilities via `POST /api/show` (`capabilities: [tools, vision, thinking]`) | `GET /v1/models` (no capabilities); OpenRouter adds `supported_parameters` + `input_modalities` + pricing |
| Streaming          | NDJSON lines                                                                                   | SSE `data:` lines, `[DONE]`                                                                               |
| Images             | `message.images: [base64]` (no data-URL prefix)                                                | `content: [{type:'image_url', image_url:{url:'data:image/png;base64,...'}}]`                              |
| Tool definitions   | `tools: [{type:'function', function:{name, description, parameters}}]`                         | Same shape                                                                                                |
| Tool call args     | JSON **object**; ids may be missing (we synthesize ids)                                        | JSON **string**, streamed in fragments to reassemble; `tool_call_id` required on results                  |
| Tool results       | `{role:'tool', content, tool_name}`                                                            | `{role:'tool', tool_call_id, content}`                                                                    |
| Thinking           | request `think: true` (or level); response `message.thinking`                                  | Varies: `reasoning_content` (DeepSeek-style), `reasoning` (OpenRouter), absent (OpenAI chat)              |
| Usage              | `prompt_eval_count`, `eval_count` on final chunk                                               | `usage` object (needs `stream_options.include_usage`)                                                     |
| Cost               | Not returned; user-editable price table (optional)                                             | OpenRouter returns cost; others via model price table                                                     |
| Errors/rate limits | HTTP status + `error` string                                                                   | HTTP status + `error.message`, `Retry-After`                                                              |

Capabilities that can't be detected are taken from a small built-in hint table (by model-name pattern) and can be overridden per model in Settings.
Models without tool support are hidden from the agent model picker (a toggle shows them anyway; they can still chat).
Retries: exponential backoff on 429/5xx with a cap; user-visible error with i18n message.

### 7.3 Configuration

- Settings > AI providers: list of providers `{ id, kind, label, baseUrl, extraHeaders, enabled }`, with presets:
  Ollama Cloud (default), OpenAI, OpenRouter, Custom OpenAI-compatible. Key field (write-only), "Test connection", "Refresh models".
- Per-agent default model (`creation`, `navigation`, `editor`) + thinking toggle + iteration budget + image mode.
- The model picker next to every instruction box switches the model for that agent on the fly (persisted as last-used per agent per pack).
  Each entry shows capability icons (vision, tools, thinking) and the cost tier badge (7.4).

### 7.4 Model cost tier ($ / $$ / $$$)

- Pricing source, in priority order: price returned by the provider API (OpenRouter `/api/v1/models` gives per-token prices),
  then a user-entered price in Settings, then a small built-in hint table for well-known models (OpenAI etc.).
  The source is shown in the tooltip ("from provider" / "estimated" / "your price").
- Tier from the blended price per 1M tokens, `(input + 3 x output) / 4` (agent turns are output-heavy):
  `$` < $1, `$$` $1-$10, `$$$` > $10. Thresholds are editable in Settings.
- Ollama Cloud doesn't return per-token prices (it bills by subscription/usage limits), so its models show no tier
  unless you enter a price; the badge is hidden rather than guessed.
- The tooltip also shows the exact prices, and the per-request usage badge shows the cost when prices are known.

---

## 8. Vanilla import, versions, export

### 8.1 Finding vanilla jars

1. Auto-detect launcher folders:
   - Windows: `%APPDATA%\.minecraft`, plus Prism/MultiMC/CurseForge/Modrinth App instance folders.
   - macOS: `~/Library/Application Support/minecraft`, plus Prism/Modrinth/CurseForge equivalents.
   - Jar = `versions/<id>/<id>.jar` (release versions only; snapshots are ignored unless a setting enables them).
2. Manual "Select .minecraft folder" or "Select a client .jar".
3. If the needed version is missing: offer **download from Mojang** after a one-time consent dialog:
   `piston-meta.mojang.com/mc/game/version_manifest_v2.json` -> version JSON -> `downloads.client.url`, SHA1-verified,
   saved in `userData/jars/`. This works without a Minecraft install (handy for CI and new users) and the app ships no assets.

### 8.2 Extraction

- Stream-read the jar (fflate) and extract only `assets/minecraft/{textures,models,blockstates,items,atlases,font,lang/en_us.json}`, `pack.png` and
  `version.json` into `userData/vanilla/<version>/`, in a worker with progress.
- Build `index.json`: path -> sha256, dimensions, animation flag (from `.png.mcmeta`).
- `version.json` inside the client jar contains `pack_version.resource` and `pack_version.data`, which is the **authoritative**
  pack format for that version. The app cross-checks it against `versions.json`.

### 8.3 Pack creation and import

- **New pack**: name, description, base (vanilla extracted or empty), authoring version = latest supported release that's available
  (or downloadable). Creates the folder, `pack.mcmeta`, a default `pack.png` (generated from a vanilla block plus the pack initial), and `.blocksmith/`.
  A vanilla base creates no copies: textures are shown from the vanilla cache until edited (copy-on-write). This is what makes "modified vs vanilla" free.
- **Import .zip**: validate (`pack.mcmeta` at root or one folder deep, zip-slip protection, size limits), read its pack format,
  map it to a Minecraft version, run the **upgrade migration** to the authoring version if older, unzip into a new pack folder,
  and report textures that are unknown or renamed. Files identical to vanilla are dropped (keeps only real changes).

### 8.4 Version table and support window

`resources/data/versions.json` (generated by `scripts/update-versions.mjs`, reviewed in a PR, and cross-checked against each jar's `version.json`):

```json
{ "id": "26.3", "releaseTime": "2026-...", "resourcePack": "97.0", "dataPack": "...", "mcmetaStyle": "minmax" }
```

Values from current references (verified at implementation time against the jars):

| Minecraft                     | Resource pack format | pack.mcmeta style       |
| ----------------------------- | -------------------- | ----------------------- |
| 1.21.4                        | 46                   | `pack_format`           |
| 1.21.5                        | 55                   | `pack_format`           |
| 1.21.6                        | 63                   | `pack_format`           |
| 1.21.7-1.21.8                 | 64                   | `pack_format`           |
| 1.21.9-1.21.10                | 69.0                 | `min_format/max_format` |
| 1.21.11                       | 75.0                 | `min_format/max_format` |
| 26.1-26.1.2                   | 84.0                 | `min_format/max_format` |
| 26.2                          | 88.0                 | `min_format/max_format` |
| 26.3                          | 97.x                 | `min_format/max_format` |
| 26.4-snapshot-8 (export only) | 103.0                | `min_format/max_format` |

- **Support window** is a rule, not a hard-coded list: release versions whose `releaseTime` falls within the last 24 months, plus the latest.
  As of 2026-11-15 that is 1.21.4 -> 26.3. Older versions disappear from export targets automatically as time passes.
- The Minecraft 1.21.4 baseline is convenient: item model definitions (`assets/minecraft/items/`) exist in every supported version.

### 8.5 Export

- Dialog: target version(s), file name pattern (`{name}-{mc}.zip`), option "one zip per target" (multi-target export),
  option "also accept newer Minecraft versions (snapshots)" (open `max_format`, see docs/versions.md; built after M5),
  pack type "resource pack" / "data pack" (`<name>-<version>-resource-pack.zip` / `-data-pack.zip`; a data pack gets
  only `data/` and the data pack format, see docs/packs.md; built after M5).
- Pipeline per target (in a worker):
  1. Collect pack files (exclude `.blocksmith/`, OS junk, files identical to the target version's vanilla).
  2. **Migrate down** from the authoring version to the target using `migrations/<from>__<to>.json` chains:
     `rename` (path changes), `remove` (texture doesn't exist in target -> skipped + warning), `split/merge` (rare, handled by a script hook).
  3. Generate `pack.mcmeta` for the target:
     - target < 1.21.9: `{ "pack": { "pack_format": N, "description": ... } }`
     - target >= 1.21.9: `{ "pack": { "pack_format": N, "min_format": [N, 0], "max_format": [N, minor], "description": ... } }` (plus `supported_formats` when a range spans the boundary, per the spec)
  4. Validate (the "Pack Doctor" checks: PNG valid, dimensions power-of-two/animation strips consistent, JSON parses, mcmeta schema, path case, no non-ASCII paths).
  5. Write the zip with fflate (deterministic order, fixed timestamps for reproducible output), forward slashes, `pack.mcmeta` at root.
- Report: files exported, skipped (with reason), warnings. Saved as an export profile for one-click re-export.
- Migration tables are drafted by `scripts/gen-migrations.mjs` (diff of two vanilla indexes: same hash with a new path = rename candidate)
  and then reviewed by hand. They're data files, so contributors can update them without touching code.

### 8.6 Merge ("send to pack")

- Entry points: tab context menu "Merge into...", grid selection "Send to pack > [open tab | other pack | new pack]".
- Wizard: pick sources (2+ packs/tabs) and target (existing or new), order sources by priority (top wins, like Minecraft's pack list).
- Conflict screen: for each clashing path, side-by-side thumbnails (or JSON diff) with radio "take A / take B / keep target"; bulk actions.
- Deep-merge for mergeable JSON: `lang/*.json` (key union), `sounds.json`, `atlases/*.json` (source list union), `font/*.json` (providers union).
- If sources have different authoring versions, they're migrated to the target's authoring version first.
- Applied as one journal entry in the target pack (undoable). Each source's style brief is offered as an optional merge into the target brief.

---

## 9. Testing strategy

### 9.1 Layers

| Layer       | Tool                     | What                                                                                                                                                                                                                                                                                                     | Runs                        |
| ----------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| Unit        | Vitest                   | `shared/image` (every transform/drawing/color op with exact pixel assertions), tool zod schemas + `describe()`, pack.mcmeta builder, support window, migration logic, category engine, CalVer, provider wire conversion                                                                                  | Every push, all OS          |
| Component   | Vitest + @vue/test-utils | Editor toolbar, ProposalReview toggles, grid selection, i18n rendering in both locales                                                                                                                                                                                                                   | Every push                  |
| Integration | Vitest (node env)        | Main services against a temp workspace: create/import/export/merge/undo with the **synthetic fixture jar**; provider adapters against a local fake HTTP server replaying recorded Ollama/OpenAI streams (tool calls, thinking, images, errors); agent runtime loop end-to-end with a scripted fake model | Every push, all OS          |
| E2E         | Playwright `_electron`   | Launch app, create pack, open category, edit pixel, undo, export zip and inspect it, switch language, open 2 tabs and merge, AI proposal accept/reject with the fake provider, security asserts (no `require` in renderer)                                                                               | Every push, Windows + macOS |
| AI FR/EN    | Vitest project `ai-eval` | Live phrase -> tool-call suite against a real model, score threshold (default 90% overall, and FR-EN gap <= 10 points)                                                                                                                                                                                   | See 9.4                     |
| i18n        | Vitest + ESLint          | `en.json` and `fr.json` have identical key sets; no raw text in templates (`no-raw-text` lint rule); placeholders match                                                                                                                                                                                  | Every push                  |

### 9.2 Fixture policy

No Mojang assets in the repo. `scripts/make-fixture-jar.mjs` generates a tiny synthetic jar (about 40 hand-made/generated 16x16 PNGs at real
vanilla paths, a fake `version.json` with pack versions, one animated strip, a few models/blockstates) for two fake versions,
to test detection, extraction, migration (rename/remove) and export. An optional local-only test (`npm run test:real-jar`)
runs the same suite against your real installed jar.

### 9.3 Coverage targets

`shared/image` and `shared/tools`: 95%+ lines. Main services: 80%+. Coverage is reported in CI and not enforced on the renderer UI.

### 9.4 AI FR/EN suite execution rule

- **Locally**: `npm test` includes the AI suite **if `OLLAMA_API_KEY` (or `BLOCKSMITH_EVAL_*` vars for other providers) is set** in `.env.local`;
  otherwise it's skipped with a notice. `npm run test:ai -- --model <id>` runs it on demand against any model.
- **CI**: the `ai-eval` job runs on pull requests **only when they touch AI code** (`src/main/ai/**`, `src/shared/tools/**`,
  `resources/data/ai-eval/**`, prompt files) **and** the `OLLAMA_API_KEY` secret is available (secrets aren't exposed
  to fork PRs, so the job skips there). It also has a manual "Run workflow" button.
- Output: a Markdown score table (per case, FR vs EN, tokens, latency) in the job summary and as a PR comment.

---

## 10. CI/CD, versioning, auto-update

### 10.1 CalVer

- Format `YY.W.FIX` using the **ISO week-year and ISO week** (so 2027-01-01 might still be `26.53.x`, which keeps versions monotonic).
- No leading zeros (semver rule, required by electron-updater): week 3 of 2027 = `27.3.0`.
- `FIX` = number of releases already tagged in that ISO week (first release of the week = `.0`).
- `scripts/calver.mjs` computes it from git tags (`v26.46.0`), with unit tests for week/year boundaries.

### 10.2 Workflows

- **ci.yml** (push + PR): `lint` -> `typecheck` -> `unit+integration` (matrix ubuntu/windows/macos) -> `e2e` (windows + macos) -> `build smoke`
  (electron-builder `--dir`, no publish). Plus the `ai-eval` job (rules in 9.4).
- **release.yml** (manual `workflow_dispatch`, optional input "notes"):
  1. Compute version with `calver.mjs`, write it into `package.json` (the commit isn't pushed back; the tag holds the version).
  2. Run the full test suite.
  3. Build in a matrix: `windows-latest` -> NSIS x64 installer + `latest.yml`; `macos-latest` -> DMG + ZIP for arm64 and x64 + `latest-mac.yml`.
  4. Create tag `v<version>` and a GitHub Release with generated notes, upload all artifacts.

### 10.3 Self-update

- On startup (and every 6 h, can be turned off in Settings), `electron-updater` checks GitHub Releases.
- **Windows**: download in background -> toast "Update ready - restart now / later" -> `quitAndInstall`.
- **macOS (unsigned)**: Squirrel.Mac refuses unsigned updates, so the app uses the update metadata to show
  "Version X available", downloads the matching DMG (arm64/x64) to Downloads with progress, and opens it.
  The README documents first-launch Gatekeeper steps (right-click > Open, or `xattr -dr com.apple.quarantine`).
  macOS builds are ad-hoc signed (needed for Apple Silicon to run at all). When an Apple Developer ID is added later,
  only CI secrets change and full silent updates turn on.
- Release notes are shown in a "What's new" dialog after updating.

---

## 11. i18n

- `src/shared/locales/{en,fr}.json`, nested keys by domain (`common`, `packs`, `category`, `editor.tools`, `ops`, `ai`, `settings`, `errors`).
- Default language = **English**. French is chosen in Settings and applied live (persisted in `settings.json`).
- Category names, tool operation descriptions (`ops.*`), error messages (typed `AppError.code` -> `errors.<code>`) and main-process dialogs/menus all go through i18n.
- Lint rule `@intlify/vue-i18n/no-raw-text` = error; CI check for key parity and unused keys.
- Agents get `uiLanguage` in their system prompt (6.4).

---

## 12. Milestones

Every milestone ends with: app launches (`npm run dev` and a packaged build), all tests green in CI on Windows + macOS,
docs updated (README, `docs/`), CHANGELOG entry, everything committed and pushed. **Then I stop for you to test.**

Git workflow (from M0 on):
- Small, focused commits in English (conventional style: `feat:`, `fix:`, `test:`, `docs:`, `ci:`), pushed as work progresses
  so CI runs continuously and you can follow along on GitHub. No Claude attribution lines in commits (per your global instructions).
- Each milestone is developed on a branch `m<N>-<name>` and merged into `main` through a PR once CI is green;
  the PR description summarizes what to test. You merge it after testing (or tell me to).

Parallel execution:
- When a milestone has independent pieces of work, I split them across sub-agents, each in its own **git worktree** on its
  own branch (e.g. in M0: CI/release workflows | app shell + i18n | test harness; in M3: Ollama adapter | proposal review UI | eval suite).
- I keep the shared contracts (IPC contract, tool registry types, data model) on the milestone branch first, so the parallel
  branches build against the same interfaces; then I merge the worktree branches back, run the full test suite, and fix conflicts.
- Sequential work (anything that touches the same files or depends on an unmerged interface) stays in the main session.

### Step 0 - Repository init (first thing after approval)
- `git init` in this folder, `.gitignore` (Node/Electron/OS files, `.env.local`), MIT `LICENSE`, README stub, `PLAN.md`
  (this approved plan, with the section 3.1 diagram restored).
- `gh auth status` check, then `gh repo create sbilodeau/blocksmith-studio --public --source . --push`; Actions enabled.
- First commit on `main`: `docs: add implementation plan`. Everything after this goes through milestone branches.

### M0 - Foundation and delivery pipeline
- electron-vite + Vue 3 + TS + Naive UI + Pinia + vue-i18n scaffold; security baseline (3.2); typed IPC skeleton.
- App shell: title bar, empty tab bar, Settings screen with language (EN/FR, live switch) and theme (light/dark/system).
- ESLint/Prettier/vue-tsc, Vitest + Playwright set up with first tests (security asserts, i18n parity, CalVer).
- `ci.yml`, `release.yml`, `calver.mjs`, electron-builder config, electron-updater wired with both platform flows.
- MIT LICENSE, README, CONTRIBUTING, `docs/architecture.md`, `docs/releasing.md`.
- **Acceptance**: a manual release produces installable Windows and macOS builds on GitHub Releases; installing an older build then releasing a newer one triggers the update flow.
- **Needs from you**: `gh` authenticated as `sbilodeau` on this machine (I check with `gh auth status` before creating the repo).

### M1 - Vanilla, packs, tabs, browsing (MVP part 1)
- Launcher detection + manual selection + Mojang download with consent; extraction worker with progress; vanilla index.
- `versions.json` + support window; `pack.mcmeta` builder (latest target only in this milestone).
- Workspace selection; pack selector (list, new pack, import .zip, open/close, delete to trash).
- Tabs: several packs open at once, each with its own Pinia store and router state.
- Category engine + default `categories.json` (all categories); navigator (category list, counts, preview tiles).
- Grid: pixelated thumbnails, zoom slider, search/filter, multi-select (click, shift, ctrl/cmd, box), modified/added/vanilla badges.
- Export to the authoring version (changed files only) with validation report.
- **Acceptance**: create a vanilla-based pack, browse categories, import a real pack zip, export a zip that loads in Minecraft 26.3.

### M2 - Pixel editor (MVP part 2)
- Canvas editor: pencil, eraser, bucket (tolerance, contiguous), eyedropper, line, rectangle (outline/fill), rectangle selection
  (move/copy/paste/delete), mirror painting (X/Y), rotate/flip (selection or whole), zoom (wheel/pinch, fit), pixel grid toggle, keyboard shortcuts.
- Palette: texture palette auto-extracted, custom swatches, recent colors, color picker with alpha.
- Undo/redo (editor-local patches + pack journal on save); history panel.
- Compare with vanilla: side-by-side and hold-to-toggle; "revert to vanilla".
- Animated textures shown as the full strip with frame guide lines.
- Previous/next texture navigation within the grid's current filter.
- **Acceptance**: edit a texture, undo/redo, save, see it marked modified in the grid, export, see it in-game.

### M2b - Live 3D preview
- Preview3D panel (3.4): three.js scene, orbit/zoom/pan, preset views, auto-rotate, backgrounds, lighting toggle (pop-out window moved to M11).
- Live texture updates from the editor buffer on every stroke; animated texture playback.
- Block models from vanilla blockstates/models (elements, UVs, rotations, tint); extruded items.
- Entity geometry format + starter set (humanoids incl. zombie and armor layers, creeper, common animals); flat UV fallback for the rest.
- Linked 3D/2D hover highlighting; optional idle/walk pose.
- Tests: unit tests for the block model resolver (parent inheritance, UV mapping) and the entity definition schema;
  E2E screenshot check that painting a pixel changes the 3D render.
- **Acceptance**: open `entity/zombie/zombie.png`, paint on it, and see the zombie update live while rotating it in every direction;
  same for a block (e.g. grass block with tint) and an item.

### M3 - Editor agent with Ollama Cloud (MVP complete)
- Secrets service (safeStorage); provider settings UI; Ollama native adapter (streaming, tools, images, thinking, usage); model list + capabilities.
- Agent runtime with draft execution, budgets, Stop button; tool registry with transform, drawing, color, read and memory tools.
- Editor AI panel: instruction box + model picker, streaming text, collapsible thinking panel, tool calls with args/results, token usage badge.
- Proposal review: step list with localized descriptions, before/after previews, per-step toggles, dependency warnings, apply/reject; applied = one undoable journal entry.
- Style brief file + side panel (manual edit); agents read it and propose updates.
- FR/EN eval suite (about 60 cases) + runner + CI job + "Test this model" in Settings.
- **Acceptance**: in French and in English, "tourne de 90° à gauche et ajoute des flammes au bout" produces a reviewable plan; partial apply and undo work.

### M3b - Entity models read from the Minecraft jar
Why: hand-written entity definitions (3.4) cover about 115 of the ~560 entity textures of 26.3, none of the baby models,
and drift when Mojang changes a mob. Since 26.1 the client jar is no longer obfuscated, so the exact model geometry can be
read from the user's own jar, like the textures (nothing is bundled or uploaded; the result is cached in `userData`).

- **Class reader** (`src/main/services/entity-models/classfile.ts`): pure TS parser for JVM class files (constant pool,
  methods, code, bootstrap methods), any class version.
- **Model interpreter** (`interpreter.ts`): a small symbolic JVM interpreter that runs only the model-building code:
  `ModelLayers.<clinit>` (layer names) and `LayerDefinitions.createRoots()` (every layer's mesh). Model builder classes
  (`MeshDefinition`, `PartDefinition`, `CubeListBuilder`, `PartPose`, `CubeDeformation`, `LayerDefinition`,
  `MeshTransformer`, `ImmutableMap.Builder`) are simulated; calls into other jar classes are interpreted recursively
  (static helpers, `<clinit>` constants, lambdas); loops, int/float math and `Mth` are supported. Anything else becomes
  an opaque value, and a layer that depends on one is skipped (never guessed). Instruction budget per layer.
- **Conversion** (`extract.ts`): each layer -> the existing `EntityDefinition` format (Mojang y-down / -z front to the
  preview's y-up / +z front, absolute pivots), with `MeshTransformer.scaling` baked in, per-axis inflation, and an
  optional part `scale`. Written to `userData/vanilla/<version>/entity-models.json` during extraction, or on first use
  for versions extracted before this milestone. Pre-26.1 (obfuscated) jars: skipped, built-in definitions are used.
- **Texture -> layer table** (`resources/data/entity-layers.json`): names only (glob -> layer, e.g.
  `entity/axolotl/axolotl_*_baby.png` -> `axolotl_baby`), hand-maintained, checked by a test that every entry's layer
  exists and its texture size matches the texture.
- **Preview lookup**: jar models (through the table) first, then the built-in definitions, then the flat view. The
  aspect-ratio check stays.
- **Tests**: a test-only class assembler builds synthetic classes for every supported pattern (offsets, rotations,
  children, mirror, deformation, scaling, static helpers, loops, lambdas, opaque calls); the fixture jar gains synthetic
  model classes so the E2E test checks the whole path; a local-only test (skipped without a real jar) checks coverage on
  the user's 26.x jar.
- **Acceptance**: with a 26.3 jar, `entity/axolotl/axolotl_lucy_baby.png`, the warm cow, the llama, the camel and the
  baby farm animals render on their real models; textures without a table entry keep the flat view with its notice.

### M4 - OpenAI-compatible providers and AI settings
- OpenAI-compatible adapter (OpenAI, OpenRouter, custom); capability hints and overrides; per-agent default models; cost estimates (price table, OpenRouter cost); `$`/`$$`/`$$$` cost tier in the model picker (7.4).
- Eval report comparing several models side by side.
- As built: `providers/openai.ts` (SSE stream, tool call fragments, `reasoning_content` / `reasoning` /
  `reasoning_details`, server flavors so api.openai.com never receives unknown fields), presets in
  `src/shared/ai/presets.ts`, price hints in `resources/data/model-prices.json`, user overrides and tier limits in
  `settings.ai`, request cost computed from the price when the provider gives none, Settings > AI > Models, and
  "Test models" with a shared comparison builder (`src/shared/ai/eval-compare.ts`) used by the app and the CLI.
- **Acceptance**: add OpenRouter (or OpenAI) with a key, pick one of its models for the editor agent, get a plan
  for a French request; the model picker shows the cost tier and the answer shows its cost; comparing two models
  in "Test models" gives a ranked table.

### M5 - Navigation agent and bulk operations
- Selection-scoped agent; contact sheets and batching; `apply_to_all` in a worker with progress; bulk proposal review (grid of before/after with per-texture toggles).
- Manual bulk actions in the grid without AI (hue shift, replace color, etc. on a selection).
- As built: one agent loop shared by every agent (`loop.ts`); the navigation agent (`navigation.ts`) exposes the
  registry's color and transform tools as selection-wide operations with an optional `textures` filter (numbers or
  glob), which is the selection-limited `apply_to_all`; contact sheets of 6 x 6 numbered tiles, at most 3 per
  request, plus a text list of every texture. Bulk work (manual previews and the replay of accepted agent steps)
  runs in a worker thread (`services/bulk/`), frame by frame for animated textures, and is written through
  `saveMany` as one history entry. The review grid (`BulkReview.vue`) serves both. A pack-level History drawer
  makes these changes undoable from the grid. The FR/EN eval gained 6 navigation cases on a 4-texture selection.
- **Acceptance**: select several block textures, ask "mets tout plus rouge" (or "darken only the ores"), untick
  one texture in the review and apply: only the kept textures change, in one undoable entry; "Edit selection..."
  does the same without AI.

### M6 - Creation agent
- Pack-level agent: builds the style brief through a conversation, proposes category-by-category plans; plan executes in chunks with checkpoints.
- Request log and decisions shared with the other agents.

### M7 - Multi-version export
- Migration tables for the 1.21.4 -> 26.3 window (generated + reviewed), export-down with warnings, multi-target export, export profiles.
- Import with upgrade migration; authoring version upgrade when a new Minecraft version ships.
- Full Pack Doctor validation panel.

### M8 - Merge and send-to-pack
- Merge wizard, priority ordering, conflict review, JSON deep-merge, cross-tab "Send to pack", undo.

### M9 - Animated textures
- Frame timeline, playback, onion skin, frametime/interpolate editing in `.png.mcmeta`, add/duplicate/reorder frames, GIF import; agent tools gain a `frame` parameter.

### M10 - Data packs
- Data pack projects (or combined resource+data), JSON editors with schema validation (recipes, loot tables, tags, advancements), `write_json` tool, data pack format in mcmeta/export.

### M11 - Polish and extras
- Category mapping editor UI; optional layers in the editor; pop-out 3D preview window; paint directly on the 3D preview model; more entity definitions; performance pass for huge packs; accessibility pass.
- Investigation note on Bedrock support (not implementation).

---

## 13. Risks and open points

| Risk                                                                               | Impact | Mitigation                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LLM pixel-art quality is mediocre (imprecise coordinates, muddy colors)            | High   | Lean on deterministic tools (hue_shift, apply_palette, outline, transforms) over freehand set_pixels; labeled grid images; palette lock; small iteration budgets; always a preview before apply |
| Token cost of images and grids, especially bulk                                    | High   | Palette-indexed grids, contact sheets, `apply_to_all` without sending pixels, history trimming, per-request budgets, usage badge, image mode setting                                            |
| Ollama Cloud model list/capabilities change, some models lack tools/vision         | Medium | Dynamic model listing + `/api/show` capabilities + hint table + user overrides; FR/EN eval suite to pick good models                                                                            |
| API differences (tool-call args as string vs object, thinking fields, missing ids) | Medium | Single adapter layer with recorded-stream integration tests per provider                                                                                                                        |
| Minecraft format changes (new pack format scheme every release, texture renames)   | Medium | Data-driven `versions.json` + migration files, scripts to regenerate, jar's own `version.json` as source of truth, rolling support window                                                       |
| Pack format/mcmeta exact rules around 1.21.9 boundary                              | Medium | Export tests per target + manual in-game check for each supported version before M7 is marked done                                                                                              |
| Unsigned macOS builds: Gatekeeper friction, no silent update                       | Medium | Ad-hoc signing, documented first-launch steps, DMG download flow; signing can be added later via CI secrets                                                                                     |
| Windows SmartScreen warning on unsigned installer                                  | Low    | Documented; reputation builds over time; optional certificate later                                                                                                                             |
| Mojang EULA / asset redistribution                                                 | Medium | Assets never bundled or committed; export only changed files; download from Mojang only with user consent                                                                                       |
| Large packs (thousands of textures, high-res 512x)                                 | Medium | Thumbnails via custom protocol + lazy virtual grid, workers for bulk ops, index cache                                                                                                           |
| Entity geometry isn't in Minecraft's assets (it's in Java code)                    | Medium | Own data-driven geometry files authored under MIT, starter set first, flat UV fallback; never copy Mojang code or GPL model packs                                                               |
| Multi-tab memory use (several packs + agents)                                      | Low    | Unload inactive tab editors, keep only indexes in memory                                                                                                                                        |
| LLM responds in the wrong language or misreads FR directions                       | Low    | Explicit conventions in prompts and tool descriptions; FR/EN suite gates prompt changes                                                                                                         |

### Open points for later (non-blocking)
- Default Ollama Cloud model per agent: to be chosen by running the FR/EN suite on available cloud models during M3.
- Pricing data for non-OpenRouter providers (manual table vs fetched).
- Whether to support snapshots as authoring versions (setting, off by default).

---

## 14. Verification (how each milestone is checked)

- `npm run lint && npm run typecheck && npm test` green locally (unit + integration; AI suite too when `OLLAMA_API_KEY` is set).
- `npm run test:e2e` (Playwright drives the real Electron app) green on macOS locally and on Windows + macOS in CI.
- `npm run dev` launches the app; `npm run build && npm run package` produces an installer that installs and starts.
- Milestone-specific acceptance check listed in section 12 (e.g. M1: exported zip loads in Minecraft 26.3).
- Docs (README, `docs/`, CHANGELOG) updated; then I stop and you test before the next milestone.
