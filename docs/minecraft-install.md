# Install in Minecraft and live mode

The **Play in Minecraft** button in the pack header puts the pack straight into the game's own folders, so there is
no zip to move by hand. It has two modes:

| Mode      | What it writes                                          | When the game sees a change                          |
| --------- | ------------------------------------------------------- | ---------------------------------------------------- |
| Install   | `<pack name>.zip`, once, each time you click Install    | After you install again and reload (F3+T, `/reload`) |
| Live mode | `<pack name> [live]/`, an unzipped copy kept up to date | Right after each save, once you reload in the game   |

Both use the export steps (see [packs.md](packs.md#export-zip)): the files are made for the chosen Minecraft
version (paths migrated, `pack.mcmeta` regenerated), and files identical to vanilla are left out.

## Destinations

- **Minecraft folder**: the official launcher's `.minecraft` (shown when it exists) or a game folder added with
  **Add a game folder...**. A game folder is one that has `options.txt`, `saves/`, `resourcepacks/` or `versions/`.
  For another launcher, add its instance's game folder, for example `instances/<name>/minecraft` for Prism
  Launcher.
- **Minecraft version**: the official launcher can run any version, so you choose the one you play. The choices
  are the pack's export targets. The default is the last export target, or else the pack's version.
- **Parts** (combined packs only): the resource part goes in `resourcepacks/`, and the data part goes in
  `saves/<world>/datapacks/`.
- **World**: needed for the data part. The list shows the folders of `saves/` that contain a `level.dat`.

The choice is remembered per pack on this computer in `userData/minecraft.json`, not in the pack folder, so a pack
shared through git carries no local paths. The same file holds the folders added by hand.

## In the game

| Part          | First time                                                      | After a change               |
| ------------- | --------------------------------------------------------------- | ---------------------------- |
| Resource pack | Options > Resource Packs: move the pack to "Selected" once      | Press **F3+T**               |
| Data pack     | Used when the world loads (or `/datapack enable "file/<name>"`) | Run **/reload** in the world |

Minecraft remembers selected resource packs by file name in `options.txt`, which is why installs and live folders
keep a stable name: the next install or sync stays selected. Select either the installed zip or the `[live]` folder,
not both, or the one higher in the list wins.

## Live mode

- Turning it on writes the whole copy, then every change saved in the app syncs it again, about 0.4 s later.
  That covers texture saves, applied AI proposals, bulk edits, merges, data file saves, undo and redo in the pack
  history, and pack name or description edits. Strokes not yet saved are not synced.
- Only changed files are written: a marker file `.blocksmith-live.json` in the live folder records the pack id and a
  hash of every file. Files removed from the pack are removed from the copy, with their empty folders.
- The app only ever changes a folder whose marker belongs to the pack. If a folder with the same name exists
  without that marker, live mode refuses to start (`minecraft.folderNotOurs`) and leaves the folder alone.
- Live mode stays on across restarts: at start-up, packs left in live mode are synced again. Renaming the pack moves
  the live folder to the new name. Deleting the pack removes its live copy.
- Turning it off deletes the live folder (only if the marker matches). An installed zip is kept.
- Changes made to the pack folder by other programs are not watched; they are picked up at the next save in the
  app, or by turning live mode off and on.
- While live mode is on, the destination cannot change (turn it off first), the pack tab shows a **LIVE** badge and
  the panel shows the last sync time.

Each sync reads every file of the pack again (the export step). That is quick for usual packs; very large packs
(thousands of textures) take a moment per save.

## Code

| Part             | File                                                                                         |
| ---------------- | -------------------------------------------------------------------------------------------- |
| Game folders     | `src/main/services/minecraft/destinations.ts` (`listGameDirs`, `listWorlds`, `isGameDir`)    |
| Saved choices    | `src/main/services/minecraft/store.ts` (`userData/minecraft.json`)                           |
| Folder sync      | `src/main/services/minecraft/sync.ts` (`syncLiveFolder`, `removeLiveFolder`)                 |
| Install and live | `src/main/services/minecraft/service.ts` (debounced, one sync at a time per pack)            |
| Export step      | `collectExportFiles()` in `src/main/services/packs/exporter.ts`, `PackService.exportFiles`   |
| IPC              | `src/main/ipc/minecraft-handlers.ts`                                                         |
| UI               | `src/renderer/components/pack/PlayInMinecraftDialog.vue`, `src/renderer/stores/minecraft.ts` |

Channels: `minecraft.gameDirs`, `minecraft.addGameDir` (folder picker in main), `pack.minecraft.get`,
`pack.minecraft.install`, `pack.minecraft.live` (`on: true` with a destination, or `on: false`),
`pack.minecraft.reveal`, and the event `pack.minecraft.status`. The renderer only sends ids (game folder id, world
folder name); main resolves them and checks every written path stays inside the destination folder.

`BLOCKSMITH_MINECRAFT_DIR` replaces the official `.minecraft` path. The E2E tests always set it to a temporary
folder, so no test can write into a real game folder.

## Error codes

| Code                       | Meaning                                                          |
| -------------------------- | ---------------------------------------------------------------- |
| `minecraft.gameDirMissing` | The chosen game folder no longer exists                          |
| `minecraft.worldRequired`  | The data part needs a world                                      |
| `minecraft.worldMissing`   | The chosen world no longer exists                                |
| `minecraft.folderNotOurs`  | A folder with the live folder's name exists and is not the app's |
| `minecraft.notAGameDir`    | The folder picked with "Add a game folder" is not a game folder  |
| `minecraft.partNotInPack`  | The pack has no resource (or data) part                          |
| `minecraft.syncFailed`     | A live sync failed for another reason (shown in the panel)       |
