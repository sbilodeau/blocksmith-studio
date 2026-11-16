import { GifReader } from 'omggif'
import { createImage, encodePng, pasteImage, resizeNearest, type RgbaImage } from '@shared/image'
import { MAX_FRAMES, joinFrames } from '@shared/animation'
import { AppErrorException } from '../../ipc/registry'
import { MAX_TEXTURE_SIZE } from './textures-edit'

/** Largest GIF file accepted by the import. */
export const MAX_GIF_BYTES = 20 * 1024 * 1024
/** Largest GIF side accepted by the import. */
export const MAX_GIF_SIDE = 2048

export const GifErrorCode = {
  /** Not a GIF, undecodable, too big, or no frames. */
  invalid: 'texture.invalidGif'
} as const

export interface DecodedGif {
  width: number
  height: number
  /** Fully composed frames (GIF disposal applied), each width x height. */
  frames: RgbaImage[]
  /** Delay of each frame in ms (0 when the file gives none). */
  delaysMs: number[]
}

/** Decodes every frame of a GIF, composing partial frames over the previous ones like a browser does. */
export function decodeGif(bytes: Uint8Array): DecodedGif {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_GIF_BYTES) {
    throw new AppErrorException(GifErrorCode.invalid)
  }
  let reader: GifReader
  try {
    reader = new GifReader(bytes)
  } catch {
    throw new AppErrorException(GifErrorCode.invalid)
  }
  const { width, height } = reader
  const count = reader.numFrames()
  if (width < 1 || height < 1 || width > MAX_GIF_SIDE || height > MAX_GIF_SIDE || count < 1) {
    throw new AppErrorException(GifErrorCode.invalid)
  }
  const canvas = new Uint8ClampedArray(width * height * 4)
  const frames: RgbaImage[] = []
  const delaysMs: number[] = []
  try {
    for (let i = 0; i < Math.min(count, MAX_FRAMES); i++) {
      const info = reader.frameInfo(i)
      const previous = info.disposal === 3 ? canvas.slice() : null
      reader.decodeAndBlitFrameRGBA(i, canvas)
      frames.push({ width, height, data: canvas.slice() })
      delaysMs.push(info.delay * 10)
      if (info.disposal === 2) {
        // Restore to background: the frame's rectangle becomes transparent.
        for (let y = info.y; y < Math.min(height, info.y + info.height); y++) {
          canvas.fill(
            0,
            (y * width + info.x) * 4,
            (y * width + Math.min(width, info.x + info.width)) * 4
          )
        }
      } else if (previous) {
        canvas.set(previous)
      }
    }
  } catch {
    throw new AppErrorException(GifErrorCode.invalid)
  }
  return { width, height, frames, delaysMs }
}

/** Scales `img` to fit inside width x height (nearest neighbor, aspect kept), centered on transparency. */
export function fitInto(img: RgbaImage, width: number, height: number): RgbaImage {
  if (img.width === width && img.height === height) return img
  const scale = Math.min(width / img.width, height / img.height)
  const w = Math.max(1, Math.round(img.width * scale))
  const h = Math.max(1, Math.round(img.height * scale))
  const out = createImage(width, height)
  pasteImage(
    out,
    resizeNearest(img, w, h),
    Math.floor((width - w) / 2),
    Math.floor((height - h) / 2)
  )
  return out
}

/**
 * GIF frames fitted to a texture frame size, as one vertical strip PNG plus each frame's delay. Frames past the
 * largest texture height are dropped (`truncated`).
 */
export function gifToStrip(
  gif: DecodedGif,
  frameWidth: number,
  frameHeight: number
): { png: Uint8Array; frames: number; delaysMs: number[]; truncated: boolean } {
  const max = Math.max(1, Math.floor(MAX_TEXTURE_SIZE / frameHeight))
  const kept = gif.frames.slice(0, max)
  const strip = joinFrames(kept.map((f) => fitInto(f, frameWidth, frameHeight)))
  return {
    png: encodePng(strip),
    frames: kept.length,
    delaysMs: gif.delaysMs.slice(0, kept.length),
    truncated: kept.length < gif.frames.length
  }
}
