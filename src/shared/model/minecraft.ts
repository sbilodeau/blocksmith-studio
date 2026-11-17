import { z } from 'zod'
import { ExportPackTypeSchema } from './pack'

/**
 * Install in Minecraft and live mode (M13): where a pack goes in the game's own folders. See
 * docs/minecraft-install.md.
 */

/** A world of a game folder (`saves/<folder>` with a level.dat); data packs go in its datapacks/ folder. */
export interface GameWorld {
  /** The world's folder name (also its id). */
  id: string
}

/** A Minecraft game folder: the official launcher's .minecraft, or a folder added by hand. */
export interface GameDir {
  /** Opaque id (hash of the path); the renderer only ever sends ids back. */
  id: string
  kind: 'official' | 'custom'
  path: string
  worlds: GameWorld[]
}

const IdSchema = z.string().min(1).max(64)
/** A world folder name: one path segment, no hidden or parent folder. */
export const WorldIdSchema = z
  .string()
  .min(1)
  .max(255)
  .refine((s) => !/[\\/]/.test(s) && !s.startsWith('.') && s.trim() === s, 'invalid world')

/** The pack's destination in the game, remembered per pack on this computer (userData/minecraft.json). */
export const MinecraftLinkSchema = z.object({
  gameDirId: IdSchema,
  /** The Minecraft version the files are made for (an export target of the pack). */
  version: z.string().min(1).max(64),
  /** Parts written: the resource part goes in resourcepacks/, the data part in the world's datapacks/. */
  parts: z.array(ExportPackTypeSchema).min(1),
  worldId: WorldIdSchema.optional(),
  live: z.boolean().default(false)
})
export type MinecraftLink = z.infer<typeof MinecraftLinkSchema>

export type LiveStatus =
  | { state: 'off' }
  | { state: 'syncing' }
  | { state: 'synced'; at: string; changed: number }
  | { state: 'error'; at: string; code: string; params?: Record<string, string | number> }

export interface PackMinecraftStatus {
  link: MinecraftLink | null
  live: LiveStatus
  /** Names of the live folders in the game (`<pack name> [live]`), shown to the user. */
  liveNames: string[]
}

/** Result of a one-time install. */
export interface InstallResult {
  /** File names written (`<pack name>.zip`), one per part. */
  written: { part: 'resource' | 'data'; name: string }[]
  /** Export warnings, deduplicated codes with an optional path. */
  warnings: { code: string; path?: string }[]
}

/** Input of pack.minecraft.install and of pack.minecraft.live with `on: true`. */
export const MinecraftTargetSchema = z
  .object({
    packId: IdSchema,
    gameDirId: IdSchema,
    version: z.string().min(1).max(64),
    parts: z.array(ExportPackTypeSchema).min(1).max(2),
    worldId: WorldIdSchema.optional()
  })
  .strict()
export type MinecraftTarget = z.infer<typeof MinecraftTargetSchema>

/** AppError codes of the minecraft.* and pack.minecraft.* channels (i18n `errors.<code>`). */
export const MinecraftErrorCode = {
  gameDirMissing: 'minecraft.gameDirMissing',
  worldRequired: 'minecraft.worldRequired',
  worldMissing: 'minecraft.worldMissing',
  folderNotOurs: 'minecraft.folderNotOurs',
  notAGameDir: 'minecraft.notAGameDir',
  partNotInPack: 'minecraft.partNotInPack'
} as const
