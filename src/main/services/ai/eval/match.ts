import { z } from 'zod'
import type { ToolCall } from '@shared/ai/types'

/**
 * FR/EN evaluation cases (resources/data/ai-eval/phrases.json) and the tolerant matcher that decides whether the
 * tool calls a model produced satisfy a case. PLAN 6.8 / 9.4.
 *
 * An expectation is a list of matchers; each must be satisfied by at least one call:
 *   { tool: 'rotate', args: { degrees: 90, direction: 'counterclockwise' } }
 *   { anyTool: ['hue_shift', 'replace_color'] }
 *   { anyOf: [matcher, matcher] }
 * Arg keys are dot paths ('pixels.0.x', 'patch.theme'). Arg values are literals or predicates:
 *   { color: 'red' | 'green' | 'blue' | 'yellow' | 'black' | 'white' | 'transparent' }  (hex compared by hue/lightness)
 *   { gt, gte, lt, lte }  numeric ranges
 *   { containsAny: [...] } / { containsAll: [...] }  case-insensitive on strings or arrays (of strings or {hex})
 */

const Predicate = z.union([
  z
    .object({ color: z.enum(['red', 'green', 'blue', 'yellow', 'black', 'white', 'transparent']) })
    .strict(),
  z
    .object({
      gt: z.number().optional(),
      gte: z.number().optional(),
      lt: z.number().optional(),
      lte: z.number().optional()
    })
    .strict(),
  z.object({ containsAny: z.array(z.string()) }).strict(),
  z.object({ containsAll: z.array(z.string()) }).strict()
])

const ArgValue = z.union([z.string(), z.number(), z.boolean(), Predicate])

export interface Matcher {
  tool?: string
  anyTool?: string[]
  anyOf?: Matcher[]
  args?: Record<string, z.infer<typeof ArgValue>>
}

const MatcherSchema: z.ZodType<Matcher> = z.lazy(() =>
  z
    .object({
      tool: z.string().optional(),
      anyTool: z.array(z.string()).optional(),
      anyOf: z.array(MatcherSchema).optional(),
      args: z.record(z.string(), ArgValue).optional()
    })
    .strict()
)

export const EvalCaseSchema = z.object({
  id: z.string(),
  context: z.literal('editor'),
  fixture: z.string(),
  fr: z.string(),
  en: z.string(),
  expect: z.array(MatcherSchema).min(1)
})
export type EvalCase = z.infer<typeof EvalCaseSchema>

export const EvalFileSchema = z.object({
  schemaVersion: z.literal(1),
  description: z.string().optional(),
  cases: z.array(EvalCaseSchema)
})

function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj
  for (const key of path.split('.')) {
    if (cur === null || cur === undefined) return undefined
    cur = (cur as Record<string, unknown>)[key]
  }
  return cur
}

function parseHexColor(value: unknown): [number, number, number, number] | null {
  if (typeof value !== 'string') return null
  const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(value.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, m[2] ? parseInt(m[2], 16) : 255]
}

/** Loose color-name check on a hex color (hue for chromatic colors, lightness for black/white). */
export function colorIs(value: unknown, name: string): boolean {
  const c = parseHexColor(value)
  if (!c) return false
  const [r, g, b, a] = c
  if (name === 'transparent') return a === 0
  if (a < 128) return false
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const light = (max + min) / 2 / 255
  const sat = max === min ? 0 : (max - min) / 255
  if (name === 'black') return light < 0.2
  if (name === 'white') return light > 0.85 && sat < 0.2
  if (sat < 0.25) return false
  let h = 0
  if (max === r) h = ((g - b) / (max - min)) * 60
  else if (max === g) h = (2 + (b - r) / (max - min)) * 60
  else h = (4 + (r - g) / (max - min)) * 60
  if (h < 0) h += 360
  const ranges: Record<string, Array<[number, number]>> = {
    red: [
      [0, 20],
      [335, 360]
    ],
    yellow: [[40, 70]],
    green: [[75, 165]],
    blue: [[190, 260]]
  }
  return (ranges[name] ?? []).some(([lo, hi]) => h >= lo && h <= hi)
}

function asStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value.toLowerCase()]
  if (Array.isArray(value)) {
    return value.map((v) =>
      typeof v === 'string'
        ? v.toLowerCase()
        : typeof v === 'object' && v && 'hex' in v
          ? String((v as { hex: unknown }).hex).toLowerCase()
          : JSON.stringify(v).toLowerCase()
    )
  }
  return value === undefined ? [] : [JSON.stringify(value).toLowerCase()]
}

function valueMatches(actual: unknown, expected: z.infer<typeof ArgValue>): boolean {
  if (typeof expected !== 'object' || expected === null) {
    if (typeof expected === 'number')
      return typeof actual === 'number' && Math.abs(actual - expected) < 1e-6
    if (typeof expected === 'string')
      return typeof actual === 'string' && actual.toLowerCase() === expected.toLowerCase()
    return actual === expected
  }
  if ('color' in expected) return colorIs(actual, expected.color)
  if ('containsAny' in expected) {
    const hay = asStrings(actual)
    return expected.containsAny.some((needle) => hay.some((h) => h.includes(needle.toLowerCase())))
  }
  if ('containsAll' in expected) {
    const hay = asStrings(actual)
    return expected.containsAll.every((needle) => hay.some((h) => h.includes(needle.toLowerCase())))
  }
  if (typeof actual !== 'number') return false
  const r = expected as { gt?: number; gte?: number; lt?: number; lte?: number }
  return (
    (r.gt === undefined || actual > r.gt) &&
    (r.gte === undefined || actual >= r.gte) &&
    (r.lt === undefined || actual < r.lt) &&
    (r.lte === undefined || actual <= r.lte)
  )
}

export function callMatches(call: ToolCall, m: Matcher): boolean {
  if (m.anyOf) return m.anyOf.some((sub) => callMatches(call, sub))
  if (m.anyTool && !m.anyTool.includes(call.name)) return false
  if (m.tool && call.name !== m.tool) return false
  for (const [path, expected] of Object.entries(m.args ?? {})) {
    if (!valueMatches(getPath(call.args, path), expected)) return false
  }
  return true
}

export interface MatchResult {
  pass: boolean
  /** Index of each expectation's first matching call, or -1. */
  satisfied: number[]
}

/** Every matcher must be satisfied by some call (order is not enforced). */
export function matchCalls(calls: ToolCall[], expect: Matcher[]): MatchResult {
  const satisfied = expect.map((m) => calls.findIndex((c) => callMatches(c, m)))
  return { pass: satisfied.every((i) => i >= 0), satisfied }
}
