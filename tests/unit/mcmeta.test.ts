import { describe, expect, it } from 'vitest'
import { buildResourcePackMcmeta, findVersion, versionTable } from '@shared/versions'
import type { McVersion } from '@shared/model/versions'

function version(id: string): McVersion {
  const found = findVersion(versionTable, id)
  if (!found) throw new Error(`missing ${id}`)
  return found
}

describe('buildResourcePackMcmeta', () => {
  it.each([
    ['1.21.4', 46],
    ['1.21.5', 55],
    ['1.21.6', 63],
    ['1.21.8', 64]
  ])('uses a single integer pack_format for %s', (id, format) => {
    expect(buildResourcePackMcmeta('My pack', version(id))).toEqual({
      pack: { pack_format: format, description: 'My pack' }
    })
  })

  it('emits min_format/max_format for 26.3 (97.1), without legacy fields', () => {
    const mcmeta = buildResourcePackMcmeta('My pack', version('26.3'))
    expect(mcmeta).toEqual({
      pack: { min_format: [97, 1], max_format: 97, description: 'My pack' }
    })
    const pack = mcmeta.pack as Record<string, unknown>
    // supported_formats must be absent when the range does not include a format below 65.
    expect(pack).not.toHaveProperty('supported_formats')
    expect(pack).not.toHaveProperty('pack_format')
  })

  it.each([
    ['1.21.9', 69],
    ['1.21.11', 75],
    ['26.1', 84],
    ['26.2', 88]
  ])('emits min_format [major, 0] and max_format major for %s', (id, major) => {
    expect(buildResourcePackMcmeta('x', version(id))).toEqual({
      pack: { min_format: [major, 0], max_format: major, description: 'x' }
    })
  })

  it('accepts the target: min_format <= target format <= max_format (any minor)', () => {
    for (const target of versionTable.versions.filter((x) => x.mcmetaStyle === 'minmax')) {
      const pack = buildResourcePackMcmeta('x', target).pack as {
        min_format: [number, number]
        max_format: number
      }
      const [minMajor, minMinor] = pack.min_format
      const { major, minor } = target.resourcePack
      expect(major > minMajor || (major === minMajor && minor >= minMinor)).toBe(true)
      expect(major).toBeLessThanOrEqual(pack.max_format)
      expect(minMajor).toBeGreaterThanOrEqual(65)
    }
  })

  it('keeps the description as given and serializes to valid JSON', () => {
    const description = 'Café "quotes" §aGreen'
    const json = JSON.stringify(buildResourcePackMcmeta(description, version('26.3')))
    expect(JSON.parse(json).pack.description).toBe(description)
  })
})
