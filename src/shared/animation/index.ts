import { cloneImage, createImage, cropImage, pasteImage, type RgbaImage } from '../image'

/**
 * Animated textures (PLAN M9): a `.png.mcmeta` "animation" section and the vertical strip of frames it describes.
 * Pure functions shared by the editor (renderer), the agent runtime (main) and tests.
 *
 * Format (Minecraft Java):
 *   { "animation": { "frametime": 2, "interpolate": true, "frames": [0, 1, { "index": 2, "time": 4 }],
 *                    "width": 16, "height": 16 } }
 * - frametime: ticks per frame (1 tick = 50 ms), default 1.
 * - frames: playback order; entries are a frame index or { index, time }. Default: every frame in strip order.
 * - width / height: frame size. Default: both missing -> square frames of min(image width, image height); only one
 *   given -> the other is the image's full size.
 */

export const TICK_MS = 50
/** Longest frame duration the editor accepts, in ticks (about 10 minutes). */
export const MAX_FRAME_TICKS = 12_000
/** Most frames the editor works with (GIF import is capped to this). */
export const MAX_FRAMES = 256

export interface FrameRef {
  index: number
  /** Ticks; missing = the animation's frametime. */
  time?: number
}

export interface AnimationMeta {
  frametime: number
  interpolate: boolean
  /** Explicit playback order, or null for every frame in strip order. */
  frames: FrameRef[] | null
  width?: number
  height?: number
  /** Other keys of the "animation" object, written back unchanged. */
  extra: Record<string, unknown>
}

