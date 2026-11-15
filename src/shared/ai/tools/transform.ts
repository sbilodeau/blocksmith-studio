import { z } from 'zod'
import { flipImage, resizeNearest, rotateImage, shiftImage } from '../../image'
import { defineTool, type AnyTool } from './define'

const ALL = ['editor', 'navigation', 'creation'] as const

export const rotate = defineTool({
  name: 'rotate',
  kind: 'mutate',
  scopes: ALL,
  description: `Rotate the whole texture by 90, 180 or 270 degrees.
direction: "clockwise" = right / à droite / sens horaire; "counterclockwise" = left / à gauche / sens anti-horaire.
A 90 or 270 degree turn swaps width and height. 180 is the same either way ("upside down" / "à l'envers").
Examples:
- "tourne de 90° à gauche" / "rotate it 90 degrees to the left" -> {"degrees":90,"direction":"counterclockwise"}
- "pivote-le vers la droite" / "rotate it right" -> {"degrees":90,"direction":"clockwise"}
- "mets-le à l'envers" / "turn it upside down" -> {"degrees":180,"direction":"clockwise"}
- "un quart de tour anti-horaire" / "a quarter turn counterclockwise" -> {"degrees":90,"direction":"counterclockwise"}`,
  params: z
    .object({
      degrees: z.union([z.literal(90), z.literal(180), z.literal(270)]),
      direction: z.enum(['clockwise', 'counterclockwise']).default('clockwise')
    })
    .strict(),
  describe: (a) => ({ key: 'ops.rotate', params: { degrees: a.degrees, direction: a.direction } }),
  execute: (ctx, a) => {
    const image = rotateImage(ctx.image, a.degrees, a.direction)
    return {
      image,
      result: { width: image.width, height: image.height },
      summary: `Rotated ${a.degrees} degrees ${a.direction}`
    }
  }
})

export const flip = defineTool({
  name: 'flip',
  kind: 'mutate',
  scopes: ALL,
  description: `Mirror the whole texture.
axis "horizontal" mirrors left <-> right (x' = width-1-x); "vertical" mirrors top <-> bottom (y' = height-1-y).
Examples:
- "miroir horizontal" / "retourne-le de gauche à droite" / "flip horizontally" / "mirror it left to right" -> {"axis":"horizontal"}
- "miroir vertical" / "retourne-le de haut en bas" / "flip vertically" / "flip it upside down (mirror)" -> {"axis":"vertical"}`,
  params: z.object({ axis: z.enum(['horizontal', 'vertical']) }).strict(),
  describe: (a) => ({ key: 'ops.flip', params: { axis: a.axis } }),
  execute: (ctx, a) => ({
    image: flipImage(ctx.image, a.axis),
    result: { axis: a.axis },
    summary: `Flipped ${a.axis}ly`
  })
})

export const shift = defineTool({
  name: 'shift',
  kind: 'mutate',
  scopes: ALL,
  description: `Move the whole texture content by (dx, dy) pixels: positive dx = right, negative = left; positive dy = down,
negative = up. wrap (default true): pixels leaving one edge re-enter on the opposite edge (keeps block textures
tileable); wrap false leaves the uncovered area transparent.
Examples:
- "décale de 2 pixels vers la droite" / "shift it 2 pixels right" -> {"dx":2,"dy":0,"wrap":true}
- "monte-le d'un pixel" / "move it up one pixel" -> {"dx":0,"dy":-1,"wrap":true}
- "décale de 4 vers le bas sans boucler" / "move it down 4 without wrapping" -> {"dx":0,"dy":4,"wrap":false}`,
  params: z
    .object({
      dx: z.number().int().min(-4096).max(4096),
      dy: z.number().int().min(-4096).max(4096),
      wrap: z.boolean().default(true)
    })
    .strict(),
  describe: (a) => ({
    key: a.wrap ? 'ops.shiftWrap' : 'ops.shift',
    params: { dx: a.dx, dy: a.dy }
  }),
  execute: (ctx, a) => ({
    image: shiftImage(ctx.image, a.dx, a.dy, a.wrap),
    result: { dx: a.dx, dy: a.dy, wrap: a.wrap },
    summary: `Shifted by (${a.dx}, ${a.dy})${a.wrap ? ' with wrap' : ''}`
  })
})

export const resize = defineTool({
  name: 'resize',
  kind: 'mutate',
  scopes: ['editor'],
  description: `Resize the whole texture to width x height with nearest-neighbor sampling (no smoothing, pixel art stays sharp).
Integer upscales repeat each pixel exactly. Minecraft textures are usually 16x16; resource packs also use 32x32 or 64x64.
Examples:
- "passe-la en 32x32" / "make it 32x32" -> {"width":32,"height":32}
- "double la taille" / "double the size" (16x16 texture) -> {"width":32,"height":32}`,
  params: z
    .object({
      width: z.number().int().min(1).max(1024),
      height: z.number().int().min(1).max(1024)
    })
    .strict(),
  describe: (a) => ({ key: 'ops.resize', params: { width: a.width, height: a.height } }),
  execute: (ctx, a) => ({
    image: resizeNearest(ctx.image, a.width, a.height),
    result: { width: a.width, height: a.height },
    summary: `Resized from ${ctx.image.width}x${ctx.image.height} to ${a.width}x${a.height}`
  })
})

export const TRANSFORM_TOOLS: AnyTool[] = [rotate, flip, shift, resize]
