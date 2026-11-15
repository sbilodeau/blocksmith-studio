import { z } from 'zod'
import {
  clearRect,
  cloneImage,
  drawLine,
  drawRect,
  fillRect,
  floodFill,
  imagesEqual,
  inBounds,
  parseHex,
  setPixel
} from '../../image'
import {
  Coord,
  HexColor,
  RectSchema,
  Size,
  colorParam,
  defineTool,
  regionParams,
  type AnyTool,
  type ToolDescription
} from './define'

/** Most pixels one set_pixels / erase call may carry. */
export const MAX_PIXELS_PER_CALL = 4096

const COORDS =
  'Coordinates are integers, origin (0,0) = top-left pixel, x grows right, y grows down; pixels outside the texture are skipped.'

export const setPixels = defineTool({
  name: 'set_pixels',
  kind: 'mutate',
  scopes: ['editor'],
  description: `Set individual pixels to exact colors (up to ${MAX_PIXELS_PER_CALL} per call). Best for small details: a few pixels of
highlight, an eye, a flame tip. ${COORDS} Colors are "#rrggbb" or "#rrggbbaa" ("#00000000" = transparent).
Examples:
- "mets le pixel en haut à gauche en rouge" / "make the top-left pixel red" -> {"pixels":[{"x":0,"y":0,"color":"#ff0000"}]}
- "ajoute des flammes au bout" / "add flames at the tip": several orange/yellow pixels around the tip, e.g.
  {"pixels":[{"x":7,"y":0,"color":"#ffb000"},{"x":8,"y":1,"color":"#ff6a00"}]}`,
  params: z
    .object({
      pixels: z
        .array(z.object({ x: Coord, y: Coord, color: HexColor }).strict())
        .min(1)
        .max(MAX_PIXELS_PER_CALL)
    })
    .strict(),
  describe: (a) => ({ key: 'ops.setPixels', params: { count: a.pixels.length } }),
  execute: (ctx, a) => {
    const image = cloneImage(ctx.image)
    let skipped = 0
    for (const p of a.pixels) {
      if (!inBounds(image, p.x, p.y)) skipped++
      else setPixel(image, p.x, p.y, parseHex(p.color))
    }
    const set = a.pixels.length - skipped
    return {
      image,
      result: { set, skipped },
      summary: `Set ${set} pixel(s)${skipped ? `, skipped ${skipped} outside the texture` : ''}`
    }
  }
})

export const drawLineTool = defineTool({
  name: 'draw_line',
  kind: 'mutate',
  scopes: ['editor'],
  description: `Draw a 1-pixel straight line (Bresenham, no anti-aliasing) from (x1, y1) to (x2, y2), both ends included. ${COORDS}
Examples:
- "trace une ligne noire en diagonale" / "draw a black diagonal line" (16x16) -> {"x1":0,"y1":0,"x2":15,"y2":15,"color":"#000000"}
- "une ligne blanche sur la première rangée" / "a white line along the top row" -> {"x1":0,"y1":0,"x2":15,"y2":0,"color":"#ffffff"}`,
  params: z.object({ x1: Coord, y1: Coord, x2: Coord, y2: Coord, color: HexColor }).strict(),
  describe: (a) => ({
    key: 'ops.drawLine',
    params: { x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2, color: colorParam(a.color) }
  }),
  execute: (ctx, a) => {
    const image = cloneImage(ctx.image)
    drawLine(image, { x: a.x1, y: a.y1 }, { x: a.x2, y: a.y2 }, parseHex(a.color))
    return {
      image,
      result: { ok: true },
      summary: `Drew a line from (${a.x1}, ${a.y1}) to (${a.x2}, ${a.y2}) in ${a.color}`
    }
  }
})

const RECT_FIELDS = { x: Coord, y: Coord, width: Size, height: Size, color: HexColor }

export const drawRectTool = defineTool({
  name: 'draw_rect',
  kind: 'mutate',
  scopes: ['editor'],
  description: `Draw the 1-pixel OUTLINE of a rectangle: top-left corner (x, y), width and height in pixels (clamped to the texture). ${COORDS}
Use fill_rect for a filled rectangle.
Examples:
- "encadre la texture en noir" / "draw a black border around the texture" (16x16) -> {"x":0,"y":0,"width":16,"height":16,"color":"#000000"}
- "un carré rouge de 4 pixels au centre" (contour) / "a 4-pixel red square outline in the middle" -> {"x":6,"y":6,"width":4,"height":4,"color":"#ff0000"}`,
  params: z.object(RECT_FIELDS).strict(),
  describe: (a) => ({
    key: 'ops.drawRect',
    params: { x: a.x, y: a.y, width: a.width, height: a.height, color: colorParam(a.color) }
  }),
  execute: (ctx, a) => {
    const image = cloneImage(ctx.image)
    drawRect(image, a, parseHex(a.color))
    return {
      image,
      result: { ok: true },
      summary: `Drew a ${a.width}x${a.height} rectangle outline at (${a.x}, ${a.y}) in ${a.color}`
    }
  }
})

