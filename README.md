<p align="center"><img src="build/icon.png" width="128" alt="Blocksmith Studio icon"></p>

# Blocksmith Studio

Desktop app (Windows and macOS) to create and edit Minecraft Java Edition resource packs, with a pixel editor,
a live 3D preview and AI agents that propose changes you review before anything is applied.

> Status: early development (milestone M3 - editor AI agent, MVP complete). See [PLAN.md](PLAN.md) for the full plan and milestones.

## Highlights (planned)

- Multiple packs open at once, one tab per pack, with merging between packs
- Textures browsed by category (Blocks, Ores, Tools, Weapons, Armor, Food, Entities, GUI...)
- Pixel editor with undo/redo, compare with vanilla, and a live 3D preview for blocks, items and entities
- AI agents (Ollama Cloud by default, any OpenAI-compatible endpoint) that only propose tool calls you validate
- Export to any Minecraft Java version released in the last two years
- English and French interface
- Self-updating releases published on GitHub Releases (CalVer `yy.ww.fix`)

## AI agent

The editor has an **AI** tab next to the drawing tools. Describe a change in French or English ("tourne de 90° à
gauche et ajoute des flammes au bout"); the agent answers with a plan of steps, each with a before/after preview.
Tick the steps you want and apply: the result lands in the editor as one undoable edit, and nothing is saved until
you save.

To use it, open Settings > AI, paste your [Ollama Cloud](https://ollama.com) API key and pick a model (models that
support tools are listed, with badges for vision and reasoning). Keys are encrypted with the system keychain and
never leave the main process. A self-hosted Ollama on `http://localhost:11434` works without a key.
**Test a model** in the same screen checks how well a model understands French and English requests.

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
| `npm run test:ai`     | Live FR/EN AI evaluation (needs `OLLAMA_API_KEY`, see docs)     |
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
- [docs/ai-agents.md](docs/ai-agents.md) - editor agent: tools, context, runtime loop, proposals, style brief
- [docs/ai-providers.md](docs/ai-providers.md) - provider layer, Ollama API, secrets, errors
- [docs/ai-evaluation.md](docs/ai-evaluation.md) - FR/EN evaluation: running it, thresholds, adding cases
- [CONTRIBUTING.md](CONTRIBUTING.md) - conventions, tests, i18n rules, commits

## License

[MIT](LICENSE). Not an official Minecraft product. Not approved by or associated with Mojang or Microsoft.
