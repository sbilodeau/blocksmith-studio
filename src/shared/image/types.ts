export interface RgbaImage {
  width: number
  height: number
  /** width * height * 4 bytes, RGBA, straight alpha. */
  data: Uint8ClampedArray
}

/** [r, g, b, a], each 0-255. */
export type Rgba = readonly [number, number, number, number]

export interface Point {
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Minimal undo record: the pixels of `rect` before and after a change. */
export interface Patch {
  rect: Rect
  before: Uint8ClampedArray
  after: Uint8ClampedArray
}

export interface PaletteEntry {
  color: Rgba
  count: number
}

export type RotateDegrees = 90 | 180 | 270
export type RotateDirection = 'clockwise' | 'counterclockwise'
export type FlipAxis = 'horizontal' | 'vertical'
