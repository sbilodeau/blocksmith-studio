#!/usr/bin/env node
/**
 * Regenerates resources/data/versions.json (see docs/versions.md).
 *
 *   node scripts/update-versions.mjs              # fetch, cross-check the latest jar, write the table
 *   node scripts/update-versions.mjs --no-jar     # skip the client jar cross-check
 *   node scripts/update-versions.mjs --dry-run    # print the table instead of writing it
 *
 * Sources:
 * - Mojang version manifest (release ids and release dates):
 *   https://piston-meta.mojang.com/mc/game/version_manifest_v2.json
 * - misode/mcmeta summary (pack formats per version, fields `resource_pack_version`,
 *   `resource_pack_version_minor`, `data_pack_version`, `data_pack_version_minor`):
 *   https://raw.githubusercontent.com/misode/mcmeta/summary/versions/data.json
 * - Cross-check: the latest release's client jar is downloaded once into a temp folder (outside the repo,
 *   deleted afterwards) and its `version.json` `pack_version` must match the table. No Mojang asset is kept.
 */
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { unzipSync, strFromU8 } from 'fflate'

export const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'
export const MCMETA_SUMMARY_URL =
  'https://raw.githubusercontent.com/misode/mcmeta/summary/versions/data.json'

/** First release kept in the table. The support window itself is computed at runtime. */
export const FIRST_RELEASE = '1.21'

/** Resource pack format from which pack.mcmeta uses `min_format`/`max_format` (1.21.9, 25w31a). */
export const MINMAX_RESOURCE_FORMAT = 65

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUTPUT = join(root, 'resources', 'data', 'versions.json')

/**
 * Builds the version table from Mojang's manifest and misode's summary.
 * @param {{ versions: Array<{ id: string, type: string, releaseTime: string }> }} manifest
 * @param {Array<Record<string, unknown>>} summary
 * @param {string} updatedAt YYYY-MM-DD
 */
export function buildVersionTable(manifest, summary, updatedAt) {
  const releases = manifest.versions.filter((v) => v.type === 'release')
  const first = releases.find((v) => v.id === FIRST_RELEASE)
  if (!first) throw new Error(`${FIRST_RELEASE} not found in the Mojang manifest`)
  const firstTime = Date.parse(first.releaseTime)
  const byId = new Map(summary.map((entry) => [entry.id, entry]))

  const versions = releases
    .filter((v) => Date.parse(v.releaseTime) >= firstTime)
    .sort((a, b) => Date.parse(b.releaseTime) - Date.parse(a.releaseTime))
    .map((v) => {
      const s = byId.get(v.id)
      if (!s) throw new Error(`No pack formats for ${v.id} in the misode summary`)
      const resourcePack = format(s.resource_pack_version, s.resource_pack_version_minor, v.id)
      const dataPack = format(s.data_pack_version, s.data_pack_version_minor, v.id)
      return {
        id: v.id,
        releaseTime: v.releaseTime,
        resourcePack,
        dataPack,
        mcmetaStyle: resourcePack.major >= MINMAX_RESOURCE_FORMAT ? 'minmax' : 'pack_format'
      }
    })

  return { schemaVersion: 1, updatedAt, versions }
}

/**
 * @param {unknown} major
 * @param {unknown} minor
 * @param {string} id
 */
function format(major, minor, id) {
  if (!Number.isInteger(major)) throw new Error(`Invalid pack format for ${id}: ${major}`)
  return { major, minor: Number.isInteger(minor) ? minor : 0 }
}

/**
 * Reads `pack_version` from a client jar's version.json. Two shapes exist:
 * - up to 1.21.8: `{ resource: 46, data: 61 }`
 * - since 1.21.9 (25w31a): `{ resource_major: 97, resource_minor: 1, data_major: 121, data_minor: 0 }`
 * @param {any} versionJson
 */
export function packVersionFromVersionJson(versionJson) {
  const pv = versionJson?.pack_version
  if (pv && Number.isInteger(pv.resource_major)) {
    return {
      resourcePack: { major: pv.resource_major, minor: pv.resource_minor ?? 0 },
      dataPack: { major: pv.data_major, minor: pv.data_minor ?? 0 }
    }
  }
  if (pv && Number.isInteger(pv.resource)) {
    return {
      resourcePack: { major: pv.resource, minor: 0 },
      dataPack: { major: pv.data, minor: 0 }
    }
  }
  throw new Error('version.json has no recognizable pack_version')
}

/** @param {string} url */
async function fetchJson(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`)
  return response.json()
}

/**
 * Downloads the client jar of `versionId` into a temp folder, checks its SHA1 and returns its version.json.
 * @param {{ versions: Array<{ id: string, url: string }> }} manifest
 * @param {string} versionId
 */
async function readJarVersionJson(manifest, versionId) {
  const entry = manifest.versions.find((v) => v.id === versionId)
  if (!entry) throw new Error(`${versionId} not in manifest`)
  const meta = await fetchJson(entry.url)
  const client = meta.downloads.client
  const dir = await mkdtemp(join(tmpdir(), 'blocksmith-versions-'))
  try {
    console.log(`Downloading ${versionId} client jar (${client.size} bytes) to ${dir}`)
    const response = await fetch(client.url)
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${client.url}`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    const sha1 = createHash('sha1').update(bytes).digest('hex')
    if (sha1 !== client.sha1) throw new Error(`SHA1 mismatch for ${versionId}`)
    await writeFile(join(dir, `${versionId}.jar`), bytes)
    const files = unzipSync(bytes, { filter: (f) => f.name === 'version.json' })
    if (!files['version.json']) throw new Error('version.json missing from the jar')
    return JSON.parse(strFromU8(files['version.json']))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

async function main() {
  const args = new Set(process.argv.slice(2))
  const [manifest, summary] = await Promise.all([
    fetchJson(MANIFEST_URL),
    fetchJson(MCMETA_SUMMARY_URL)
  ])
  const today = new Date().toISOString().slice(0, 10)
  const table = buildVersionTable(manifest, summary, today)
  const latest = table.versions[0]

  if (latest.id !== manifest.latest.release) {
    throw new Error(
      `Latest release mismatch: table ${latest.id}, manifest ${manifest.latest.release}`
    )
  }

  if (!args.has('--no-jar')) {
    const versionJson = await readJarVersionJson(manifest, latest.id)
    const fromJar = packVersionFromVersionJson(versionJson)
    const same = (a, b) => a.major === b.major && a.minor === b.minor
    if (
      !same(fromJar.resourcePack, latest.resourcePack) ||
      !same(fromJar.dataPack, latest.dataPack)
    ) {
      throw new Error(
        `Jar cross-check failed for ${latest.id}: jar ${JSON.stringify(fromJar)}, ` +
          `table ${JSON.stringify({ resourcePack: latest.resourcePack, dataPack: latest.dataPack })}`
      )
    }
    console.log(
      `Cross-check OK: ${latest.id} jar pack_version = ${JSON.stringify(versionJson.pack_version)}`
    )
  }

  const json = JSON.stringify(table, null, 2) + '\n'
  if (args.has('--dry-run')) {
    process.stdout.write(json)
    return
  }
  await writeFile(OUTPUT, json)
  console.log(
    `Wrote ${table.versions.length} releases (${table.versions.at(-1).id} -> ${latest.id})`
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
