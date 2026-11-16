import { isValidResourcePath } from './paths'
import { isPowerOfTwo, readPngHeader } from './png'
import { parseJson, readAnimation } from './mcmeta'

export interface PackWarning {
  code: string
  path?: string
}

export interface PackFile {
  path: string
  data: Uint8Array
}

/** Warning codes emitted by validatePackFiles (i18n: `warnings.<code>`). */
export const ValidationCode = {
  invalidPng: 'export.invalidPng',
  invalidJson: 'export.invalidJson',
  invalidPath: 'export.invalidPath',
  nonPowerOfTwo: 'export.nonPowerOfTwo',
  animationMismatch: 'export.animationMismatch',
  missingPackPng: 'export.missingPackPng'
} as const

/**
 * Textures whose proportions differ from the vanilla texture of the same path (a 32x16 texture where vanilla is
 * 16x16): models map their faces by proportion, so these show up stretched or cut. Animated strips are compared by
 * width only.
 */
export function proportionWarnings(
  files: readonly PackFile[],
  vanillaSize: (path: string) => { width?: number; height?: number; animated?: boolean } | undefined
): PackWarning[] {
  const out: PackWarning[] = []
  for (const { path, data } of files) {
    if (!/^assets\/[^/]+\/textures\/.+\.png$/.test(path)) continue
    const v = vanillaSize(path)
    const header = readPngHeader(data)
    if (!v?.width || !v.height || !header) continue
    if (v.animated || header.height !== header.width * (v.height / v.width)) {
      if (v.animated ? header.width % v.width !== 0 && v.width % header.width !== 0 : true) {
        out.push({ code: 'doctor.proportions', path })
      }
    }
  }
  return out
}

/** Atlas textures (mipmapped): non power-of-two sizes are worth a warning there, not for GUI or entities. */
const ATLAS_TEXTURE = /^assets\/[^/]+\/textures\/(block|item)\//

/**
 * "Pack Doctor" basics. Never throws: every problem becomes a warning so the export report shows it.
 * - PNG signature and IHDR are valid
 * - .json / .mcmeta files parse
 * - paths under assets/ only use resource-location characters [a-z0-9_.-/]
 * - block/item textures have power-of-two frame sizes, animation strips are a whole number of frames
 */
export function validatePackFiles(files: readonly PackFile[]): PackWarning[] {
  const warnings: PackWarning[] = []
  const byPath = new Map(files.map((f) => [f.path, f]))

  if (!byPath.has('pack.png')) warnings.push({ code: ValidationCode.missingPackPng })

  for (const file of files) {
    const { path, data } = file
    if (path.startsWith('assets/') && !isValidResourcePath(path)) {
      warnings.push({ code: ValidationCode.invalidPath, path })
    }
    if (path.endsWith('.png')) {
      const header = readPngHeader(data)
      if (!header) {
        warnings.push({ code: ValidationCode.invalidPng, path })
        continue
      }
      const meta = byPath.get(`${path}.mcmeta`)
      const animation = meta
        ? readAnimation(parseJson(meta.data), header.width, header.height)
        : null
      if (animation && !animation.consistent) {
        warnings.push({ code: ValidationCode.animationMismatch, path })
      }
      if (ATLAS_TEXTURE.test(path)) {
        const w = animation ? animation.frameWidth : header.width
        const h = animation ? animation.frameHeight : header.height
        if (!isPowerOfTwo(w) || !isPowerOfTwo(h)) {
          warnings.push({ code: ValidationCode.nonPowerOfTwo, path })
        }
      }
    } else if (path.endsWith('.json') || path.endsWith('.mcmeta')) {
      if (parseJson(data) === undefined) warnings.push({ code: ValidationCode.invalidJson, path })
    }
  }
  return warnings
}
