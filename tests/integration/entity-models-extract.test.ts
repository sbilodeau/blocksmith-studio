import { zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import type { EntityPart } from '@shared/model/preview'
import { EntityDefinitionSchema } from '@shared/preview/entity-schema'
import {
  classSourceFromEntries,
  extractEntityModels,
  extractEntityModelsFromJar,
  hasReadableModels
} from '../../src/main/services/entity-models/extract'
import { loadSyntheticModels } from '../fixtures/jvm/assembler'

function flatten(parts: EntityPart[]): EntityPart[] {
  return parts.flatMap((p) => [p, ...flatten(p.children ?? [])])
}

describe('entity models from jar code (synthetic classes)', () => {
  it('runs the registry and converts every computable layer', async () => {
    const entries = await loadSyntheticModels()
    expect(hasReadableModels(entries)).toBe(true)
    const models = extractEntityModels(classSourceFromEntries(entries), {
      versionId: '26.3',
      now: () => new Date('2026-11-15T00:00:00Z')
    })
    expect(Object.keys(models.layers).sort()).toEqual([
      'demo#main',
      'demo_baby#main',
      'zombie#main'
    ])
    expect(models.skipped).toEqual(['broken#main'])
    expect(models.generatedAt).toBe('2026-11-15T00:00:00.000Z')

    const demo = models.layers['demo#main']!
    expect(demo.textureSize).toEqual([64, 32])
    // Valid in the preview's entity format.
    expect(() =>
      EntityDefinitionSchema.parse({ id: 'demo', textures: ['assets/x.png'], ...demo })
    ).not.toThrow()

    const parts = flatten(demo.parts)
    const byName = (n: string): EntityPart => parts.find((p) => p.name === n)!
    // Body: Mojang offset (0, 12, 0), box (-4, 0, -2) 8x12x4 -> y up, front +z.
    const body = byName('body')
    expect(body.role).toBe('body')
    expect(body.pivot).toEqual([0, 12, 0])
    expect(body.boxes[0]).toEqual({ origin: [-4, 0, -2], size: [8, 12, 4], uv: [16, 16] })
    // Head is a child of the body, rotated 0.5 rad around x, with a mirrored hat inflated by 0.5.
    const head = body.children!.find((p) => p.name === 'head')!
    expect(head.rotation![0]).toBeCloseTo(28.6479, 3)
    expect(head.boxes[0]).toEqual({ origin: [-4, 12, -4], size: [8, 8, 8], uv: [0, 0] })
    expect(head.boxes[1]).toMatchObject({ uv: [32, 0], mirror: true, inflate: 0.5 })
    // Legs made in a loop, named by string concatenation, offsets computed with int math.
    expect(['leg0', 'leg1', 'leg2'].map((n) => byName(n).pivot)).toEqual([
      [-3, 6, 0],
      [0, 6, 0],
      [3, 6, 0]
    ])
    // A plate showing only UP and NORTH: the top and front faces.
    expect(byName('plate').boxes[0]!.faces?.sort()).toEqual(['front', 'top'])
  })

  it('applies mesh transformers (the baby layer is scaled by 0.5)', async () => {
    const models = extractEntityModels(classSourceFromEntries(await loadSyntheticModels()), {
      versionId: '26.3'
    })
    const baby = models.layers['demo_baby#main']!
    expect(baby.parts).toHaveLength(1)
    expect(baby.parts[0]!.scale).toEqual([0.5, 0.5, 0.5])
    expect(flatten(baby.parts).map((p) => p.name)).toContain('head')
  })

  it('reads a whole jar, and returns null for jars without readable model code', async () => {
    const jar = zipSync({
      ...(await loadSyntheticModels()),
      'version.json': new Uint8Array([123, 125])
    })
    const models = extractEntityModelsFromJar(jar, { versionId: '26.3' })
    expect(Object.keys(models!.layers)).toContain('demo#main')
    expect(
      extractEntityModelsFromJar(zipSync({ 'a/b.class': new Uint8Array([1]) }), {
        versionId: '1.21.4'
      })
    ).toBeNull()
  })
})
