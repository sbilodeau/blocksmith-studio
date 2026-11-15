import type { RgbaImage } from '@shared/image'

/** Animation of a strip texture as described by its .png.mcmeta (Minecraft format). */
export interface AnimationInfo {
  frameHeight: number
  /** Sequence of [frame index, duration in ms]. */
  sequence: Array<[number, number]>
  totalMs: number
}

const TICK_MS = 50

/**
 * Parses `{"animation": {"frametime": 2, "frames": [0, 1, {"index": 2, "time": 4}], "height": 16}}`.
 * Frames default to every frame of the strip in order; frame height defaults to the texture width (square frames).
 * Returns null when the texture is not animated.
 */
export function parseAnimation(mcmeta: string | null, image: RgbaImage): AnimationInfo | null {
  if (!mcmeta) return null
  let anim: Record<string, unknown>
  try {
    const parsed = JSON.parse(mcmeta) as { animation?: Record<string, unknown> }
    if (!parsed.animation || typeof parsed.animation !== 'object') return null
    anim = parsed.animation
  } catch {
    return null
  }
  const frameHeight = typeof anim['height'] === 'number' ? anim['height'] : image.width
  if (frameHeight <= 0 || image.height < frameHeight) return null
  const count = Math.floor(image.height / frameHeight)
  const frametime =
    typeof anim['frametime'] === 'number' && anim['frametime'] > 0 ? anim['frametime'] : 1
  const sequence: Array<[number, number]> = []
  const frames = Array.isArray(anim['frames']) ? anim['frames'] : null
  if (frames && frames.length) {
    for (const f of frames) {
      if (typeof f === 'number') sequence.push([f % count, frametime * TICK_MS])
      else if (f && typeof f === 'object' && typeof (f as { index?: unknown }).index === 'number') {
        const o = f as { index: number; time?: number }
        sequence.push([
          o.index % count,
          (typeof o.time === 'number' ? o.time : frametime) * TICK_MS
        ])
      }
    }
  }
  if (!sequence.length) for (let i = 0; i < count; i++) sequence.push([i, frametime * TICK_MS])
  return { frameHeight, sequence, totalMs: sequence.reduce((s, [, d]) => s + d, 0) }
}

/** Frame index to show at `timeMs` (loops). */
export function frameAt(info: AnimationInfo, timeMs: number): number {
  if (info.totalMs <= 0) return 0
  let t = timeMs % info.totalMs
  for (const [index, duration] of info.sequence) {
    if (t < duration) return index
    t -= duration
  }
  return info.sequence[0][0]
}
