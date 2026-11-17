import { readFileSync } from 'node:fs'
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { supportedVersions, versionTable } from '@shared/versions'
import {
  VANILLA_DATA_RE,
  checkDataText,
  collectDataIds,
  dataContext,
  parseDataPath
} from '@shared/datapack'
import { findJar, minecraftDirs } from './minecraft'

/**
 * The data file schemas against real client jars: every vanilla recipe, loot table, tag and advancement of each
 * installed version of the support window must give no error AND no warning (unknown ids are checked against the same
 * jar's items, blocks and tags). Skipped without an installed jar.
 */

const dirs = minecraftDirs()
const installed = supportedVersions(versionTable, new Date())
  .map((v) => ({ id: v.id, jar: findJar(dirs, v.id) }))
  .filter((v): v is { id: string; jar: string } => v.jar !== undefined)

describe.skipIf(installed.length === 0)('data pack schemas on real vanilla data', () => {
  it.each(installed.map((v) => [v.id, v.jar] as const))(
    'every vanilla data file of Minecraft %s is valid',
    { timeout: 120_000 },
    (_id, jar) => {
      const files = unzipSync(new Uint8Array(readFileSync(jar)), {
        filter: (f) =>
          VANILLA_DATA_RE.test(f.name) ||
          /^assets\/minecraft\/(items|blockstates)\/[^/]+\.json$/.test(f.name)
      })
      const ctx = dataContext(collectDataIds(Object.keys(files)))
      expect(ctx.items?.size).toBeGreaterThan(1000)
      const problems: string[] = []
      let checked = 0
      for (const [path, bytes] of Object.entries(files)) {
        if (!path.startsWith('data/')) continue
        const info = parseDataPath(path)
        expect(info, path).not.toBeNull()
        const result = checkDataText(strFromU8(bytes), info!.kind, ctx, info!.registry)
        checked++
        for (const issue of result.issues) {
          problems.push(
            `${path} ${issue.severity} ${issue.code} ${JSON.stringify(issue.params ?? {})} at ${issue.path.join('.')}`
          )
        }
      }
      expect(checked).toBeGreaterThan(4000)
      expect(problems.slice(0, 30)).toEqual([])
    }
  )
})
