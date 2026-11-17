/**
 * Downscaled PNG thumbnails for the `bs-asset://` protocol (`thumb=<size>`, see src/shared/assets.ts). Decoding
 * and resizing use Electron's native image code, injected so the logic is tested without Electron.
 */

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** What to cut from a width x height image and the size to scale it to, fitting in size x size. */
export function thumbnailPlan(
  width: number,
  height: number,
  size: number
): { crop: Box; width: number; height: number } {
  // A vertical strip (animation) shows its first square frame, like the grid tile does.
  const crop = { x: 0, y: 0, width, height: Math.min(height, width) }
  const scale = Math.min(1, size / Math.max(crop.width, crop.height))
  return {
    crop,
    width: Math.max(1, Math.round(crop.width * scale)),
    height: Math.max(1, Math.round(crop.height * scale))
  }
}

/** The subset of Electron's NativeImage used here. */
export interface ImageLike {
  isEmpty(): boolean
  getSize(): { width: number; height: number }
  crop(rect: Box): ImageLike
  resize(options: { width: number; height: number; quality: 'good' }): ImageLike
  toPNG(): Uint8Array
}

/** Makes a thumbnail PNG, or null when the data does not decode (the original is served instead). */
export type ThumbnailMaker = (png: Uint8Array, size: number) => Uint8Array<ArrayBuffer> | null

export function createThumbnailMaker(decode: (png: Uint8Array) => ImageLike): ThumbnailMaker {
  return (png, size) => {
    const image = decode(png)
    if (image.isEmpty()) return null
    const { width, height } = image.getSize()
    const plan = thumbnailPlan(width, height, size)
    const cropped = plan.crop.height < height ? image.crop(plan.crop) : image
    const scaled =
      plan.width === plan.crop.width && plan.height === plan.crop.height
        ? cropped
        : cropped.resize({ width: plan.width, height: plan.height, quality: 'good' })
    return new Uint8Array(scaled.toPNG())
  }
}

/** Least-recently-used cache of thumbnails, bounded by total bytes. */
export class ThumbnailCache {
  private readonly entries = new Map<string, Uint8Array<ArrayBuffer>>()
  private bytes = 0

  constructor(private readonly maxBytes = 64 * 1024 * 1024) {}

  get(key: string): Uint8Array<ArrayBuffer> | undefined {
    const hit = this.entries.get(key)
    if (hit) {
      this.entries.delete(key)
      this.entries.set(key, hit)
    }
    return hit
  }

  set(key: string, data: Uint8Array<ArrayBuffer>): void {
    const old = this.entries.get(key)
    if (old) {
      this.bytes -= old.byteLength
      this.entries.delete(key)
    }
    this.entries.set(key, data)
    this.bytes += data.byteLength
    for (const [k, v] of this.entries) {
      if (this.bytes <= this.maxBytes || k === key) break
      this.entries.delete(k)
      this.bytes -= v.byteLength
    }
  }

  get size(): number {
    return this.entries.size
  }

  get totalBytes(): number {
    return this.bytes
  }
}
