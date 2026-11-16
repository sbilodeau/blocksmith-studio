import { GifWriter } from 'omggif'

/**
 * Builds a GIF of solid-color frames (one RGB color and one delay, in hundredths of a second, per frame). Optional
 * `partial` frames cover only their top-left quarter (the rest keeps the previous frame), to test composition.
 */
export function makeGif(
  width: number,
  height: number,
  colors: Array<[number, number, number]>,
  delays: number[],
  options: { partial?: boolean; disposal?: number } = {}
): Uint8Array {
  let size = 2
  while (size < colors.length) size *= 2
  const palette = Array.from({ length: size }, (_, i) => {
    const [r, g, b] = colors[i] ?? [0, 0, 0]
    return (r << 16) | (g << 8) | b
  })
  const buf = new Uint8Array(1024 + width * height * colors.length * 2)
  const gif = new GifWriter(buf, width, height, { palette, loop: 0 })
  colors.forEach((_, i) => {
    const partial = options.partial && i > 0
    const w = partial ? Math.max(1, width >> 1) : width
    const h = partial ? Math.max(1, height >> 1) : height
    gif.addFrame(0, 0, w, h, new Array<number>(w * h).fill(i), {
      delay: delays[i] ?? 10,
      disposal: options.disposal ?? 1
    })
  })
  return buf.slice(0, gif.end())
}
