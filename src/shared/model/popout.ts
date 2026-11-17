import { z } from 'zod'

/**
 * Pop-out 3D preview (PLAN M11): a second window that shows the texture open in a pack tab's editor. The editor
 * window pushes the texture state through main; the pop-out sends hover and painting input back the same way.
 * Main only relays between the two windows it knows (never to another sender).
 */

const MAX_SIDE = 4096
const Pixel = z
  .number()
  .int()
  .min(0)
  .max(MAX_SIDE - 1)

/** What the pop-out needs to draw the editor's texture. `image` is only sent when the pixels changed. */
export const PopoutStateSchema = z
  .object({
    /** Texture pack path, null when the editor has no texture open. */
    path: z.string().max(512).nullable(),
    image: z
      .object({
        width: z.number().int().min(1).max(MAX_SIDE),
        height: z.number().int().min(1).max(MAX_SIDE),
        /** Straight RGBA8 of the whole texture (every frame of an animated strip). */
        rgba: z.custom<Uint8Array>((v) => v instanceof Uint8Array)
      })
      .strict()
      .refine((i) => i.rgba.byteLength === i.width * i.height * 4, {
        message: 'rgba must hold width x height pixels'
      })
      .optional(),
    mcmeta: z
      .string()
      .max(64 * 1024)
      .nullable(),
    /** Frame shown while editing an animation (null: the preview plays the animation). */
    editingFrame: z.number().int().min(0).max(MAX_SIDE).nullable(),
    /** Pixel hovered in the editor's 2D canvas (strip coordinates). */
    hover: z.object({ x: Pixel, y: Pixel }).strict().nullable()
  })
  .strict()
export type PopoutState = z.infer<typeof PopoutStateSchema>

/** Input from the pop-out window, in strip coordinates. */
export const PopoutInputSchema = z.discriminatedUnion('kind', [
  /** The pop-out is ready: the editor sends its full state. */
  z.object({ kind: z.literal('ready') }).strict(),
  z.object({ kind: z.literal('hover'), x: Pixel, y: Pixel }).strict(),
  z.object({ kind: z.literal('hoverEnd') }).strict(),
  z.object({ kind: z.literal('paintStart'), x: Pixel, y: Pixel, secondary: z.boolean() }).strict(),
  z.object({ kind: z.literal('paintMove'), x: Pixel, y: Pixel, connect: z.boolean() }).strict(),
  z.object({ kind: z.literal('paintEnd') }).strict()
])
export type PopoutInput = z.infer<typeof PopoutInputSchema>
