import { z } from 'zod'
import { createImage, cropImage, imagesEqual, pasteImage, type RgbaImage } from '../image'
import { emptyBrief, type StyleBrief } from '../model/brief'
import { getTool, TOOLS, type AnyTool, type ToolDescription } from '../ai/tools'

/**
 * Bulk operations (PLAN 6.7 `apply_to_all`, M5): one color or transform tool applied to many textures. Shared by
 * the manual bulk actions of the grid, the navigation agent and the worker that computes them.
 */

/** One operation: a tool of the registry and its arguments (validated by the tool's own schema). */
export const BulkOperationSchema = z
  .object({
    tool: z.string().min(1).max(40),
    args: z.record(z.string(), z.unknown()).default({})
  })
  .strict()

export type BulkOperation = z.output<typeof BulkOperationSchema>

/** Tools allowed in bulk: the mutate tools of the navigation scope (color operations and transforms). */
export function bulkTools(): AnyTool[] {
  return TOOLS.filter((t) => t.kind === 'mutate' && t.scopes.includes('navigation'))
}

export function isBulkTool(name: string): boolean {
  return bulkTools().some((t) => t.name === name)
}

export interface ParsedOperation {
  tool: AnyTool
  args: unknown
}

/** Validates an operation; returns the parsed tool and args, or an English error for the model / logs. */
export function parseOperation(op: { tool: string; args?: unknown }): ParsedOperation | string {
  const tool = getTool(op.tool)
  if (!tool || !isBulkTool(op.tool)) {
    return `"${op.tool}" cannot be applied in bulk. Allowed: ${bulkTools()
      .map((t) => t.name)
      .join(', ')}.`
  }
  const parsed = tool.params.safeParse(op.args ?? {})
  if (!parsed.success) {
    const detail = parsed.error.issues
      .slice(0, 6)
      .map((i) => `${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`)
      .join('; ')
    return `Invalid arguments for ${tool.name}: ${detail}`
  }
  return { tool, args: parsed.data }
}

/** Localized description of an operation (i18n key under `ops.*`), like the editor's plan steps. */
export function describeOperation(op: BulkOperation): ToolDescription {
  const parsed = parseOperation(op)
  return typeof parsed === 'string'
    ? { key: 'ops.unknown', params: { tool: op.tool } }
    : parsed.tool.describe(parsed.args)
}

export interface ApplyOptions {
  /**
   * Height of one animation frame when the texture is a vertical strip of frames: every operation then runs on
   * each frame separately (a rotation turns each frame, an outline does not cross frame borders).
   */
  frameHeight?: number
  brief?: StyleBrief
}

function frames(img: RgbaImage, frameHeight: number | undefined): number {
  if (!frameHeight || frameHeight <= 0 || frameHeight >= img.height) return 1
  return img.height % frameHeight === 0 ? img.height / frameHeight : 1
}

/** Runs one parsed operation on an image (per frame for animated strips). Never mutates the input. */
export function applyParsed(
  img: RgbaImage,
  op: ParsedOperation,
  options: ApplyOptions = {}
): RgbaImage {
  const brief = options.brief ?? emptyBrief()
  const n = frames(img, options.frameHeight)
  if (n === 1) return op.tool.execute({ image: img, brief }, op.args).image ?? img
  const h = img.height / n
  const parts: RgbaImage[] = []
  for (let i = 0; i < n; i++) {
    const frame = cropImage(img, { x: 0, y: i * h, width: img.width, height: h })
    parts.push(op.tool.execute({ image: frame, brief }, op.args).image ?? frame)
  }
  // A transform may change the frame size (rotation of a non-square frame); frames stay stacked vertically.
  const w = Math.max(...parts.map((p) => p.width))
  const out = createImage(
    w,
    parts.reduce((s, p) => s + p.height, 0)
  )
  let y = 0
  for (const p of parts) {
    pasteImage(out, p, 0, y)
    y += p.height
  }
  return out
}

export interface ApplyResult {
  image: RgbaImage
  /** Pixels that differ from the input (all pixels when the size changed). */
  changedPixels: number
}

function changed(a: RgbaImage, b: RgbaImage): number {
  if (a.width !== b.width || a.height !== b.height) return b.width * b.height
  let n = 0
  for (let i = 0; i < a.data.length; i += 4) {
    if (
      a.data[i] !== b.data[i] ||
      a.data[i + 1] !== b.data[i + 1] ||
      a.data[i + 2] !== b.data[i + 2] ||
      a.data[i + 3] !== b.data[i + 3]
    ) {
      n++
    }
  }
  return n
}

/** Applies operations in order. Throws an Error with the validation message for an invalid operation. */
export function applyOperations(
  img: RgbaImage,
  ops: readonly BulkOperation[],
  options: ApplyOptions = {}
): ApplyResult {
  let out = img
  for (const op of ops) {
    const parsed = parseOperation(op)
    if (typeof parsed === 'string') throw new Error(parsed)
    out = applyParsed(out, parsed, options)
  }
  return { image: out, changedPixels: imagesEqual(img, out) ? 0 : changed(img, out) }
}

/** Frame height of a texture entry (`height / frameCount`), or undefined when it is not animated. */
export function frameHeightOf(entry: {
  height: number
  animated?: boolean
  frameCount?: number
}): number | undefined {
  if (!entry.animated || !entry.frameCount || entry.frameCount < 2) return undefined
  const h = entry.height / entry.frameCount
  return Number.isInteger(h) ? h : undefined
}
