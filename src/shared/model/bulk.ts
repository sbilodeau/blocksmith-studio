import { z } from 'zod'
import { BulkOperationSchema, type BulkOperation } from '../bulk/operations'

/** Most textures one bulk request may cover (a whole category of a big pack fits). */
export const MAX_BULK_TEXTURES = 2000
/** Operations chained in one manual bulk action. */
export const MAX_BULK_OPERATIONS = 8

const PathSchema = z.string().min(1).max(512)

export const BulkPreviewInputSchema = z
  .object({
    packId: z.string().min(1),
    paths: z.array(PathSchema).min(1).max(MAX_BULK_TEXTURES),
    operations: z.array(BulkOperationSchema).min(1).max(MAX_BULK_OPERATIONS)
  })
  .strict()

export const BulkApplyInputSchema = z
  .object({
    previewId: z.string().min(1),
    /** Textures the user kept ticked in the review. */
    paths: z.array(PathSchema).max(MAX_BULK_TEXTURES)
  })
  .strict()

/** One texture of a bulk review: before and after (PNG), for the before/after grid with per-texture toggles. */
export interface BulkItem {
  path: string
  /** File name without extension. */
  name: string
  beforePng: Uint8Array
  afterPng: Uint8Array
  changedPixels: number
}

/** Result of a manual bulk action, kept in main until it is applied or discarded. */
export interface BulkPreview {
  id: string
  packId: string
  operations: BulkOperation[]
  /** Textures that change. */
  items: BulkItem[]
  /** Textures the operations leave identical. */
  unchanged: string[]
  /** Textures that could not be processed, with the reason (English). */
  failed: Array<{ path: string; error: string }>
}

export interface BulkApplyResult {
  /** Textures written (one history entry). */
  applied: number
}
