import {
  findNodeAtLocation,
  getNodeValue,
  parseTree,
  printParseErrorCode,
  type Node,
  type ParseError
} from 'jsonc-parser'
import type { DataKind } from './paths'
import { validateData, type DataContext, type DataIssue } from './schemas'

/** A data issue placed in the file text (offsets in UTF-16 code units, as in the editor). */
export interface LocatedIssue extends DataIssue {
  from: number
  to: number
}

export interface TextCheck {
  /** Parsed value; undefined when the text is not valid JSON. */
  value?: unknown
  issues: LocatedIssue[]
  errors: number
  warnings: number
}

/** Objects and arrays longer than this are marked by their key (or first character), not as a whole. */
const LONG_NODE = 80

/**
 * Range of the value at `path`. A missing key marks its parent object; a long object or array marks the key that
 * holds it, so the editor does not underline half the file.
 */
function rangeOf(root: Node, path: Array<string | number>): { from: number; to: number } {
  for (let n = path.length; n >= 0; n--) {
    const node = findNodeAtLocation(root, path.slice(0, n))
    if (!node) continue
    const long = (node.type === 'object' || node.type === 'array') && node.length > LONG_NODE
    const missing = n < path.length
    if (long || missing) {
      const key = node.parent?.type === 'property' ? node.parent.children?.[0] : undefined
      if (key) return { from: key.offset, to: key.offset + key.length }
      return { from: node.offset, to: node.offset + 1 }
    }
    return { from: node.offset, to: node.offset + node.length }
  }
  return { from: 0, to: 0 }
}

/** jsonc-parser error code -> i18n key under `data.syntax.*` ("PropertyNameExpected" -> "propertyNameExpected"). */
function syntaxCode(error: ParseError): string {
  const name = printParseErrorCode(error.error)
  return name.charAt(0).toLowerCase() + name.slice(1)
}

/**
 * Checks the text of a data file: strict JSON syntax (no comments, no trailing commas: Minecraft rejects them), then
 * the kind's schema. Function files (.mcfunction) are plain text and never have issues.
 */
export function checkDataText(
  text: string,
  kind: DataKind,
  ctx: DataContext = {},
  registry?: string
): TextCheck {
  if (kind === 'function') return { issues: [], errors: 0, warnings: 0 }
  const errors: ParseError[] = []
  const root = parseTree(text, errors, { disallowComments: true, allowTrailingComma: false })
  if (errors.length > 0 || !root) {
    const issues: LocatedIssue[] = (
      errors.length ? errors : [{ error: 4, offset: 0, length: 0 }]
    ).map((e) => ({
      severity: 'error',
      code: 'syntax',
      params: { error: syntaxCode(e as ParseError) },
      path: [],
      from: e.offset,
      to: e.offset + Math.max(e.length, 1)
    }))
    return { issues, errors: issues.length, warnings: 0 }
  }
  const value: unknown = getNodeValue(root)
  const issues = validateData(kind, value, ctx, registry).map((issue) => ({
    ...issue,
    ...rangeOf(root, issue.path)
  }))
  return {
    value,
    issues,
    errors: issues.filter((i) => i.severity === 'error').length,
    warnings: issues.filter((i) => i.severity === 'warning').length
  }
}

/** Pretty JSON as the app writes it: 2 spaces, final newline. */
export function formatJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

/** 1-based line of an offset (for issue lists). */
export function lineOf(text: string, offset: number): number {
  let line = 1
  for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) line++
  return line
}
