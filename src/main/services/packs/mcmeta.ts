import type { PackFormat } from '@shared/model/versions'

const decoder = new TextDecoder('utf-8')

/** Parses UTF-8 JSON (tolerates a BOM). Returns undefined when it does not parse. */
export function parseJson(data: Uint8Array | string): unknown {
  let text = typeof data === 'string' ? data : decoder.decode(data)
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Flattens a JSON text component (string, array, or { text, extra, translate... }) to plain text. */
export function textComponentToPlain(component: unknown, depth = 0): string {
  if (depth > 32 || component === null || component === undefined) return ''
  if (typeof component === 'string') return component
  if (typeof component === 'number' || typeof component === 'boolean') return String(component)
  if (Array.isArray(component))
    return component.map((c) => textComponentToPlain(c, depth + 1)).join('')
  if (isRecord(component)) {
    let text = ''
    if (typeof component.text === 'string' || typeof component.text === 'number') {
      text = String(component.text)
    } else if (typeof component.translate === 'string') {
      text = typeof component.fallback === 'string' ? component.fallback : component.translate
    } else if (typeof component.keybind === 'string') {
      text = component.keybind
    }
    if (Array.isArray(component.extra)) text += textComponentToPlain(component.extra, depth + 1)
    return text
  }
  return ''
}

/** Removes legacy "§x" formatting codes. */
export function stripFormatting(text: string): string {
  return text.replace(/§./gu, '')
}

/** Reads a pack format written as an integer, a float (69.0) or [major] / [major, minor]. */
export function parseFormatValue(value: unknown): PackFormat | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return { major: Math.floor(value), minor: 0 }
  }
  if (Array.isArray(value) && value.length >= 1 && value.length <= 2) {
    const [major, minor = 0] = value
    if (
      typeof major === 'number' &&
      typeof minor === 'number' &&
      Number.isInteger(major) &&
      Number.isInteger(minor) &&
      major >= 0 &&
      minor >= 0
    ) {
      return { major, minor }
    }
  }
  return undefined
}

/** The format a pack.mcmeta declares: `pack.pack_format` first, else `pack.min_format`. */
export function readDeclaredFormat(mcmeta: unknown): PackFormat | undefined {
  if (!isRecord(mcmeta) || !isRecord(mcmeta.pack)) return undefined
  return parseFormatValue(mcmeta.pack.pack_format) ?? parseFormatValue(mcmeta.pack.min_format)
}

/**
 * Merges a freshly built pack.mcmeta with the pack's own one: every top-level key the builder returns wins
 * (`pack` in particular), extra sections of the existing file (`language`, `filter`, `overlays`...) are kept.
 */
export function mergeMcmeta(
  built: Record<string, unknown>,
  existing: unknown
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...built }
  if (isRecord(existing)) {
    for (const [key, value] of Object.entries(existing)) {
      if (!(key in merged)) merged[key] = value
    }
  }
  return merged
}

export interface AnimationInfo {
  frameWidth: number
  frameHeight: number
  frameCount: number
  /** False when the image size is not a whole number of frames. */
  consistent: boolean
}

/**
 * Animation layout of a texture from its .png.mcmeta (null when not animated). Frames default to squares of
 * min(width, height), as in Minecraft.
 */
export function readAnimation(
  mcmeta: unknown,
  width: number,
  height: number
): AnimationInfo | null {
  if (!isRecord(mcmeta) || !isRecord(mcmeta.animation)) return null
  const anim = mcmeta.animation
  const w = typeof anim.width === 'number' && anim.width > 0 ? anim.width : undefined
  const h = typeof anim.height === 'number' && anim.height > 0 ? anim.height : undefined
  const side = Math.min(width, height)
  const frameWidth = w ?? (h !== undefined ? width : side)
  const frameHeight = h ?? (w !== undefined ? height : side)
  if (frameWidth <= 0 || frameHeight <= 0)
    return { frameWidth, frameHeight, frameCount: 0, consistent: false }
  const consistent = width % frameWidth === 0 && height % frameHeight === 0
  const frameCount = Math.floor(width / frameWidth) * Math.floor(height / frameHeight)
  return { frameWidth, frameHeight, frameCount, consistent }
}

/** Serializes JSON the way the app writes it (2-space indent, trailing newline). */
export function toJsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value, null, 2) + '\n')
}
