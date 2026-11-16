import { z } from 'zod'
import type { PackSummary } from './pack'

/**
 * Merge and send-to-pack (PLAN 8.6, M8). Sources are merged into a target pack (existing or new) in priority order:
 * the first source wins, like the top of Minecraft's resource pack list. Nothing is written until the user applies
 * the reviewed plan; the result is one undoable history entry in the target.
 */

const PackIdSchema = z.string().min(1).max(64)
const PackPathSchema = z.string().min(1).max(512)

export const MergeTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('pack'), packId: PackIdSchema }).strict(),
  z
    .object({
      kind: z.literal('new'),
      name: z.string().trim().min(1).max(64),
      description: z.string().max(512).default('')
    })
    .strict()
])
export type MergeTarget = z.infer<typeof MergeTargetSchema>

export const MergePreviewInputSchema = z
  .object({
    /** Source packs, highest priority first. */
    sources: z.array(PackIdSchema).min(1).max(8),
    target: MergeTargetSchema,
    /** Send to pack: only these files of the (single) source, plus their .png.mcmeta. */
    paths: z.array(PackPathSchema).max(5000).optional(),
    /** Also merge the sources' style briefs (palette, rules) into the target's. */
    mergeBriefs: z.boolean().default(false)
  })
  .strict()
export type MergePreviewInput = z.infer<typeof MergePreviewInputSchema>

/** One version of a conflicting file. `origin` is 'target' or a source pack id. */
export interface MergeCandidate {
  origin: string
  originName: string
  sha256: string
  size: number
  /** PNG files: the image, for side-by-side thumbnails. */
  png?: Uint8Array
  /** Text files: the content (truncated). */
  text?: string
}

export interface MergeConflict {
  path: string
  kind: 'png' | 'json' | 'other'
  /** Distinct contents, highest priority first; the target's (if any) last. */
  candidates: MergeCandidate[]
  /** Default choice: the highest-priority source. */
  choice: string
}

export interface MergePlan {
  id: string
  /** Existing target, or the name of the pack to create. */
  target: { packId?: string; name: string; authoringVersion: string; created: boolean }
  sources: Array<{ packId: string; name: string; authoringVersion: string }>
  /** Files new to the target (one content among the sources). */
  added: string[]
  /** Files already identical in the target (nothing to do). */
  identical: number
  /** JSON files combined automatically (lang, sounds, atlases, fonts, data pack tags). */
  merged: string[]
  conflicts: MergeConflict[]
  /** Files that do not exist in the target's Minecraft version (after path migration). */
  skipped: Array<{ path: string; origin: string; reason: 'notInVersion' }>
  /** Source files renamed to the target version's names. */
  renamed: number
  mergeBriefs: boolean
}

export const MergeApplyInputSchema = z
  .object({
    planId: z.string().min(1).max(64),
    /** path -> chosen origin ('target' keeps the target's file). Missing paths use the plan's default choice. */
    choices: z.record(PackPathSchema, z.string().min(1).max(64)).default({})
  })
  .strict()
export type MergeApplyInput = z.infer<typeof MergeApplyInputSchema>

export interface MergeResult {
  pack: PackSummary
  /** Files written to the target. */
  written: number
  /** The target pack was created by this merge. */
  created: boolean
  briefMerged: boolean
}
