import { cropImage, type RgbaImage } from '../../image'
import { joinFrames, splitFrames } from '../../animation'
import { ToolError, type AnyTool, type DraftContext, type ToolOutput } from './define'

/**
 * Animated textures (PLAN M9): the open texture is a vertical strip of frames. Image tools get an optional `frame`
 * parameter; coordinates are inside one frame. A change without `frame` applies to every frame, a read without it
 * looks at the frame the user is editing.
 */
export interface FrameLayout {
  /** Height of one frame (frames are full-width). */
  frameHeight: number
  /** Frame the user is looking at (0-based). */
  current: number
}

const FRAME_READ_TOOLS = new Set(['get_pixels', 'get_palette', 'get_texture'])

/** True for tools that take a `frame` on animated textures: image changes and pixel reads. */
export function isFrameTool(tool: AnyTool): boolean {
  return tool.kind === 'mutate' || FRAME_READ_TOOLS.has(tool.name)
}

export function frameCount(image: { height: number }, layout: FrameLayout): number {
  return Math.max(1, Math.floor(image.height / layout.frameHeight))
}

/** Adds the `frame` property to a tool's JSON Schema. */
export function withFrameParam(
  schema: Record<string, unknown>,
  tool: AnyTool,
  count: number
): Record<string, unknown> {
  const properties = (schema['properties'] as Record<string, unknown> | undefined) ?? {}
  const description =
    tool.kind === 'mutate'
      ? `Animation frame to change, 0 to ${count - 1} (0 = first). Omit it to apply the change to EVERY frame.`
      : `Animation frame to read, 0 to ${count - 1} (0 = first). Omit it for the frame the user is editing.`
  return {
    ...schema,
    properties: {
      ...properties,
      frame: { type: 'integer', minimum: 0, maximum: count - 1, description }
    }
  }
}

/** Splits `frame` off a tool call's arguments (the tool's own schema is strict and does not know it). */
export function takeFrame(args: unknown): { frame?: unknown; rest: unknown } {
  if (typeof args !== 'object' || args === null || Array.isArray(args) || !('frame' in args)) {
    return { rest: args }
  }
  const { frame, ...rest } = args as Record<string, unknown>
  return { frame, rest }
}

/** Checks a `frame` value from the model. */
export function parseFrame(frame: unknown, count: number): number | undefined {
  if (frame === undefined || frame === null) return undefined
  if (typeof frame !== 'number' || !Number.isInteger(frame) || frame < 0 || frame >= count) {
    throw new ToolError(
      `frame must be an integer from 0 to ${count - 1} (this animation has ${count} frames).`
    )
  }
  return frame
}

function frameOf(
  img: RgbaImage | null | undefined,
  frameHeight: number,
  index: number
): RgbaImage | null {
  if (!img || img.height % frameHeight !== 0 || img.height < frameHeight) return img ?? null
  const n = img.height / frameHeight
  return cropImage(img, {
    x: 0,
    y: (index % n) * frameHeight,
    width: img.width,
    height: frameHeight
  })
}

/**
 * Runs an image tool on an animated strip: on frame `frame`, or (no frame) on every frame for a change and on the
 * current frame for a read. Changes that would resize a frame are refused (every frame keeps the same size).
 */
export function executeOnFrames(
  tool: AnyTool,
  ctx: DraftContext,
  args: unknown,
  layout: FrameLayout,
  frame: number | undefined
): ToolOutput {
  const fh = layout.frameHeight
  const frames = splitFrames(ctx.image, fh)
  if (tool.kind !== 'mutate') {
    const index = frame ?? Math.min(layout.current, frames.length - 1)
    const out = tool.execute(
      { ...ctx, image: frames[index]!, vanilla: frameOf(ctx.vanilla, fh, index) },
      args
    )
    return { ...out, summary: `${out.summary} (frame ${index})` }
  }
  const targets = frame === undefined ? frames.map((_, i) => i) : [frame]
  let first: ToolOutput | null = null
  for (const i of targets) {
    const out = tool.execute(
      { ...ctx, image: frames[i]!, vanilla: frameOf(ctx.vanilla, fh, i) },
      args
    )
    const img = out.image ?? frames[i]!
    if (img.width !== ctx.image.width || img.height !== fh) {
      throw new ToolError(
        `This change would make the frame ${img.width} x ${img.height} px: every frame of an animation keeps its size (${ctx.image.width} x ${fh}).`
      )
    }
    frames[i] = img
    first ??= out
  }
  const where = frame === undefined ? `every frame (${frames.length})` : `frame ${frame}`
  return {
    image: joinFrames(frames),
    result:
      frame === undefined
        ? { frames: 'all', count: frames.length, ...asObject(first!.result) }
        : { frame, ...asObject(first!.result) },
    summary: `${first!.summary} (${where})`
  }
}

function asObject(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : { result: v }
}
