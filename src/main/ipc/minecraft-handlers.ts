import type { MinecraftService } from '../services/minecraft/service'
import { handle } from './registry'

export interface MinecraftHandlerDeps {
  minecraft: MinecraftService
  /** Folder picker for "Add a game folder" (run in main; the renderer never sends paths). */
  chooseGameDir: () => Promise<string | null>
}

/** Install in Minecraft and live mode (M13). */
export function registerMinecraftHandlers({
  minecraft,
  chooseGameDir
}: MinecraftHandlerDeps): void {
  handle('minecraft.gameDirs', () => minecraft.gameDirs())
  handle('minecraft.addGameDir', async () => {
    const path = await chooseGameDir()
    return path ? minecraft.addGameDir(path) : null
  })
  handle('pack.minecraft.get', ({ packId }) => minecraft.status(packId))
  handle('pack.minecraft.install', (target) => minecraft.install(target))
  handle('pack.minecraft.live', (input) => {
    if (!input.on) return minecraft.setLive(input.packId, false)
    const { packId, gameDirId, version, parts, worldId } = input
    return minecraft.setLive(packId, true, { packId, gameDirId, version, parts, worldId })
  })
  handle('pack.minecraft.reveal', ({ packId }) => minecraft.reveal(packId))
}
