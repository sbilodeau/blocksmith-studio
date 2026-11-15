import { z } from 'zod'
import type { RgbaImage } from '../../image'
import type { StyleBrief } from '../../model/brief'
import type { AgentKind, ToolKind } from '../types'

/**
 * What a tool runs against: the in-memory draft of the open texture (never a file), the vanilla version of that
 * texture when one exists, and the style brief as the agent currently sees it.
 */
export interface DraftContext {
  image: RgbaImage
  vanilla?: RgbaImage | null
  brief: StyleBrief
}

export interface ToolOutput {
  /** New draft image (mutate tools). Inputs are never mutated: tools clone before drawing. */
  image?: RgbaImage
  /** JSON-serializable result returned to the model. */
  result: unknown
  /** One short English line for logs, tool_result events and the conversation file. */
  summary: string
}

/** i18n key under `ops.*` plus its params, rendered by the plan UI. */
export interface ToolDescription {
  key: string
  params: Record<string, string | number>
}

/** A tool failure the model should read (returned as an error tool result, not thrown to the user). */
export class ToolError extends Error {}

export interface ToolDefinition<S extends z.ZodType = z.ZodType> {
  name: string
  kind: ToolKind
  scopes: readonly AgentKind[]
  /** English, with conventions and FR + EN phrase examples (sent to the model). */
  description: string
  params: S
  describe: (args: z.output<S>) => ToolDescription
  execute: (ctx: DraftContext, args: z.output<S>) => ToolOutput
}

/** Type-erased tool, as stored in the registry. */
export interface AnyTool {
  name: string
  kind: ToolKind
  scopes: readonly AgentKind[]
  description: string
  params: z.ZodType
  describe: (args: unknown) => ToolDescription
  execute: (ctx: DraftContext, args: unknown) => ToolOutput
}

export function defineTool<S extends z.ZodType>(def: ToolDefinition<S>): AnyTool {
  return def as unknown as AnyTool
}

// ---------- shared parameter schemas ----------

const HEX_RE = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/

/** "#rrggbb" or "#rrggbbaa". */
export const HexColor = z
  .string()
  .regex(HEX_RE)
  .describe('Hex color "#rrggbb" or "#rrggbbaa" (alpha defaults to ff; "#00000000" = transparent)')

/** Pixel coordinate (origin top-left, x right, y down). Out-of-range values are skipped or clamped. */
export const Coord = z.number().int().min(-4096).max(4096)

export const Size = z.number().int().min(1).max(4096)

export const RectSchema = z
  .object({ x: Coord, y: Coord, width: Size, height: Size })
  .strict()
  .describe('Rectangle: top-left corner (x, y) plus width and height in pixels')

export type RectArgs = z.output<typeof RectSchema>

/** Optional region limiting a color operation (clamped to the texture). */
export const RegionParam = RectSchema.optional().describe(
  'Optional rectangle limiting the operation (default: the whole texture)'
)

/** Region params for describe(): `x`, `y`, `width`, `height`. */
export function regionParams(r: RectArgs): Record<string, number> {
  return { x: r.x, y: r.y, width: r.width, height: r.height }
}

/** Lowercase "#rrggbbaa"-style display: keeps what the model sent, lowercased. */
export function colorParam(hex: string): string {
  return hex.toLowerCase()
}

/** "+20" / "-15" / "0". */
export function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n)
}
