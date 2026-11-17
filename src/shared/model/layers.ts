import { z } from 'zod'

/**
 * Editor layers (PLAN M11): optional, per texture. The pack keeps the flattened PNG (what Minecraft reads); the
 * layers are kept next to the project in `.blocksmith/layers/<texture path>.json` so editing can continue later.
 */

/** Most layers a texture can have. */
export const MAX_LAYERS = 16
/** Largest PNG of one layer (same limit as texture.save). */
export const MAX_LAYER_PNG_BYTES = 16 * 1024 * 1024
export const MAX_LAYER_NAME = 40

const LayerMetaShape = {
  name: z.string().trim().min(1).max(MAX_LAYER_NAME),
  visible: z.boolean(),
  /** Percent. */
  opacity: z.number().int().min(0).max(100)
}

/** One layer as sent over IPC (PNG bytes). */
export const LayerDataSchema = z
  .object({
    ...LayerMetaShape,
    png: z
      .instanceof(Uint8Array)
      .refine((b) => b.byteLength > 0 && b.byteLength <= MAX_LAYER_PNG_BYTES)
  })
  .strict()
export type LayerData = z.infer<typeof LayerDataSchema>

/** A texture's layers, bottom first, and the layer selected in the editor. */
export const TextureLayersSchema = z
  .object({
    active: z.number().int().min(0),
    items: z.array(LayerDataSchema).min(1).max(MAX_LAYERS)
  })
  .strict()
  .refine((l) => l.active < l.items.length, { message: 'active must point to a layer' })
export type TextureLayers = z.infer<typeof TextureLayersSchema>

/** On disk: the same data with base64 PNGs. */
export const LayersFileSchema = z
  .object({
    schemaVersion: z.literal(1),
    active: z.number().int().min(0),
    layers: z
      .array(
        z.object({
          ...LayerMetaShape,
          png: z.base64().max(Math.ceil(MAX_LAYER_PNG_BYTES / 3) * 4)
        })
      )
      .min(1)
      .max(MAX_LAYERS)
  })
  .refine((f) => f.active < f.layers.length)
export type LayersFile = z.infer<typeof LayersFileSchema>

/** Folder of the layer files, relative to the pack root. */
export const LAYERS_DIR = '.blocksmith/layers'
