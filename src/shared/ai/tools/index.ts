/**
 * AI tool registry (PLAN 6.7). Tools are defined once with a zod schema; the JSON Schema sent to providers is
 * generated from it. Main executes them against an in-memory draft; the renderer uses `describe()` to show plan
 * steps through i18n keys under `ops.*`.
 */
import { z } from 'zod'
import type { AgentKind, ToolSpec } from '../types'
import type { AnyTool } from './define'
import { TRANSFORM_TOOLS } from './transform'
import { DRAW_TOOLS } from './draw'
import { COLOR_TOOLS } from './color'
import { READ_TOOLS } from './read'
import { MEMORY_TOOLS } from './memory'
import { isFrameTool, withFrameParam } from './frames'

export {
  defineTool,
  ToolError,
  HexColor,
  RectSchema,
  type AnyTool,
  type DraftContext,
  type ToolDefinition,
  type ToolDescription,
  type ToolOutput
} from './define'
export { encodeGrid, paletteSummary, GRID_CHARS, TRANSPARENT_HEX, type PaletteGrid } from './grid'
export { MAX_PIXELS_PER_CALL } from './draw'
export { MAX_GRID_PIXELS } from './read'
export {
  executeOnFrames,
  frameCount,
  isFrameTool,
  parseFrame,
  takeFrame,
  withFrameParam,
  type FrameLayout
} from './frames'

export const TOOLS: readonly AnyTool[] = [
  ...TRANSFORM_TOOLS,
  ...DRAW_TOOLS,
  ...COLOR_TOOLS,
  ...READ_TOOLS,
  ...MEMORY_TOOLS
]

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]))

export function getTool(name: string): AnyTool | undefined {
  return BY_NAME.get(name)
}

export function toolsForScope(scope: AgentKind): AnyTool[] {
  return TOOLS.filter((t) => t.scopes.includes(scope))
}

/** JSON Schema of a tool's parameters (input side: fields with defaults are optional), without `$schema`. */
export function toolJsonSchema(tool: AnyTool): Record<string, unknown> {
  const schema = z.toJSONSchema(tool.params, { io: 'input' }) as Record<string, unknown>
  delete schema['$schema']
  return schema
}

/**
 * Tool definitions sent to the model for an agent scope. `frames`: the open texture is an animation with that many
 * frames, so image tools get a `frame` parameter.
 */
export function toolSpecs(scope: AgentKind, options: { frames?: number } = {}): ToolSpec[] {
  const frames = options.frames
  return toolsForScope(scope).map((t) => ({
    name: t.name,
    description: t.description,
    parameters:
      frames && isFrameTool(t) ? withFrameParam(toolJsonSchema(t), t, frames) : toolJsonSchema(t)
  }))
}
