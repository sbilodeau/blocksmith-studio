import { z } from 'zod'
import { clampRect, type RgbaImage } from '../../image'
import { RectSchema, ToolError, defineTool, regionParams, type AnyTool } from './define'
import { encodeGrid, paletteSummary } from './grid'

/** Largest area get_pixels / get_texture return in one call (128 x 128). */
export const MAX_GRID_PIXELS = 128 * 128

const GRID_FORMAT = `The result is a palette-indexed grid: {"w","h","origin":"top-left","x","y","palette":{".":"#00000000","a":"#rrggbbaa",...},"rows":["aab..",...]}
- one character per pixel, rows[y][x]; "." = transparent. With more than 62 colors, rows are arrays of "#rrggbbaa" and there is no palette.`

function gridOf(img: RgbaImage, rect?: z.output<typeof RectSchema>): ReturnType<typeof encodeGrid> {
  const area = rect ? clampRect(img, rect) : { x: 0, y: 0, width: img.width, height: img.height }
  if (!area) throw new ToolError(`The rectangle is outside the ${img.width}x${img.height} texture.`)
  if (area.width * area.height > MAX_GRID_PIXELS) {
    throw new ToolError(
      `Too many pixels (${area.width}x${area.height}); ask for a rect of at most ${MAX_GRID_PIXELS} pixels, e.g. 64x64 or 128x128.`
    )
  }
  return encodeGrid(img, rect ? area : undefined)
}

export const getPixels = defineTool({
  name: 'get_pixels',
  kind: 'read',
  scopes: ['editor', 'navigation', 'creation'],
  description: `Read the current pixels of the open texture (the draft, including the changes you already made), the whole texture or
a rectangle (x, y, width, height; origin top-left; clamped to the texture; max ${MAX_GRID_PIXELS} pixels).
Use it to inspect a region of a large texture before drawing precise details.
${GRID_FORMAT}
Examples: "regarde le coin en haut à gauche" / "look at the top-left corner" -> {"rect":{"x":0,"y":0,"width":8,"height":8}}`,
  params: z.object({ rect: RectSchema.optional() }).strict(),
  describe: (a) =>
    a.rect
      ? { key: 'ops.getPixelsRect', params: regionParams(a.rect) }
      : { key: 'ops.getPixels', params: {} },
  execute: (ctx, a) => {
    const grid = gridOf(ctx.image, a.rect)
    return { result: grid, summary: `Read ${grid.w}x${grid.h} pixels` }
  }
})

export const getPalette = defineTool({
  name: 'get_palette',
  kind: 'read',
  scopes: ['editor', 'navigation', 'creation'],
  description: `List the distinct visible colors of the open texture (draft) with their pixel counts, most used first, plus the number
of transparent pixels. Result: {"colors":[{"hex":"#rrggbbaa","count":n},...],"transparent":n}.
Examples: "quelles couleurs sont utilisées ?" / "which colors does it use?" -> {}`,
  params: z.object({}).strict(),
  describe: () => ({ key: 'ops.getPalette', params: {} }),
  execute: (ctx) => {
    const summary = paletteSummary(ctx.image)
    return { result: summary, summary: `${summary.colors.length} color(s)` }
  }
})

export const getTexture = defineTool({
  name: 'get_texture',
  kind: 'read',
  scopes: ['editor'],
  description: `Read the original VANILLA (unmodified Minecraft) version of the open texture as a grid, to compare with the current
draft or restore parts of it. source must be "vanilla". Returns an error when the texture has no vanilla version
(texture added by the pack, or a pack not based on vanilla). Optional rect as in get_pixels.
${GRID_FORMAT}
Examples: "compare avec la texture d'origine" / "compare with the original texture" -> {"source":"vanilla"}`,
  params: z
    .object({
      source: z.literal('vanilla'),
      rect: RectSchema.optional()
    })
    .strict(),
  describe: () => ({ key: 'ops.getTexture', params: { source: 'vanilla' } }),
  execute: (ctx, a) => {
    if (!ctx.vanilla) {
      throw new ToolError(
        'This texture has no vanilla version (it was added by the pack, or the pack is not based on vanilla Minecraft).'
      )
    }
    const grid = gridOf(ctx.vanilla, a.rect)
    return { result: grid, summary: `Read the vanilla texture (${grid.w}x${grid.h})` }
  }
})

export const readStyleBrief = defineTool({
  name: 'read_style_brief',
  kind: 'read',
  scopes: ['editor', 'navigation', 'creation'],
  description: `Read the pack's style brief (shared memory of all agents): theme, palette with roles, visual rules, decisions and a log of
applied requests. It is already in your instructions; call this only to see changes proposed in this conversation.
Examples: "rappelle-moi le style du pack" / "remind me of the pack style" -> {}`,
  params: z.object({}).strict(),
  describe: () => ({ key: 'ops.readStyleBrief', params: {} }),
  execute: (ctx) => ({ result: ctx.brief, summary: 'Read the style brief' })
})

export const READ_TOOLS: AnyTool[] = [getPixels, getPalette, getTexture, readStyleBrief]
