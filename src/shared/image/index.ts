/**
 * Pure TypeScript image core (no DOM, no Electron). Shared by the pixel editor (renderer), the AI tool executor
 * (main, M3) and tests. Images are straight (non-premultiplied) RGBA8, row-major, origin top-left.
 *
 * CONTRACT FILE: the exports below are the API. Conventions and per-function behavior: docs/image-core.md.
 */

export type {
  RgbaImage,
  Rgba,
  Point,
  Rect,
  Patch,
  PaletteEntry,
  RotateDegrees,
  RotateDirection,
  FlipAxis
} from './types'

// ---------- basics ----------
export {
  createImage,
  cloneImage,
  inBounds,
  getPixel,
  setPixel,
  imagesEqual,
  clampRect,
  cropImage,
  pasteImage,
  clearRect
} from './basics'

// ---------- transforms (return new images) ----------
export { rotateImage, flipImage, shiftImage, resizeNearest } from './transforms'

// ---------- drawing (mutate) ----------
export { linePoints, drawLine, drawRect, fillRect, floodFill, mirrorPoints } from './draw'

// ---------- colors ----------
export {
  parseHex,
  toHex,
  rgbaEquals,
  colorDistance,
  extractPalette,
  replaceColor,
  applyPalette,
  outline
} from './color'
export { hueShift, adjustSaturation, adjustBrightness } from './adjust'

// ---------- undo patches ----------
export { diffImages, applyPatch } from './patch'

// ---------- layers ----------
export { compositeLayers, overlayDiff, type LayerView } from './layers'

// ---------- PNG ----------
export { decodePng, encodePng } from './png'