/** A whole .png.mcmeta file: its animation (null when not animated) and every other top-level section. */
export interface McmetaDoc {
  animation: AnimationMeta | null
  rest: Record<string, unknown>
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function positiveInt(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : undefined
}

export function defaultAnimation(): AnimationMeta {
  return { frametime: 1, interpolate: false, frames: null, extra: {} }
}

/** Parses a .png.mcmeta text. Returns null when it is missing or not a JSON object. */
export function parseMcmeta(text: string | null | undefined): McmetaDoc | null {
  if (!text) return null
  let json: unknown
  try {
    json = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
  } catch {
    return null
  }
  if (!isRecord(json)) return null
  const { animation: raw, ...rest } = json
  if (!isRecord(raw)) return { animation: null, rest: raw === undefined ? rest : json }
  const { frametime, interpolate, frames, width, height, ...extra } = raw
  const anim: AnimationMeta = {
    frametime: positiveInt(frametime) ?? 1,
    interpolate: interpolate === true,
    frames: null,
    extra
  }
  const w = positiveInt(width)
  const h = positiveInt(height)
  if (w) anim.width = w
  if (h) anim.height = h
  if (Array.isArray(frames)) {
    const list: FrameRef[] = []
    for (const f of frames) {
      if (typeof f === 'number' && Number.isInteger(f) && f >= 0) list.push({ index: f })
      else if (isRecord(f) && typeof f['index'] === 'number' && Number.isInteger(f['index'])) {
        const ref: FrameRef = { index: f['index'] }
        const time = positiveInt(f['time'])
        if (time) ref.time = time
        if (ref.index >= 0) list.push(ref)
      }
    }
    if (list.length) anim.frames = list
  }
  return { animation: anim, rest }
}

/** Frame size of an animated image (Minecraft's rules), or null when the image is smaller than one frame. */
export function frameSize(
  anim: AnimationMeta,
  image: { width: number; height: number }
): { width: number; height: number; count: number } | null {
  let width: number
  let height: number
  if (anim.width === undefined && anim.height === undefined) {
    width = height = Math.min(image.width, image.height)
  } else {
    width = anim.width ?? image.width
    height = anim.height ?? image.height
  }
  if (width <= 0 || height <= 0 || width > image.width || height > image.height) return null
  const count = Math.floor(image.width / width) * Math.floor(image.height / height)
  return count > 0 ? { width, height, count } : null
}

/**
 * Frame height when the image is a vertical strip of full-width frames (the layout the editor edits frame by
 * frame), else null (not animated, or frames laid out in a grid).
 */
export function stripFrameHeight(
  anim: AnimationMeta | null,
  image: { width: number; height: number }
): number | null {
  if (!anim) return null
  const size = frameSize(anim, image)
  if (!size || size.width !== image.width || image.height % size.height !== 0) return null
  return size.height
}

/** True when the playback order is every frame once in strip order with no own durations (= no "frames" key). */
export function isPlainOrder(frames: readonly FrameRef[] | null, count: number): boolean {
  if (!frames) return true
  return frames.length === count && frames.every((f, i) => f.index === i && f.time === undefined)
}

/** Drops redundant data: per-frame times equal to frametime, and a "frames" list that is the default order. */
export function normalizeAnimation(anim: AnimationMeta, count: number): AnimationMeta {
  let frames = anim.frames
    ? anim.frames
        .filter((f) => f.index < count)
        .map((f) =>
          f.time === undefined || f.time === anim.frametime ? { index: f.index } : { ...f }
        )
    : null
  if (frames && (frames.length === 0 || isPlainOrder(frames, count))) frames = null
  return { ...anim, frames }
}

/**
 * Writes a .png.mcmeta text (2-space JSON, trailing newline), or null when nothing is left to write.
 * `frame` is the edited frame size: a non-square frame needs "height" (Minecraft would cut square frames otherwise).
 */
export function serializeMcmeta(
  doc: McmetaDoc | null,
  frame?: { width: number; height: number; count: number }
): string | null {
  if (!doc) return null
  const out: Record<string, unknown> = { ...doc.rest }
  if (doc.animation) {
    const anim = frame ? normalizeAnimation(doc.animation, frame.count) : doc.animation
    const a: Record<string, unknown> = {}
    if (anim.frametime !== 1) a['frametime'] = anim.frametime
    if (anim.interpolate) a['interpolate'] = true
    if (anim.frames) {
      a['frames'] = anim.frames.map((f) =>
        f.time === undefined ? f.index : { index: f.index, time: f.time }
      )
    }
    let width = anim.width
    let height = anim.height
    if (frame) {
      // Keep the keys the file had (updated); add "height" when Minecraft's defaults would cut other frames.
      if (width !== undefined) width = frame.width
      if (height !== undefined) height = frame.height
      const strip = { width: frame.width, height: frame.height * frame.count }
      const cut = frameSize({ ...anim, width, height }, strip)
      if (!cut || cut.width !== frame.width || cut.height !== frame.height) height = frame.height
    }
    if (width !== undefined) a['width'] = width
    if (height !== undefined) a['height'] = height
    out['animation'] = { ...a, ...anim.extra }
  }
  if (Object.keys(out).length === 0) return null
  return `${JSON.stringify(out, null, 2)}\n`
}

// ---------- frames ----------

/** Cuts a vertical strip into frames of `frameHeight` (copies). */
export function splitFrames(strip: RgbaImage, frameHeight: number): RgbaImage[] {
  const n = Math.max(1, Math.floor(strip.height / frameHeight))
  const out: RgbaImage[] = []
  for (let i = 0; i < n; i++) {
    out.push(
      cropImage(strip, { x: 0, y: i * frameHeight, width: strip.width, height: frameHeight })
    )
  }
  return out
}

/** Stacks frames vertically (all frames must share the first frame's width; narrower ones are left-aligned). */
export function joinFrames(frames: readonly RgbaImage[]): RgbaImage {
  if (frames.length === 1) return cloneImage(frames[0]!)
  const width = Math.max(...frames.map((f) => f.width))
  const out = createImage(
    width,
    frames.reduce((s, f) => s + f.height, 0)
  )
  let y = 0
  for (const f of frames) {
    pasteImage(out, f, 0, y)
    y += f.height
  }
  return out
}

// ---------- structural edits (keep the playback order pointing at the same images) ----------

/** A frame was inserted at strip position `at`; `copyOf` = the frame it duplicates (it then follows that frame in playback). */
export function insertFrame(anim: AnimationMeta, at: number, copyOf?: number): AnimationMeta {
  if (!anim.frames) return { ...anim }
  const shifted = anim.frames.map((f) => (f.index >= at ? { ...f, index: f.index + 1 } : { ...f }))
  const after = copyOf === undefined ? at - 1 : copyOf >= at ? copyOf + 1 : copyOf
  const frames: FrameRef[] = []
  let inserted = false
  for (const f of shifted) {
    frames.push(f)
    if (f.index === after) {
      frames.push(
        copyOf !== undefined && f.time !== undefined ? { index: at, time: f.time } : { index: at }
      )
      inserted = true
    }
  }
  if (!inserted) {
    if (at === 0) frames.unshift({ index: 0 })
    else frames.push({ index: at })
  }
  return { ...anim, frames }
}

export function removeFrame(anim: AnimationMeta, at: number): AnimationMeta {
  if (!anim.frames) return { ...anim }
  const frames = anim.frames
    .filter((f) => f.index !== at)
    .map((f) => (f.index > at ? { ...f, index: f.index - 1 } : { ...f }))
  return { ...anim, frames: frames.length ? frames : null }
}

/**
 * Frame `from` moved to strip position `to`. A plain order (each frame once, in strip order) follows the new strip
 * order, durations staying with their images; a custom order keeps playing the same images.
 */
export function moveFrame(
  anim: AnimationMeta,
  from: number,
  to: number,
  count: number
): AnimationMeta {
  if (!anim.frames || from === to) return { ...anim }
  const order = Array.from({ length: count }, (_, i) => i)
  const [moved] = order.splice(from, 1)
  order.splice(to, 0, moved!)
  // order[newIndex] = oldIndex
  const newIndexOf = new Map(order.map((old, i) => [old, i]))
  const remapped = anim.frames.map((f) => ({ ...f, index: newIndexOf.get(f.index) ?? f.index }))
  const simple = anim.frames.length === count && anim.frames.every((f, i) => f.index === i)
  return { ...anim, frames: simple ? remapped.sort((a, b) => a.index - b.index) : remapped }
}

/** Sets the duration of every playback entry of frame `index` (null = back to frametime). */
export function setFrameTime(
  anim: AnimationMeta,
  index: number,
  ticks: number | null,
  count: number
): AnimationMeta {
  const base = anim.frames ?? Array.from({ length: count }, (_, i) => ({ index: i }))
  const frames = base.map((f) => {
    if (f.index !== index) return { ...f }
    return ticks === null ? { index: f.index } : { index: f.index, time: ticks }
  })
  return normalizeAnimation({ ...anim, frames }, count)
}

/** Duration of frame `index` in ticks (its first playback entry, else frametime). */
export function frameTicks(anim: AnimationMeta, index: number): number {
  return anim.frames?.find((f) => f.index === index)?.time ?? anim.frametime
}

/**
 * Animation for imported frames with their own delays in ms (GIF): the most common delay becomes frametime and
 * other frames get their own time.
 */
export function animationFromDelays(
  delaysMs: readonly number[],
  base?: AnimationMeta
): AnimationMeta {
  const ticks = delaysMs.map((ms) =>
    Math.min(MAX_FRAME_TICKS, Math.max(1, Math.round((ms > 0 ? ms : 100) / TICK_MS)))
  )
  const counts = new Map<number, number>()
  for (const t of ticks) counts.set(t, (counts.get(t) ?? 0) + 1)
  let frametime = ticks[0] ?? 1
  for (const [t, c] of counts) if (c > (counts.get(frametime) ?? 0)) frametime = t
  const anim: AnimationMeta = {
    ...(base ?? defaultAnimation()),
    frametime,
    frames: ticks.map((time, index) => ({ index, time }))
  }
  delete anim.width
  delete anim.height
  return normalizeAnimation(anim, ticks.length)
}

// ---------- playback ----------

/** Playback as [frame index, duration ms] pairs. */
export function playbackSequence(anim: AnimationMeta, count: number): Array<[number, number]> {
  const seq: Array<[number, number]> = []
  for (const f of anim.frames ?? []) {
    if (f.index < count) seq.push([f.index, (f.time ?? anim.frametime) * TICK_MS])
  }
  if (!seq.length) for (let i = 0; i < count; i++) seq.push([i, anim.frametime * TICK_MS])
  return seq
}

/** Frame shown at `timeMs` (loops), and with interpolation the next frame and how far toward it (0..1). */
export function playbackAt(
  seq: ReadonlyArray<[number, number]>,
  timeMs: number
): { index: number; next: number; t: number } {
  const total = seq.reduce((s, [, d]) => s + d, 0)
  if (total <= 0 || seq.length === 0)
    return { index: seq[0]?.[0] ?? 0, next: seq[0]?.[0] ?? 0, t: 0 }
  let t = ((timeMs % total) + total) % total
  for (let i = 0; i < seq.length; i++) {
    const [index, duration] = seq[i]!
    if (t < duration) {
      return { index, next: seq[(i + 1) % seq.length]![0], t: duration > 0 ? t / duration : 0 }
    }
    t -= duration
  }
  return { index: seq[0]![0], next: seq[0]![0], t: 0 }
}

/** Linear blend of two frames of the same size (Minecraft's "interpolate"). */
export function blendFrames(a: RgbaImage, b: RgbaImage, t: number): RgbaImage {
  const out = cloneImage(a)
  if (a.width !== b.width || a.height !== b.height || t <= 0) return out
  const k = Math.min(1, t)
  for (let i = 0; i < out.data.length; i++) {
    out.data[i] = Math.round(a.data[i]! * (1 - k) + b.data[i]! * k)
  }
  return out
}
