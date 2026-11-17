<p align="center"><img src="build/icon.png" width="128" alt="Blocksmith Studio icon"></p>

# Blocksmith Studio

Desktop app (Windows and macOS) to create and edit Minecraft Java Edition resource packs and data packs, with a
pixel editor, a live 3D preview, a checked JSON editor and AI agents that propose changes you review before
anything is applied.

> Status: early development (milestone M10 - data packs). See [PLAN.md](PLAN.md) for the full plan and milestones.

## Highlights (planned)

- Multiple packs open at once, one tab per pack, with merging between packs
- Textures browsed by category (Blocks, Ores, Tools, Weapons, Armor, Food, Entities, GUI...)
- Pixel editor with undo/redo, compare with vanilla, and a live 3D preview for blocks, items and entities
- Animated textures edited frame by frame: timeline, playback, onion skin, frame timing, GIF import
- Data packs (or resource + data packs): recipes, loot tables, tags, advancements and functions, edited with live
  checks against Minecraft's format, item id completion, new-file templates, an AI chat that refines the open file
  and an **Explain** tab that says in simple terms what a file changes in the game
- Bulk edits of a selection (hue, brightness, palette, outline, flip...) reviewed texture by texture
- AI agents (Ollama Cloud by default, any OpenAI-compatible endpoint) that only propose tool calls you validate
- Export to any Minecraft Java version released in the last two years
- English and French interface
- Self-updating releases published on GitHub Releases (CalVer `yy.ww.fix`)

## AI agents

The editor has an **AI** tab next to the drawing tools. Describe a change in French or English ("tourne de 90° à
gauche et ajoute des flammes au bout"); the agent answers with a plan of steps, each with a before/after preview.
Tick the steps you want and apply: the result lands in the editor as one undoable edit, and nothing is saved until
you save.

In the texture grid, select textures and click **Ask the AI** (or **AI assistant** in the pack header): the
navigation agent works on the whole selection ("mets tout plus rouge", "darken only the ores") and shows every
changed texture before and after, each with its own checkbox. Without AI, **Edit selection...** applies the same
color and transform operations by hand. Both write one change you can undo from **History**.

On the pack overview, **Ask the AI (whole pack)** opens the creation agent: describe the pack you want ("fais un
pack de feu", "make every ore glow red"). It proposes a style brief and category-by-category steps, each with a few
sample textures before and after. Tick the steps you want and apply: each step is written as its own entry in
**History** (you can stop between steps, and undo the last steps without losing the others). It also works on an
empty pack: "un squelette en glace" starts from Minecraft's skeleton textures and adds the icy versions to your
pack. On a data pack it writes the files instead ("le minerai de diamant donne deux diamants", "a recipe for
saddles"): each proposed file is checked and shown before you apply it. In the data editor, the **AI** panel has a chat
that refines the open file (you apply its proposal to the editor and save it) and an **Explain** tab that says what the
file does in the game compared with Minecraft's original, in simple terms and in your language.

To use the agents, open Settings > AI, paste your [Ollama Cloud](https://ollama.com) API key and pick a model (models that
support tools are listed, with badges for vision and reasoning, and `$` / `$$` / `$$$` when the price is known).
OpenAI, OpenRouter and any OpenAI-compatible server can be added from "Add a provider"; a self-hosted Ollama on
`http://localhost:11434` works without a key. Keys are encrypted with the system keychain and never leave the main
process. **Test models** in the same screen checks how well one or several models understand French and English
requests, side by side.

Vanilla textures are never bundled: they are read from your own Minecraft installation or downloaded from Mojang
with your consent.

## Install

Download the latest installer from [GitHub Releases](https://github.com/sbilodeau/blocksmith-studio/releases).

| Platform              | File                                    | Updates                                                           |
| --------------------- | --------------------------------------- | ----------------------------------------------------------------- |
| Windows 10/11 (x64)   | `Blocksmith-Studio-<version>-setup.exe` | Automatic: downloaded in the background, installed on restart     |
| macOS (Apple Silicon) | `Blocksmith-Studio-<version>-arm64.dmg` | Notified in the app; the new DMG is downloaded and opened for you |
| macOS (Intel)         | `Blocksmith-Studio-<version>-x64.dmg`   | Same as above                                                     |

The builds are not code-signed yet:

- **Windows**: SmartScreen may warn about an unknown publisher. Click "More info" then "Run anyway".
- **macOS**: on first launch, right-click the app in Applications and choose "Open", or run
  `xattr -dr com.apple.quarantine "/Applications/Blocksmith Studio.app"`.

## Development

Requirements: Node.js 22+ and npm. Works on macOS and Windows.

```bash
npm install
npm run dev          # start the app with hot reload
```

| Command               | What it does                                                    |
| --------------------- | --------------------------------------------------------------- |
| `npm run dev`         | Run the app in development mode (hot reload)                    |
| `npm run build`       | Build main, preload and renderer into `out/`                    |
| `npm run lint`        | ESLint (includes the i18n rule that forbids hard-coded UI text) |
| `npm run typecheck`   | Type-check main/preload/shared (tsc) and renderer (vue-tsc)     |
| `npm test`            | Unit, integration and component tests (Vitest)                  |
| `npm run test:e2e`    | Build, then drive the real Electron app with Playwright         |
| `npm run test:ai`     | Live FR/EN AI evaluation (needs a provider key, see docs)       |
| `npm run format`      | Format the code with Prettier                                   |
| `npm run package:dir` | Build an unpacked app for the current platform (no installer)   |
| `npm run package`     | Build installers for the current platform (not published)       |
| `npm run calver`      | Print the next CalVer release version computed from git tags    |

Running from a terminal inside VS Code: VS Code sets `ELECTRON_RUN_AS_NODE`, which makes Electron start as plain
Node. The E2E helper removes it automatically; if `npm run dev` fails with "bad option", run `unset ELECTRON_RUN_AS_NODE`.

Project documentation:

- [docs/architecture.md](docs/architecture.md) - processes, IPC contract, security model, folder layout
- [docs/releasing.md](docs/releasing.md) - CalVer, release workflow, auto-update behavior, signing
- [docs/versions.md](docs/versions.md) - supported Minecraft versions, pack.mcmeta rules, vanilla extraction
- [docs/packs.md](docs/packs.md) - pack folder layout, texture statuses, import and export
- [docs/categories.md](docs/categories.md) - texture categories and how to edit the mapping
- [docs/editor.md](docs/editor.md) - pixel editor tools, shortcuts and undo levels
- [docs/image-core.md](docs/image-core.md) - the shared image library (conventions, operations)
- [docs/preview.md](docs/preview.md) - live 3D preview: model resolution and rendering
- [docs/entity-models.md](docs/entity-models.md) - entity models read from your Minecraft jar, built-in geometry, how to add entities
- [docs/ai-agents.md](docs/ai-agents.md) - editor, navigation and creation agents: tools, context, loop, proposals, style brief
- [docs/bulk.md](docs/bulk.md) - bulk operations on a selection: engine, worker thread, review, history
- [docs/ai-providers.md](docs/ai-providers.md) - provider layer, Ollama and OpenAI-compatible APIs, prices, secrets
- [docs/ai-evaluation.md](docs/ai-evaluation.md) - FR/EN evaluation: running it, thresholds, adding cases
- [CONTRIBUTING.md](CONTRIBUTING.md) - conventions, tests, i18n rules, commits

## License

[MIT](LICENSE). Not an official Minecraft product. Not approved by or associated with Mojang or Microsoft.
