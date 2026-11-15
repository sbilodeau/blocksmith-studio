import { describe, expect, it } from 'vitest'
import { globToRegExp } from '@shared/categories/glob'
import { entityLayerTable, findEntityLayer } from '@shared/preview/entity-layers'

const T = (p: string): string => `assets/minecraft/textures/entity/${p}`

describe('texture -> jar layer table', () => {
  it('is valid and every layer id looks like name#layer', () => {
    const table = entityLayerTable()
    expect(table.entries.length).toBeGreaterThan(200)
    for (const e of table.entries) expect(e.layer).toMatch(/^[a-z0-9_/]+#[a-z0-9_]+$/)
  })

  it('finds the layer of adult, baby and equipment textures', () => {
    expect(findEntityLayer(T('axolotl/axolotl_lucy_baby.png'))).toBe('axolotl_baby#main')
    expect(findEntityLayer(T('axolotl/axolotl_lucy.png'))).toBe('axolotl#main')
    expect(findEntityLayer(T('cow/cow_warm.png'))).toBe('warm_cow#main')
    expect(findEntityLayer(T('zombie/zombie.png'))).toBe('zombie#main')
    expect(findEntityLayer(T('equipment/horse_body/diamond.png'))).toBe('horse_armor#main')
    expect(findEntityLayer('assets/minecraft/textures/block/stone.png')).toBeUndefined()
    expect(findEntityLayer(T('equipment/humanoid/diamond.png'))).toBeUndefined()
  })

  it('never lets two entries claim the same texture', () => {
    const table = entityLayerTable()
    const compiled = table.entries.map((e) => ({
      layer: e.layer,
      res: e.textures.map(globToRegExp)
    }))
    // Probe with every literal path written in the table (globs expanded on {a,b} groups only).
    const expand = (g: string): string[] => {
      const m = /\{([^{}]*)\}/.exec(g)
      if (!m) return [g]
      return m[1]!
        .split(',')
        .flatMap((alt) => expand(g.slice(0, m.index) + alt + g.slice(m.index + m[0].length)))
    }
    for (const e of table.entries) {
      for (const g of e.textures) {
        for (const p of expand(g).filter((x) => !x.includes('*'))) {
          const owners = compiled.filter((c) => c.res.some((r) => r.test(p))).map((c) => c.layer)
          expect(owners, p).toEqual([e.layer])
        }
      }
    }
  })
})
