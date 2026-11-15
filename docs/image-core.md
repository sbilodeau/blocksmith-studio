# Image core

Pure TypeScript pixel operations shared by the pixel editor (renderer), the AI tool executor (main, M3) and the
tests. Code: `src/shared/image/`, imported as `@shared/image`. No DOM, no Electron, no Node-only API; PNG goes
through `fast-png`.

## Conventions

- **Images** (`RgbaImage`): straight (non-premultiplied) RGBA8 in a `Uint8ClampedArray`, `width * height * 4`
  bytes, row-major, origin top-left. Byte index of pixel `(x, y)` is `(y * width + x) * 4`.
- **Axes**: x goes right, y goes down.
- **Colors** (`Rgba`): `[r, g, b, a]`, each 0-255. Inputs are clamped and rounded to integers.
- **Coordinates** are integers: non-integers are floored (`1.7 -> 1`, `-0.5 -> -1`).
- **Out of bounds**: reads return `[0, 0, 0, 0]`; single-pixel writes and line pixels are silently skipped; rects
  are clamped to the image. A rect with `width` or `height <= 0` is empty and the operation is a no-op.
- **Transparent** means `alpha == 0`; "opaque" or "visible" means `alpha > 0`.
- Transforms return new images; drawing, color and patch operations mutate the image they get.

### Rotation

`'clockwise'` is "right" (sens horaire), `'counterclockwise'` is "left".

| Rotation            | Pixel `(x, y)` of a `w x h` image goes to | New size |
| ------------------- | ----------------------------------------- | -------- |
| 90 clockwise        | `(h-1-y, x)`                              | `h x w`  |
| 90 counterclockwise | `(y, w-1-x)`                              | `h x w`  |
| 180 (either way)    | `(w-1-x, h-1-y)`                          | `w x h`  |

270 clockwise is 90 counterclockwise and 270 counterclockwise is 90 clockwise. Four 90-degree turns give the
original image back.

```
 1  2  3    rotate 90 clockwise    11  1
11 12 13    ------------------->   12  2
                                   13  3
```

### Flip and shift

- `flipImage(img, 'horizontal')` mirrors left <-> right; `'vertical'` mirrors top <-> bottom.
- `shiftImage(img, dx, dy, wrap)` moves the content right/down by positive `dx`/`dy`. With `wrap` pixels leaving
  one edge re-enter on the opposite edge; without it the uncovered area becomes transparent.
- `resizeNearest` samples the source pixel under each destination pixel's center: integer upscales repeat each
  pixel exactly; a 2x downscale keeps columns/rows 1, 3, 5...

## Drawing

- `linePoints` / `drawLine`: Bresenham, both ends included, all octants; equal ends give one point.
- `drawRect` draws the 1-px outline of the rect **after clamping it** to the image (a rect running past the right
  edge gets its right side drawn on the last column). `fillRect` fills the clamped rect.
- `floodFill(img, x, y, color, { tolerance = 0, contiguous = true })`:
  - a pixel matches when its max channel distance to the clicked pixel (alpha included) is `<= tolerance`;
  - every fully transparent pixel counts as `[0, 0, 0, 0]` whatever its hidden RGB, so a transparent area always
    fills as one region;
  - contiguous fills use the 4-neighbourhood and an explicit stack (no recursion; 512x512 is fine);
  - returns the number of pixels whose bytes changed (filling with the same color returns 0).
- `mirrorPoints(p, w, h, { x, y })` for mirror painting: `x` mirrors across the vertical center line
  (`x' = w-1-x`), `y` across the horizontal one (`y' = h-1-y`). Returns unique points, the original first; on odd
  sizes a point on the center column/row is not duplicated.

## Colors

- `parseHex` accepts `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, with or without `#`, any case, surrounding spaces
  ignored; throws otherwise. `toHex` returns lowercase `#rrggbbaa`.
- `colorDistance` is the max absolute channel difference, alpha included (0-255).
- `extractPalette` counts distinct colors, ignores transparent pixels, sorts by count (desc) then hex (asc) for a
  stable order; `max` keeps the first entries.
- `replaceColor(img, from, to, tolerance = 0)` uses the same matching as `floodFill` (transparent pixels compare
  as `[0, 0, 0, 0]`) and returns the number of pixels changed.
