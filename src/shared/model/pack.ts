import { z } from 'zod'

export type PackId = string
/** POSIX path relative to the pack root, e.g. "assets/minecraft/textures/block/stone.png". */
export type PackPath = string

export const PackBaseSchema = z.enum(['vanilla', 'empty'])
export type PackBase = z.infer<typeof PackBaseSchema>

/**
 * What the pack holds (PLAN M10): textures and other assets (resource pack), data files (data pack), or both
 * (combined: one folder, exported as a resource pack zip and a data pack zip). Older projects are resource packs.
 */
export const PackKindSchema = z.enum(['resource', 'data', 'combined'])
export type PackKind = z.infer<typeof PackKindSchema>

/** True when the pack kind includes textures (resource or combined). */
export function hasResources(kind: PackKind): boolean {
  return kind !== 'data'
}

/** True when the pack kind includes data files (data or combined). */
export function hasData(kind: PackKind): boolean {
  return kind !== 'resource'
}

/** .blocksmith/project.json */
export const ProjectSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string(),
  name: z.string().min(1).max(64),
  description: z.string().max(512),
  authoringVersion: z.string(),
  base: PackBaseSchema,
  kind: PackKindSchema.default('resource'),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** Last export settings (export profile): the dialog preselects them for a one-click re-export. */
  exportProfile: z
    .object({
      targets: z.array(z.string()).max(40),
      acceptNewer: z.boolean().default(false),
      /** Combined packs: which zips to write (default: both). */
      packTypes: z
        .array(z.enum(['resource', 'data']))
        .min(1)
        .max(2)
        .optional()
    })
    .optional()
})
export type Project = z.infer<typeof ProjectSchema>
export type ExportProfile = NonNullable<Project['exportProfile']>

/** What the pack selector shows for each pack in the workspace. */
export interface PackSummary {
  id: PackId
  name: string
  description: string
  authoringVersion: string
  base: PackBase
  kind: PackKind
  /** Absolute folder path (shown in the UI, never trusted back from the renderer). */
  folder: string
  /** Number of texture and data files that differ from vanilla or are new. */
  changedCount: number
  updatedAt: string
  /** bs-asset:// URL of pack.png, if any. */
  iconUrl?: string
  /** Last export settings, if the pack was exported before. */
  exportProfile?: ExportProfile
}

export type TextureStatus = 'vanilla' | 'modified' | 'added'

/** One texture as seen by a pack: pack file if present, otherwise the vanilla one. */
export interface TextureEntry {
  path: PackPath
  /** "minecraft" */
  namespace: string
  /** Folder under textures/: "block", "item", "entity/zombie", "gui/sprites/hud"... */
  folder: string
  /** File name without extension: "stone". */
  name: string
  width: number
  height: number
  animated: boolean
  frameCount?: number
  status: TextureStatus
  /** Category ids from the mapping table (a texture can be in several). */
  categories: string[]
  /** bs-asset:// URL for thumbnails (cache-busted when the file changes). */
  url: string
}

export interface CategorySummary {
  id: string
  i18nKey: string
  count: number
  changedCount: number
  /** Thumbnail of the category's icon texture. */
  iconUrl?: string
}

export const CreatePackInputSchema = z
  .object({
    name: z.string().trim().min(1).max(64),
    description: z.string().max(512).default(''),
    base: PackBaseSchema,
    kind: PackKindSchema.default('resource'),
    authoringVersion: z.string().min(1)
  })
  .strict()
export type CreatePackInput = z.input<typeof CreatePackInputSchema>

/** Pack Doctor (PLAN 8.5): problems in the pack, and what an export to each version would change. */
export interface DoctorReport {
  /** Same codes as export warnings (`warnings.<code>`), plus doctor.* codes. */
  issues: Array<{ code: string; path?: string }>
  /** Every export target: textures that would be renamed, and the ones it would skip. */
  targets: Array<{ version: string; renamed: number; missing: string[] }>
  /** Files checked. */
  files: number
}

/** Result of moving a pack to a newer authoring version. */
export interface UpgradeReport {
  pack: PackSummary
  from: string
  to: string
  /** Textures moved to their new name. */
  renamed: number
  /** Textures that no longer exist in the new version (left in the pack, unused by Minecraft). */
  obsolete: string[]
  /** Renames skipped because the new name already exists in the pack (both files kept). */
  conflicts: string[]
}

export interface ImportReport {
  pack: PackSummary
  /** Pack format declared by the imported pack.mcmeta, and the version it maps to (if known). */
  declaredFormat?: { major: number; minor: number }
  mappedVersion?: string
  filesImported: number
  /** Files dropped because they are identical to vanilla. */
  identicalToVanilla: number
  /** Textures moved to the authoring version's path (older pack, see migrations.ts). */
  renamed: number
  warnings: Array<{ code: string; path?: string }>
}

/** What an export produces: a resource pack (assets/) or a data pack (data/). */
export const ExportPackTypeSchema = z.enum(['resource', 'data'])
export type ExportPackType = z.infer<typeof ExportPackTypeSchema>

/** File name suffix per pack type: "<name>-<version>-resource-pack.zip" / "-data-pack.zip". */
export const PACK_TYPE_FILE_SUFFIX: Record<ExportPackType, string> = {
  resource: 'resource-pack',
  data: 'data-pack'
}

export interface ExportReport {
  outputPath: string
  targetVersion: string
  packType: ExportPackType
  /** Textures moved to the target version's path (the authoring version names them differently). */
  renamed: number
  filesWritten: number
  sizeBytes: number
  skipped: Array<{ path: string; reason: string }>
  warnings: Array<{ code: string; path?: string }>
}
