import { z } from 'zod'

/** A pack format number. Since 1.21.9 formats have a minor part (e.g. 69.0); before, minor is always 0. */
export const PackFormatSchema = z.object({
  major: z.number().int().nonnegative(),
  minor: z.number().int().nonnegative().default(0)
})
export type PackFormat = z.infer<typeof PackFormatSchema>

/**
 * pack.mcmeta flavor understood by a version:
 * - 'pack_format': single integer `pack_format` (+ optional `supported_formats`), up to 1.21.8
 * - 'minmax': `min_format` / `max_format` (1.21.9+)
 */
export const McmetaStyleSchema = z.enum(['pack_format', 'minmax'])
export type McmetaStyle = z.infer<typeof McmetaStyleSchema>

/** One Minecraft Java release in resources/data/versions.json. */
export const McVersionSchema = z.object({
  id: z.string(), // "1.21.4", "26.3"
  releaseTime: z.string(), // ISO date from Mojang's manifest
  resourcePack: PackFormatSchema,
  dataPack: PackFormatSchema,
  mcmetaStyle: McmetaStyleSchema
})
export type McVersion = z.infer<typeof McVersionSchema>

export const VersionTableSchema = z.object({
  schemaVersion: z.literal(1),
  /** Date the table was last regenerated (scripts/update-versions.mjs). */
  updatedAt: z.string(),
  versions: z.array(McVersionSchema)
})
export type VersionTable = z.infer<typeof VersionTableSchema>

/** Support window: releases from the last 24 months, plus the latest one. */
export const SUPPORT_WINDOW_MONTHS = 24
