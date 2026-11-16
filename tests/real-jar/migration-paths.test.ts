import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unzipSync } from 'fflate'
import { afterAll, describe, expect, it } from 'vitest'
import { findVersion, versionTable } from '@shared/versions'
import { migrationTable } from '@shared/versions/migrations'
import { exportPackZip } from '../../src/main/services/packs/exporter'
import { makePng } from '../integration/packs-fixtures'
import { findJar, minecraftDirs } from './minecraft'

/**
 * Texture path migrations checked against real client jars: a 26.3 pack whose textures were renamed over the years
 * is exported to every version whose jar is installed (obfuscated 1.21.x jars too: only their file list is read),
 * and every exported texture path must exist in that version's jar. Skipped without an installed jar.
 */

const AUTHORING = '26.3'
const T = (p: string): string => `assets/minecraft/textures/${p}.png`
/** 26.3 names: textures renamed in the chain, one that never moved, one new in 1.21.5 (cow) and one new in 26.1. */
const SOURCE = [
  'block/iron_chain',
  'item/iron_chain',
  'entity/armadillo/armadillo',
  'entity/bat/bat',
  'palettes/trim/amethyst',
  'block/creaking_heart_awake',
  'block/stone',
  'entity/cow/cow_temperate',
  'entity/cow/cow_temperate_baby'
].map(T)

const dirs = minecraftDirs()
const installed = migrationTable.versions
  .map((id) => ({ id, jar: findJar(dirs, id) }))
  .filter((v): v is { id: string; jar: string } => v.jar !== undefined)

describe.skipIf(installed.length === 0)('texture path migrations in real Minecraft jars', () => {
  const work = mkdtempSync(join(tmpdir(), 'blocksmith-migration-paths-'))
  afterAll(() => rmSync(work, { recursive: true, force: true }))

  it.each(installed.map((v) => [v.id, v.jar] as const))(
    'every texture exported for Minecraft %s exists in its jar',
    { timeout: 60_000 },
    async (id, jar) => {
      const folder = join(work, 'pack')
      for (const path of SOURCE) {
        await mkdir(join(folder, ...path.split('/').slice(0, -1)), { recursive: true })
        await writeFile(join(folder, ...path.split('/')), makePng(16, 16, [255, 0, 0, 255]))
      }
      const project = {
        schemaVersion: 1,
        id: 'p',
        name: 'Migration',
        description: '',
        authoringVersion: AUTHORING,
        base: 'vanilla',
        createdAt: '',
        updatedAt: ''
      }
      const out = join(work, `${id}.zip`)
      const report = await exportPackZip(
        { id: 'p', folder, project: project as never },
        findVersion(versionTable, id)!,
        out,
        { vanilla: { getIndex: async () => null } as never, onProgress: () => {} }
      )
      const exported = Object.keys(unzipSync(new Uint8Array(await readFile(out)))).filter(
        (p) => p.endsWith('.png') && p.startsWith('assets/')
      )
      const jarTextures = new Set(
        Object.keys(
          unzipSync(new Uint8Array(readFileSync(jar)), {
            filter: (f) => f.name.startsWith('assets/minecraft/textures/')
          })
        )
      )
      const missing = exported.filter((p) => !jarTextures.has(p))
      console.log(
        `Minecraft ${id}: ${exported.length} textures exported, ${report.renamed} renamed, ${report.skipped.length} skipped`
      )
      expect(missing, `textures not in the ${id} jar`).toEqual([])
      // Nothing that exists in this version was dropped.
      for (const s of report.skipped) {
        expect(s.reason).toBe('notInTarget')
      }
      expect(exported.length + report.skipped.length).toBe(SOURCE.length)
    }
  )
})