- `applyPalette` maps each visible pixel to the nearest palette color by Euclidean RGB distance (ties: first
  entry), keeps the pixel's own alpha, skips transparent pixels. An empty palette is a no-op.
- `outline(img, color, mode)` is computed from a snapshot, so it never cascades:
  - `'outside'`: transparent pixels 4-touching a visible pixel become `color`;
  - `'inside'`: visible pixels 4-touching a transparent pixel or the image border become `color`.

### Adjustments

All three only touch visible pixels, accept an optional `region` (clamped), keep alpha, round to the nearest
integer, and are bit-exact no-ops for `0` (and for multiples of 360 degrees for the hue).

| Function           | Model | Behavior                                                                                                                                                               |
| ------------------ | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hueShift`         | HSV   | Rotates the hue, keeps saturation and value; grays unchanged. Red +120 = green, +240 = blue.                                                                           |
| `adjustSaturation` | HSL   | `delta < 0` scales saturation by `1 + delta` (-1 = gray); `delta > 0` moves it toward 1 by `delta` of the remaining distance. Hue and lightness kept; grays unchanged. |
| `adjustBrightness` | HSL   | `delta > 0` moves lightness toward white by `delta` of the remaining distance (1 = white); `delta < 0` scales it by `1 + delta` (-1 = black). Hue and saturation kept. |

`delta` is clamped to -1..1.

## Paste and crop

- `cropImage(img, rect)` copies the rect clamped to the image (a 0x0 image when nothing is left).
- `pasteImage(dst, src, x, y)` copies `src` exactly, transparency included, clipped to `dst`.
- `pasteImage(..., { blend: true })` composites `src` over `dst` with straight-alpha "over":
  `outA = sa + da (1 - sa)`, `outC = (sc sa + dc da (1 - sa)) / outA`, computed in exact integers and rounded.
  Fully transparent source pixels leave `dst` untouched; fully opaque ones replace it.
- Pasting an image into itself works (the source is snapshotted first).

## Undo patches

`diffImages(before, after)` returns the smallest rect containing every differing pixel, with copies of the
`before` and `after` pixels of that rect (row-major RGBA), or `null` when the images are identical. It throws
when the sizes differ. `applyPatch(img, patch, 'undo' | 'redo')` writes `before` or `after` back; it throws if the
patch does not fit the image. This is the `PixelPatch` of PLAN.md section 4.3.

## PNG

- `encodePng` writes 8-bit RGBA, lossless; `decodePng(encodePng(img))` is bit-exact (hidden RGB under alpha 0
  included). PNG cannot store a 0x0 image, so encoding one throws.
- `decodePng` converts every color type to exact RGBA8:

| PNG type     | Bit depths     | Conversion                                                            |
| ------------ | -------------- | --------------------------------------------------------------------- |
| Grayscale    | 1, 2, 4, 8, 16 | gray scaled to 0-255 (x255, x85, x17 for 1/2/4-bit, high byte for 16) |
| Gray + alpha | 8, 16          | high byte for 16-bit                                                  |
| RGB          | 8, 16          | high byte for 16-bit                                                  |
| RGBA         | 8, 16          | copied (8-bit) or high byte (16-bit)                                  |
| Indexed      | 1, 2, 4, 8     | palette lookup; an index past the palette end is opaque black         |

tRNS transparency is applied for indexed (per-entry alpha), grayscale and RGB images (the key color, compared on
the raw sample at full bit depth, becomes alpha 0). Adam7-interlaced 8 and 16-bit images decode correctly;
interlaced 1/2/4-bit images are refused because `fast-png` 8 de-interlaces them incorrectly. `fast-png` 8 also
rejects an RGB tRNS chunk on images with fewer than 3 pixels.

## Performance

Measured on a 512x512 image of random pixels (best of 5, Node 24, Apple Silicon): rotate, flip, shift, diff,
fill rect, outline and replace color under 1 ms; flood fill 2-5 ms; extract palette, apply palette (16 colors) and
the HSV/HSL adjustments 9-13 ms (worst case: every pixel a different color); PNG decode about 4 ms, encode about
13 ms. `tests/unit/image-perf.test.ts` guards against regressions with a loose bound.
