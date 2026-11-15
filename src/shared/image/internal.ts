/** Internal helpers shared by the image core modules (not part of the public API). */
import type { Rgba, RgbaImage } from './types'

/** Allocates a transparent image without validation. */
export function blank(width: number, height: number): RgbaImage {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) }
}

/**
 * A read-only 32-bit view of the pixels (one element per pixel, platform byte order). Shares memory with the
 * image when its buffer is 4-byte aligned, otherwise it is a copy: never write through it.
 */
export function readPixels32(img: RgbaImage): Uint32Array {
  const { data } = img
  const count = img.width * img.height
  if (data.byteOffset % 4 === 0) return new Uint32Array(data.buffer, data.byteOffset, count)
  return new Uint32Array(data.slice(0, count * 4).buffer)
}

/** A writable 32-bit view of a freshly allocated image (always aligned). */
export function writePixels32(img: RgbaImage): Uint32Array {
  return new Uint32Array(img.data.buffer, img.data.byteOffset, img.width * img.height)
}

/** Clamps and rounds a channel value to an integer 0-255 (NaN becomes 0). */
export function channel(v: number): number {
  return v > 0 ? (v < 255 ? Math.round(v) : 255) : 0
}

/** Normalizes a color to four clamped integer channels. */
export function normalize(c: Rgba): [number, number, number, number] {
  return [channel(c[0]), channel(c[1]), channel(c[2]), channel(c[3])]
}

/** Packs a color into an unsigned 0xRRGGBBAA number (byte order independent, sorts like its hex string). */
export function packRgba(r: number, g: number, b: number, a: number): number {
  return ((r << 24) | (g << 16) | (b << 8) | a) >>> 0
}

/** Integer coordinate: Math.floor, so 1.7 -> 1 and -0.5 -> -1. */
export function int(v: number): number {
  return Math.floor(v)
}
