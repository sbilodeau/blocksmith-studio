import { z } from 'zod'
import {
  adjustBrightness,
  adjustSaturation,
  applyPalette,
  cloneImage,
  hueShift,
  outline,
  parseHex,
  replaceColor
} from '../../image'
import {
  HexColor,
  RegionParam,
  colorParam,
  defineTool,
  regionParams,
  signed,
  type AnyTool,
  type RectArgs,
  type ToolDescription
} from './define'

const ALL = ['editor', 'navigation', 'creation'] as const

const REGION_NOTE =
  'region (optional) = rectangle {x, y, width, height} with origin top-left; default = the whole texture.'

function withRegion(
  key: string,
  params: Record<string, string | number>,
  region?: RectArgs
): ToolDescription {
  return region
    ? { key: `${key}Region`, params: { ...params, ...regionParams(region) } }
    : { key, params }
}

function countChanged(
  before: { data: Uint8ClampedArray },
  after: { data: Uint8ClampedArray }
): number {
  let n = 0
  for (let i = 0; i < before.data.length; i += 4) {
    if (
      before.data[i] !== after.data[i] ||
      before.data[i + 1] !== after.data[i + 1] ||
      before.data[i + 2] !== after.data[i + 2] ||
      before.data[i + 3] !== after.data[i + 3]
    ) {
      n++
    }
  }
  return n
}

export const replaceColorTool = defineTool({
  name: 'replace_color',
  kind: 'mutate',
  scopes: ALL,
  description: `Replace every pixel of one color with another color, everywhere in the texture.
tolerance (0-255, default 0): also replaces pixels whose channels (alpha included) are all within this distance of "from".
Colors are "#rrggbb" or "#rrggbbaa".
Examples:
- "remplace le gris par du bleu" / "replace the gray with blue" -> {"from":"#7f7f7f","to":"#3050c0"}
- "change tous les rouges proches en orange" / "turn all the near-red pixels orange" -> {"from":"#c00000","to":"#ff8000","tolerance":40}`,
  params: z
    .object({
      from: HexColor,
      to: HexColor,
      tolerance: z.number().int().min(0).max(255).default(0)
    })
    .strict(),
  describe: (a) => ({
    key: 'ops.replaceColor',
    params: { from: colorParam(a.from), to: colorParam(a.to), tolerance: a.tolerance }
  }),
  execute: (ctx, a) => {
    const image = cloneImage(ctx.image)
    const changed = replaceColor(image, parseHex(a.from), parseHex(a.to), a.tolerance)
    return {
      image,
      result: { changed },
      summary: `Replaced ${a.from} with ${a.to}: ${changed} pixel(s) changed`
    }
  }
})

export const applyPaletteTool = defineTool({
  name: 'apply_palette',
  kind: 'mutate',
  scopes: ALL,
  description: `Remap every visible pixel to the nearest color of a palette (Euclidean RGB distance; each pixel keeps its own
alpha; transparent pixels untouched). Use it to make a texture match the style brief palette. ${REGION_NOTE}
Examples:
- "applique la palette du brief" / "apply the style brief palette" -> {"palette":["#3b2a1e","#6b4a2e","#a07040"]}
- "limite le haut à ces 3 couleurs" / "limit the top half to these 3 colors" (16x16) -> {"palette":["#000000","#808080","#ffffff"],"region":{"x":0,"y":0,"width":16,"height":8}}`,
  params: z
    .object({
      palette: z.array(HexColor).min(1).max(64),
      region: RegionParam
    })
    .strict(),
  describe: (a) => withRegion('ops.applyPalette', { count: a.palette.length }, a.region),
  execute: (ctx, a) => {
    const image = cloneImage(ctx.image)
    applyPalette(image, a.palette.map(parseHex), a.region)
    const changed = countChanged(ctx.image, image)
    return {
      image,
      result: { changed },
      summary: `Applied a ${a.palette.length}-color palette: ${changed} pixel(s) changed`
    }
  }
})

