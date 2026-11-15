import { readFileSync, writeFileSync } from 'fs'
import { describe, expect, it } from 'vitest'
import { entityFitsTexture } from '@shared/preview/entities'
import { extractEntityModelsFromJar } from '../../src/main/services/entity-models/extract'

/**
 * Local-only check against a real Minecraft client jar (never in CI, no Mojang file in the repo):
 *   BLOCKSMITH_REAL_JAR="<userData>/jars/26.3.jar" npm run test:real-jar
 * Set BLOCKSMITH_REAL_JAR_DUMP=<file.json> to write the extracted models for inspection.
 */
const jar = process.env['BLOCKSMITH_REAL_JAR']

describe.skipIf(!jar)('entity models from a real jar', () => {
  it('extracts most model layers', { timeout: 120_000 }, () => {
    const aborts = new Map<string, number>()
    const started = Date.now()
    const models = extractEntityModelsFromJar(new Uint8Array(readFileSync(jar!)), {
      versionId: 'real',
      onAbort: (where, reason) => {
        const key = `${where.replace(/\(.*$/, '')}: ${reason}`
        aborts.set(key, (aborts.get(key) ?? 0) + 1)
      }
    })
    expect(models).not.toBeNull()
    const n = Object.keys(models!.layers).length
    console.log(
      `${n} layers, ${models!.skipped.length} skipped, ${models!.stats.steps} steps, ${Date.now() - started} ms`
    )
    console.log('skipped:', models!.skipped.join(', '))
    console.log(
      'top aborts:\n' +
        [...aborts]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 25)
          .map(([k, v]) => `  ${v} x ${k}`)
          .join('\n')
    )
    const dump = process.env['BLOCKSMITH_REAL_JAR_DUMP']
    if (dump) writeFileSync(dump, JSON.stringify(models, null, 1))
    expect(n).toBeGreaterThan(200)
  })
})

/**
 * The texture -> layer table checked against the real jar and its extracted textures:
 *   BLOCKSMITH_REAL_JAR=... BLOCKSMITH_REAL_JAR_TEXTURES="<userData>/vanilla/26.3" npm run test:real-jar
 */
const vanillaDir = process.env['BLOCKSMITH_REAL_JAR_TEXTURES']

describe.skipIf(!jar || !vanillaDir)('entity layer table against a real jar', () => {
  it(
    'names existing layers whose texture size fits every matched texture',
    { timeout: 120_000 },
    async () => {
      const { readdirSync, statSync } = await import('fs')
      const { join } = await import('path')
      const { globToRegExp } = await import('@shared/categories/glob')
      const table = JSON.parse(
        readFileSync(join(__dirname, '../../resources/data/entity-layers.json'), 'utf8')
      ) as { entries: Array<{ textures: string[]; layer: string }> }
      const models = extractEntityModelsFromJar(new Uint8Array(readFileSync(jar!)), {
        versionId: 'real'
      })!
      const root = join(vanillaDir!, 'assets/minecraft/textures/entity')
      const files: string[] = []
      const walk = (d: string): void => {
        for (const f of readdirSync(d)) {
          const p = join(d, f)
          if (statSync(p).isDirectory()) walk(p)
          else if (p.endsWith('.png'))
            files.push(`assets/minecraft/textures/entity/${p.slice(root.length + 1)}`)
        }
      }
      walk(root)
      const problems: string[] = []
      for (const e of table.entries) {
        const layer = models.layers[e.layer]
        if (!layer) {
          problems.push(`${e.layer}: not extracted`)
          continue
        }
        const res = e.textures.map(globToRegExp)
        for (const f of files.filter((p) => res.some((r) => r.test(p)))) {
          const b = readFileSync(join(vanillaDir!, f))
          const w = b.readUInt32BE(16)
          const h = b.readUInt32BE(20)
          const [tw, th] = layer.textureSize
          // Animated strips (a .mcmeta next to the PNG): compare one frame, as the preview does.
          const animated = (() => {
            try {
              statSync(join(vanillaDir!, `${f}.mcmeta`))
              return true
            } catch {
              return false
            }
          })()
          const frameH = animated ? Math.min(h, (w * th) / tw) : h
          if (!entityFitsTexture(layer, w, frameH))
            problems.push(`${f} (${w}x${h}) -> ${e.layer} (${tw}x${th})`)
        }
      }
      console.log(problems.length ? `problems:\n  ${problems.join('\n  ')}` : 'table OK')
      expect(problems).toEqual([])
    }
  )
})
