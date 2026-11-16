import type { PackFormat } from './versions'

/** A launcher folder that contains Minecraft client jars. */
export interface MinecraftInstall {
  launcher: 'official' | 'prism' | 'multimc' | 'modrinth' | 'curseforge' | 'custom'
  /** Root folder (e.g. ~/Library/Application Support/minecraft). */
  path: string
  /** Release version ids with a client jar present (versions/<id>/<id>.jar or instance equivalent). */
  versions: Array<{ id: string; jarPath: string }>
}

/** Where the vanilla assets for a version can come from right now. */
export type VanillaSource = 'cache' | 'local' | 'mojang'

/** Availability of one supported Minecraft version's vanilla assets. */
export interface VanillaAvailability {
  versionId: string
  releaseTime: string
  /** 'ready' = extracted cache exists; 'local' = a jar is on disk; 'downloadable' = only from Mojang. */
  state: 'ready' | 'local' | 'downloadable'
  jarPath?: string
  isLatest: boolean
}

/** One file in the extracted vanilla cache (userData/vanilla/<version>/index.json). */
export interface VanillaIndexEntry {
  /** POSIX path relative to the pack root, e.g. "assets/minecraft/textures/block/stone.png". */
  path: string
  sha256: string
  size: number
  /** PNG only. */
  width?: number
  height?: number
  /** PNG with a sibling .png.mcmeta containing "animation". */
  animated?: boolean
  frameCount?: number
}

export interface VanillaIndex {
  schemaVersion: 1
  versionId: string
  /** From the jar's own version.json (authoritative). */
  resourcePack: PackFormat
  dataPack: PackFormat
  createdAt: string
  /**
   * True when the vanilla data (recipes, loot tables, tags, advancements) is in the cache and in `entries`. Versions
   * extracted before data support (M10) get it from their jar on first use (VanillaStore.prepareData).
   */
  data?: boolean
  entries: Record<string, VanillaIndexEntry>
}