export const hueShiftTool = defineTool({
  name: 'hue_shift',
  kind: 'mutate',
  scopes: ALL,
  description: `Rotate the hue of visible pixels by degrees (-360..360; HSV, saturation and value kept, grays unchanged).
Red +120 = green, +240 (or -120) = blue; small values (10-40) nudge colors. ${REGION_NOTE}
Examples:
- "rends-le plus vert" (from red) / "make it greener" (from red) -> {"degrees":120}
- "décale un peu les teintes vers le bleu" / "shift the hues a bit toward blue" -> {"degrees":30}
- "change le haut en violet" / "make the top part purple" -> {"degrees":-60,"region":{"x":0,"y":0,"width":16,"height":8}}`,
  params: z
    .object({
      degrees: z.number().min(-360).max(360),
      region: RegionParam
    })
    .strict(),
  describe: (a) => withRegion('ops.hueShift', { degrees: signed(a.degrees) }, a.region),
  execute: (ctx, a) => {
    const image = cloneImage(ctx.image)
    hueShift(image, a.degrees, a.region)
    const changed = countChanged(ctx.image, image)
    return {
      image,
      result: { changed },
      summary: `Shifted hue by ${signed(a.degrees)} degrees: ${changed} pixel(s) changed`
    }
  }
})

export const saturationTool = defineTool({
  name: 'saturation',
  kind: 'mutate',
  scopes: ALL,
  description: `Change color saturation of visible pixels (HSL). delta in -1..1: -1 = fully gray, -0.3 = 30% less saturated,
+0.3 = moves 30% of the way toward full saturation; hue and lightness kept. ${REGION_NOTE}
Examples:
- "rends les couleurs plus vives" / "make the colors more vivid" -> {"delta":0.3}
- "désature-le complètement" / "make it grayscale" -> {"delta":-1}
- "un peu plus terne" / "a bit duller" -> {"delta":-0.2}`,
  params: z
    .object({
      delta: z.number().min(-1).max(1),
      region: RegionParam
    })
    .strict(),
  describe: (a) =>
    withRegion('ops.saturation', { percent: signed(Math.round(a.delta * 100)) }, a.region),
  execute: (ctx, a) => {
    const image = cloneImage(ctx.image)
    adjustSaturation(image, a.delta, a.region)
    const changed = countChanged(ctx.image, image)
    return {
      image,
      result: { changed },
      summary: `Changed saturation by ${signed(a.delta)}: ${changed} pixel(s) changed`
    }
  }
})

export const brightnessTool = defineTool({
  name: 'brightness',
  kind: 'mutate',
  scopes: ALL,
  description: `Change the brightness (HSL lightness) of visible pixels. delta in -1..1: +0.2 = 20% of the way toward white,
-0.2 = 20% darker, -1 = black, +1 = white; hue and saturation kept. ${REGION_NOTE}
Examples:
- "éclaircis-le un peu" / "make it a bit lighter" -> {"delta":0.15}
- "assombris la moitié du bas" / "darken the bottom half" (16x16) -> {"delta":-0.25,"region":{"x":0,"y":8,"width":16,"height":8}}`,
  params: z
    .object({
      delta: z.number().min(-1).max(1),
      region: RegionParam
    })
    .strict(),
  describe: (a) =>
    withRegion('ops.brightness', { percent: signed(Math.round(a.delta * 100)) }, a.region),
  execute: (ctx, a) => {
    const image = cloneImage(ctx.image)
    adjustBrightness(image, a.delta, a.region)
    const changed = countChanged(ctx.image, image)
    return {
      image,
      result: { changed },
      summary: `Changed brightness by ${signed(a.delta)}: ${changed} pixel(s) changed`
    }
  }
})

export const outlineTool = defineTool({
  name: 'outline',
  kind: 'mutate',
  scopes: ALL,
  description: `Draw a 1-pixel outline around the visible shape (useful for items and sprites with a transparent background).
mode "outside": transparent pixels touching the shape (4 neighbours) become the color (the shape grows by 1 pixel);
mode "inside": the shape's own edge pixels (touching transparency or the texture border) become the color.
Examples:
- "ajoute un contour noir" / "add a black outline" -> {"color":"#000000","mode":"outside"}
- "assombris le bord de l'objet" / "darken the item's edge pixels" -> {"color":"#202020","mode":"inside"}`,
  params: z
    .object({
      color: HexColor,
      mode: z.enum(['inside', 'outside']).default('outside')
    })
    .strict(),
  describe: (a) => ({ key: 'ops.outline', params: { color: colorParam(a.color), mode: a.mode } }),
  execute: (ctx, a) => {
    const image = cloneImage(ctx.image)
    outline(image, parseHex(a.color), a.mode)
    const changed = countChanged(ctx.image, image)
    return {
      image,
      result: { changed },
      summary: `Outlined (${a.mode}) in ${a.color}: ${changed} pixel(s) changed`
    }
  }
})

export const COLOR_TOOLS: AnyTool[] = [
  replaceColorTool,
  applyPaletteTool,
  hueShiftTool,
  saturationTool,
  brightnessTool,
  outlineTool
]