export const fillRectTool = defineTool({
  name: 'fill_rect',
  kind: 'mutate',
  scopes: ['editor'],
  description: `Fill a rectangle with one color: top-left corner (x, y), width and height in pixels (clamped to the texture). ${COORDS}
Examples:
- "remplis le quart en haut à gauche en bleu" / "fill the top-left quarter with blue" (16x16) -> {"x":0,"y":0,"width":8,"height":8,"color":"#0000ff"}
- "une bande verte de 2 pixels en bas" / "a 2-pixel green band at the bottom" (16x16) -> {"x":0,"y":14,"width":16,"height":2,"color":"#00aa00"}`,
  params: z.object(RECT_FIELDS).strict(),
  describe: (a) => ({
    key: 'ops.fillRect',
    params: { x: a.x, y: a.y, width: a.width, height: a.height, color: colorParam(a.color) }
  }),
  execute: (ctx, a) => {
    const image = cloneImage(ctx.image)
    fillRect(image, a, parseHex(a.color))
    return {
      image,
      result: { ok: true },
      summary: `Filled a ${a.width}x${a.height} rectangle at (${a.x}, ${a.y}) with ${a.color}`
    }
  }
})

export const fill = defineTool({
  name: 'fill',
  kind: 'mutate',
  scopes: ['editor'],
  description: `Paint-bucket fill starting at pixel (x, y). ${COORDS}
tolerance (0-255, default 0): a pixel matches when no channel (alpha included) differs from the start pixel by more than this.
contiguous (default true): only the connected area (4 neighbours) is filled; false = every matching pixel of the texture.
All fully transparent pixels count as one color, so filling a transparent area fills the whole background region.
Examples:
- "remplis le fond en blanc" / "fill the background with white" (transparent corner) -> {"x":0,"y":0,"color":"#ffffff"}
- "remplace partout cette couleur" (non contigu) / "fill every pixel of that color" -> {"x":3,"y":4,"color":"#ff0000","contiguous":false}`,
  params: z
    .object({
      x: Coord,
      y: Coord,
      color: HexColor,
      tolerance: z.number().int().min(0).max(255).default(0),
      contiguous: z.boolean().default(true)
    })
    .strict(),
  describe: (a) => ({
    key: a.contiguous ? 'ops.fill' : 'ops.fillAll',
    params: { x: a.x, y: a.y, color: colorParam(a.color), tolerance: a.tolerance }
  }),
  execute: (ctx, a) => {
    const image = cloneImage(ctx.image)
    const changed = floodFill(image, a.x, a.y, parseHex(a.color), {
      tolerance: a.tolerance,
      contiguous: a.contiguous
    })
    return {
      image,
      result: { changed },
      summary: `Filled from (${a.x}, ${a.y}) with ${a.color}: ${changed} pixel(s) changed`
    }
  }
})

export const erase = defineTool({
  name: 'erase',
  kind: 'mutate',
  scopes: ['editor'],
  description: `Make pixels fully transparent: a list of pixels and/or a rectangle (at least one). ${COORDS}
Examples:
- "efface le coin en haut à droite" / "erase the top-right corner pixel" (16x16) -> {"pixels":[{"x":15,"y":0}]}
- "efface la moitié du bas" / "erase the bottom half" (16x16) -> {"rect":{"x":0,"y":8,"width":16,"height":8}}`,
  params: z
    .object({
      pixels: z
        .array(z.object({ x: Coord, y: Coord }).strict())
        .max(MAX_PIXELS_PER_CALL)
        .optional(),
      rect: RectSchema.optional()
    })
    .strict()
    .refine((a) => (a.pixels?.length ?? 0) > 0 || a.rect !== undefined, {
      message: 'Give "pixels" (non-empty) or "rect"'
    }),
  describe: (a): ToolDescription => {
    const count = a.pixels?.length ?? 0
    if (!a.rect) return { key: 'ops.erasePixels', params: { count } }
    const rect = regionParams(a.rect)
    return count
      ? { key: 'ops.erasePixelsAndRect', params: { count, ...rect } }
      : { key: 'ops.eraseRect', params: rect }
  },
  execute: (ctx, a) => {
    const image = cloneImage(ctx.image)
    if (a.rect) clearRect(image, a.rect)
    for (const p of a.pixels ?? []) setPixel(image, p.x, p.y, [0, 0, 0, 0])
    const changed = !imagesEqual(image, ctx.image)
    return {
      image,
      result: { changed },
      summary: `Erased ${a.pixels?.length ?? 0} pixel(s)${a.rect ? ` and a ${a.rect.width}x${a.rect.height} rectangle at (${a.rect.x}, ${a.rect.y})` : ''}`
    }
  }
})

export const DRAW_TOOLS: AnyTool[] = [
  setPixels,
  drawLineTool,
  drawRectTool,
  fillRectTool,
  fill,
  erase
]
