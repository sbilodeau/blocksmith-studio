# Blocksmith Studio

Desktop app (Windows and macOS) to create and edit Minecraft Java Edition resource packs, with a pixel editor,
a live 3D preview and AI agents that propose changes you review before anything is applied.

> Status: early development (milestone M0 - foundation). See [PLAN.md](PLAN.md) for the full plan and milestones.

## Highlights (planned)

- Multiple packs open at once, one tab per pack, with merging between packs
- Textures browsed by category (Blocks, Ores, Tools, Weapons, Armor, Food, Entities, GUI...)
- Pixel editor with undo/redo, compare with vanilla, and a live 3D preview for blocks, items and entities
- AI agents (Ollama Cloud by default, any OpenAI-compatible endpoint) that only propose tool calls you validate
- Export to any Minecraft Java version released in the last two years
- English and French interface
- Self-updating releases published on GitHub Releases (CalVer `yy.ww.fix`)

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
| `npm run format`      | Format the code with Prettier                                   |
| `npm run package:dir` | Build an unpacked app for the current platform (no installer)   |
| `npm run package`     | Build installers for the current platform (not published)       |
| `npm run calver`      | Print the next CalVer release version computed from git tags    |

Running from a terminal inside VS Code: VS Code sets `ELECTRON_RUN_AS_NODE`, which makes Electron start as plain
Node. The E2E helper removes it automatically; if `npm run dev` fails with "bad option", run `unset ELECTRON_RUN_AS_NODE`.

Project documentation:

- [docs/architecture.md](docs/architecture.md) - processes, IPC contract, security model, folder layout
- [docs/releasing.md](docs/releasing.md) - CalVer, release workflow, auto-update behavior, signing
- [CONTRIBUTING.md](CONTRIBUTING.md) - conventions, tests, i18n rules, commits

## License

[MIT](LICENSE). Not an official Minecraft product. Not approved by or associated with Mojang or Microsoft.
