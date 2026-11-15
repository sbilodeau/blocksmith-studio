#!/usr/bin/env node
/**
 * Draws the box-UV layout of an entity definition over a real texture, to check a definition against the vanilla
 * texture before shipping it (each part gets its own color; painted pixels must sit inside the outlines).
 *
 *   node scripts/entity-uv-overlay.mjs <definition.json> <texture.png> <out.png>
 *
 * Use a texture from your own extracted vanilla cache (Settings > Minecraft), e.g. on macOS
 * "~/Library/Application Support/Blocksmith Studio/vanilla/26.3/assets/minecraft/textures/entity/...".
 * Never commit the output: it contains Mojang pixels.
 */
import { readFileSync, writeFileSync } from 'fs'
import { decode, encode } from 'fast-png'

const SCALE = 8
const COLORS = [
  [255, 0, 0],
  [0, 255, 0],
  [0, 160, 255],
  [255, 255, 0],
  [255, 0, 255],
  [0, 255, 255],
  [255, 128, 0],
  [255, 255, 255]
]

/** Any PNG (palette, gray, 16-bit) -> 8-bit RGBA. */
function toRgba(raw) {
  const { width, height, channels, depth, palette } = raw
  const out = new Uint8Array(width * height * 4)
  const div = depth === 16 ? 257 : 1
  for (let i = 0; i < width * height; i++) {
    let rgba
    if (palette) {
      let idx = raw.data[i]
      if (depth < 8) {
        const perByte = 8 / depth
        const x = i % width
        const byte =
          raw.data[Math.floor(i / width) * Math.ceil(width / perByte) + Math.floor(x / perByte)]
        idx = (byte >> (8 - depth * ((x % perByte) + 1))) & ((1 << depth) - 1)
      }
      const c = palette[idx] ?? [0, 0, 0, 0]
      rgba = [c[0], c[1], c[2], c.length > 3 ? c[3] : 255]
    } else {
      const p = Array.from(raw.data.subarray(i * channels, i * channels + channels), (v) => v / div)
      rgba =
        channels >= 3
          ? [p[0], p[1], p[2], channels === 4 ? p[3] : 255]
          : [p[0], p[0], p[0], channels === 2 ? p[1] : 255]
    }
    out.set(rgba, i * 4)
  }
  return { width, height, data: out }
}

function main() {
  const [defPath, texPath, outPath] = process.argv.slice(2)
  if (!outPath) {
    console.error(
      'usage: node scripts/entity-uv-overlay.mjs <definition.json> <texture.png> <out.png>'
    )
    process.exit(1)
  }
  const def = JSON.parse(readFileSync(defPath, 'utf8'))
  const tex = toRgba(decode(readFileSync(texPath)))
  const k = tex.width / def.textureSize[0]
  const W = def.textureSize[0] * SCALE
  const H = def.textureSize[1] * SCALE
  const out = new Uint8Array(W * H * 4)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (Math.floor((y / SCALE) * k) * tex.width + Math.floor((x / SCALE) * k)) * 4
      const a = tex.data[i + 3] / 255
      const checker = ((x >> 3) + (y >> 3)) % 2 ? 60 : 90
      for (let c = 0; c < 3; c++)
        out[(y * W + x) * 4 + c] = Math.round(tex.data[i + c] * a + checker * (1 - a))
      out[(y * W + x) * 4 + 3] = 255
    }
  }
  const plot = (x, y, col) => {
    if (x >= 0 && y >= 0 && x < W && y < H) out.set(col, (y * W + x) * 4)
  }
  const rect = (u1, v1, u2, v2, col) => {
    const [x1, x2, y1, y2] = [u1 * SCALE, u2 * SCALE - 1, v1 * SCALE, v2 * SCALE - 1].map(
      Math.round
    )
    for (let x = x1; x <= x2; x++) {
      plot(x, y1, col)
      plot(x, y2, col)
    }
    for (let y = y1; y <= y2; y++) {
      plot(x1, y, col)
      plot(x2, y, col)
    }
  }
  let n = 0
  const walk = (parts) => {
    for (const part of parts) {
      const col = COLORS[n++ % COLORS.length]
      for (const { size, uv } of part.boxes) {
        const [w, h, d] = size
        const [u, v] = uv
        rect(u + d, v, u + d + w, v + d, col)
        rect(u + d + w, v, u + d + 2 * w, v + d, col)
        rect(u, v + d, u + d, v + d + h, col)
        rect(u + d, v + d, u + d + w, v + d + h, col)
        rect(u + d + w, v + d, u + 2 * d + w, v + d + h, col)
        rect(u + 2 * d + w, v + d, u + 2 * d + 2 * w, v + d + h, col)
      }
      walk(part.children ?? [])
    }
  }
  walk(def.parts)
  writeFileSync(outPath, encode({ width: W, height: H, data: out, channels: 4 }))
  console.log(`wrote ${outPath} (${W}x${H})`)
}

main()
