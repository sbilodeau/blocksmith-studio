/**
 * Pure TypeScript image core (no DOM, no Electron). Shared by the pixel editor (renderer), the AI tool executor
 * (main, M3) and tests. Images are straight (non-premultiplied) RGBA8, row-major, origin top-left.
 *
 * CONTRACT FILE: the signatures below are the API. Implementations land in the image-core work stream (M2);
 * until then every function throws.
 */

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

const todo = (name: string): never => {
  throw new Error(`image core: ${name} not implemented yet`)
}

// ---------- basics ----------
export function createImage(width: number, height: number, fill?: Rgba): RgbaImage {
  return todo(`createImage(${width},${height},${fill})`)
}
export function cloneImage(img: RgbaImage): RgbaImage {
  return todo(`cloneImage(${img.width})`)
}
export function inBounds(img: RgbaImage, x: number, y: number): boolean {
  return todo(`inBounds(${img.width},${x},${y})`)
}
export function getPixel(img: RgbaImage, x: number, y: number): Rgba {
  return todo(`getPixel(${img.width},${x},${y})`)
}
/** Mutates. Out-of-bounds writes are ignored. */
export function setPixel(img: RgbaImage, x: number, y: number, color: Rgba): void {
  todo(`setPixel(${img.width},${x},${y},${color})`)
}
export function imagesEqual(a: RgbaImage, b: RgbaImage): boolean {
  return todo(`imagesEqual(${a.width},${b.width})`)
}
/** Clamps a rect to the image bounds; returns null if empty. */
export function clampRect(img: RgbaImage, rect: Rect): Rect | null {
  return todo(`clampRect(${img.width},${rect.x})`)
}
export function cropImage(img: RgbaImage, rect: Rect): RgbaImage {
  return todo(`cropImage(${img.width},${rect.x})`)
}
/** Mutates `dst`. `blend` = alpha-composite src over dst; default replaces pixels (including transparency). */
export function pasteImage(
  dst: RgbaImage,
  src: RgbaImage,
  x: number,
  y: number,
  opts?: { blend?: boolean }
): void {
  todo(`pasteImage(${dst.width},${src.width},${x},${y},${opts})`)
}
/** Mutates: sets every pixel of `rect` (clamped) to transparent. */
export function clearRect(img: RgbaImage, rect: Rect): void {
  todo(`clearRect(${img.width},${rect.x})`)
}

// ---------- transforms (return new images) ----------
export function rotateImage(
  img: RgbaImage,
  degrees: RotateDegrees,
  direction: RotateDirection
): RgbaImage {
  return todo(`rotateImage(${img.width},${degrees},${direction})`)
}
/** horizontal = mirror left<->right; vertical = mirror top<->bottom. */
export function flipImage(img: RgbaImage, axis: FlipAxis): RgbaImage {
  return todo(`flipImage(${img.width},${axis})`)
}
export function shiftImage(img: RgbaImage, dx: number, dy: number, wrap: boolean): RgbaImage {
  return todo(`shiftImage(${img.width},${dx},${dy},${wrap})`)
}
export function resizeNearest(img: RgbaImage, width: number, height: number): RgbaImage {
  return todo(`resizeNearest(${img.width},${width},${height})`)
}

