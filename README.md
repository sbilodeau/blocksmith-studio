# Blocksmith Studio

Desktop app (Windows and macOS) to create and edit Minecraft Java Edition resource packs, with a pixel editor,
a live 3D preview and AI agents that propose changes you review before anything is applied.

> Status: early development. See [PLAN.md](PLAN.md) for the full implementation plan and milestones.

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

## License

[MIT](LICENSE). Not an official Minecraft product. Not approved by or associated with Mojang or Microsoft.