// ---------- drawing (mutate) ----------
/** Bresenham line, inclusive of both ends. */
export function linePoints(a: Point, b: Point): Point[] {
  return todo(`linePoints(${a.x},${b.x})`)
}
export function drawLine(img: RgbaImage, a: Point, b: Point, color: Rgba): void {
  todo(`drawLine(${img.width},${a.x},${b.x},${color})`)
}
export function drawRect(img: RgbaImage, rect: Rect, color: Rgba): void {
  todo(`drawRect(${img.width},${rect.x},${color})`)
}
export function fillRect(img: RgbaImage, rect: Rect, color: Rgba): void {
  todo(`fillRect(${img.width},${rect.x},${color})`)
}
/** Paint bucket. tolerance 0-255 (max channel distance). contiguous=false replaces every matching pixel. */
export function floodFill(
  img: RgbaImage,
  x: number,
  y: number,
  color: Rgba,
  opts?: { tolerance?: number; contiguous?: boolean }
): number {
  return todo(`floodFill(${img.width},${x},${y},${color},${opts})`)
}
/** Returns the points mirrored across the image's vertical (x) and/or horizontal (y) center lines, deduplicated. */
export function mirrorPoints(
  p: Point,
  width: number,
  height: number,
  mirror: { x: boolean; y: boolean }
): Point[] {
  return todo(`mirrorPoints(${p.x},${width},${height},${mirror})`)
}

// ---------- colors ----------
export function parseHex(hex: string): Rgba {
  return todo(`parseHex(${hex})`)
}
/** '#rrggbbaa' (lowercase). */
export function toHex(color: Rgba): string {
  return todo(`toHex(${color})`)
}
export function rgbaEquals(a: Rgba, b: Rgba): boolean {
  return todo(`rgbaEquals(${a},${b})`)
}
/** Max absolute channel difference (0-255), alpha included. */
export function colorDistance(a: Rgba, b: Rgba): number {
  return todo(`colorDistance(${a},${b})`)
}
/** Distinct colors sorted by pixel count (desc), fully transparent pixels ignored. */
export function extractPalette(img: RgbaImage, opts?: { max?: number }): PaletteEntry[] {
  return todo(`extractPalette(${img.width},${opts})`)
}
/** Mutates. Returns the number of pixels changed. */
export function replaceColor(img: RgbaImage, from: Rgba, to: Rgba, tolerance?: number): number {
  return todo(`replaceColor(${img.width},${from},${to},${tolerance})`)
}
/** Mutates (non-transparent pixels only). degrees -360..360 */
export function hueShift(img: RgbaImage, degrees: number, region?: Rect): void {
  todo(`hueShift(${img.width},${degrees},${region})`)
}
/** Mutates. delta -1..1 */
export function adjustSaturation(img: RgbaImage, delta: number, region?: Rect): void {
  todo(`adjustSaturation(${img.width},${delta},${region})`)
}
/** Mutates. delta -1..1 */
export function adjustBrightness(img: RgbaImage, delta: number, region?: Rect): void {
  todo(`adjustBrightness(${img.width},${delta},${region})`)
}
/** Mutates: maps every opaque pixel to the nearest palette color (alpha kept). */
export function applyPalette(img: RgbaImage, palette: readonly Rgba[], region?: Rect): void {
  todo(`applyPalette(${img.width},${palette.length},${region})`)
}
/** Mutates: draws a 1-px outline around opaque shapes, outside (on transparent neighbours) or inside (edge pixels). */
export function outline(img: RgbaImage, color: Rgba, mode: 'inside' | 'outside'): void {
  todo(`outline(${img.width},${color},${mode})`)
}

// ---------- undo patches ----------
/** Smallest rect covering every differing pixel; null when identical. Sizes must match. */
export function diffImages(before: RgbaImage, after: RgbaImage): Patch | null {
  return todo(`diffImages(${before.width},${after.width})`)
}
/** Mutates `img`: writes patch.after ('redo') or patch.before ('undo'). */
export function applyPatch(img: RgbaImage, patch: Patch, direction: 'undo' | 'redo'): void {
  todo(`applyPatch(${img.width},${patch.rect.x},${direction})`)
}

// ---------- PNG ----------
/** Decodes any PNG (palette, grayscale, 16-bit, with or without alpha) to RGBA8 with exact values. */
export function decodePng(bytes: Uint8Array): RgbaImage {
  return todo(`decodePng(${bytes.length})`)
}
/** Encodes RGBA8, lossless. */
export function encodePng(img: RgbaImage): Uint8Array {
  return todo(`encodePng(${img.width})`)
}
