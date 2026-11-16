import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { McVersion } from '@shared/model/versions'
import {
  isSnapshot,
  latest,
  snapshotTargets,
  supportedVersions,
  versionTable
} from '@shared/versions'
import { OPEN_MAX_FORMAT } from '@shared/versions/mcmeta'
import { exportPackZip } from '../../src/main/services/packs/exporter'
import { makePng } from '../integration/packs-fixtures'

/**
 * Every export target the app offers, exported with the real exporter and loaded by the game's own pack code from
 * real client jars (tests/real-jar/CheckPacks.java). Runs with `npm test` / `npm run test:real-jar` when a
 * Minecraft install is found; skipped otherwise (CI). No Mojang file is copied into the repo.
 *
 * Found automatically:
 * - Minecraft folders: the official launcher folder, or BLOCKSMITH_REAL_JAR_MINECRAFT_DIRS (list separated by
 *   ":" / ";"). Jars: <dir>/versions/<id>/<id>.jar + <id>.json; libraries from any <dir>/libraries.
 * - Java 25+ with javac: BLOCKSMITH_REAL_JAR_JAVA_HOME, else the Java runtime shipped in <dir>/runtime.
 * Only 26.1+ jars can run the check (older jars are obfuscated); their zips are still loaded by the 26.x games.
 */

const ROOT = join(__dirname, '../..')

function defaultMinecraftDir(): string {
  if (process.platform === 'darwin') return join(homedir(), 'Library/Application Support/minecraft')
  if (process.platform === 'win32') return join(process.env['APPDATA'] ?? '', '.minecraft')
  return join(homedir(), '.minecraft')
}

const dirs = (process.env['BLOCKSMITH_REAL_JAR_MINECRAFT_DIRS'] ?? defaultMinecraftDir())
  .split(delimiter)
  .filter((d) => d && existsSync(d))

/** Java homes with javac under <dir>/runtime (the launcher's runtimes), newest Java first. */
function findJavaHome(): string | undefined {
  const fromEnv = process.env['BLOCKSMITH_REAL_JAR_JAVA_HOME']
  if (fromEnv) return fromEnv
  const exe = process.platform === 'win32' ? 'javac.exe' : 'javac'
  const homes: { home: string; major: number }[] = []
  const walk = (dir: string, depth: number): void => {
    if (depth > 7) return
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    if (entries.includes('bin') && existsSync(join(dir, 'bin', exe))) {
      const release = existsSync(join(dir, 'release'))
        ? readFileSync(join(dir, 'release'), 'utf8')
        : ''
      const major = Number(/JAVA_VERSION="(\d+)/.exec(release)?.[1] ?? 0)
      homes.push({ home: dir, major })
      return
    }
    for (const e of entries) {
      const p = join(dir, e)
      if (statSync(p, { throwIfNoEntry: false })?.isDirectory()) walk(p, depth + 1)
    }
  }
  for (const d of dirs) walk(join(d, 'runtime'), 0)
  return homes.sort((a, b) => b.major - a.major).find((h) => h.major >= 25)?.home
}

interface Game {
  version: McVersion
  classpath: string
}

/** 26.1+ versions of the table whose client jar is installed in one of the folders. */
function findGames(): Game[] {
  const games: Game[] = []
  for (const version of versionTable.versions) {
    if (Number(version.id.split('.')[0]) < 26) continue
    const dir = dirs.find((d) => existsSync(join(d, 'versions', version.id, `${version.id}.jar`)))
    if (!dir) continue
    const meta = JSON.parse(
      readFileSync(join(dir, 'versions', version.id, `${version.id}.json`), 'utf8')
    ) as { libraries: { downloads?: { artifact?: { path: string } } }[] }
    const libs = meta.libraries
      .map((l) => l.downloads?.artifact?.path)
      .filter((p): p is string => !!p)
      .map((p) => dirs.map((d) => join(d, 'libraries', p)).find((f) => existsSync(f)))
      .filter((p): p is string => !!p)
    games.push({
      version,
      classpath: [...libs, join(dir, 'versions', version.id, `${version.id}.jar`)].join(delimiter)
    })
  }
  return games
}

const javaHome = dirs.length > 0 ? findJavaHome() : undefined
const games = javaHome ? findGames() : []

/** Every export the app can produce: each supported release for itself, newer snapshots, with/without the option. */
interface ExportCase {
  file: string
  target: McVersion
  authoring: string
  acceptNewer: boolean
}

const targets = [...snapshotTargets(versionTable), ...supportedVersions(versionTable, new Date())]
const cases: ExportCase[] = targets.flatMap((target) =>
  [false, true].map((acceptNewer) => ({
    file: `${target.id}${acceptNewer ? '-newer' : ''}.zip`,
    target,
    authoring: isSnapshot(target) ? latest(versionTable).id : target.id,
    acceptNewer
  }))
)

type Format = [number, number]
const cmp = (a: Format, b: Format): number => (a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1])

/** What the game should say, from the range the exporter declares (see src/shared/versions/mcmeta.ts). */
function expectedVerdict(game: McVersion, c: ExportCase): string {
  const g: Format = [game.resourcePack.major, game.resourcePack.minor]
  const { major, minor } = c.target.resourcePack
  const min: Format = [major, 0]
  const max: Format = c.acceptNewer
    ? [OPEN_MAX_FORMAT, Number.MAX_SAFE_INTEGER]
    : [major, c.target.mcmetaStyle === 'minmax' ? minor : 0]
  if (cmp(g, min) < 0) return 'TOO_NEW'
  if (cmp(g, max) > 0) return 'TOO_OLD'
  return 'COMPATIBLE'
}

describe.skipIf(games.length === 0)('exported packs in real Minecraft jars', () => {
  let work: string
  const zips: string[] = []

  beforeAll(async () => {
    work = mkdtempSync(join(tmpdir(), 'blocksmith-pack-compat-'))
    const folder = join(work, 'pack')
    await mkdir(join(folder, 'assets/minecraft/textures/block'), { recursive: true })
    await writeFile(
      join(folder, 'assets/minecraft/textures/block/stone.png'),
      makePng(16, 16, [255, 0, 0, 255])
    )
    await writeFile(join(folder, 'pack.png'), makePng(16, 16, [0, 0, 255, 255]))
    for (const c of cases) {
      const project = {
        schemaVersion: 1,
        id: 'p',
        name: 'Compat',
        description: 'Blocksmith compatibility check',
        authoringVersion: c.authoring,
        base: 'vanilla',
        createdAt: '',
        updatedAt: ''
      }
      const out = join(work, c.file)
      await exportPackZip(
        { id: 'p', folder, project: project as never },
        c.target,
        out,
        { vanilla: { getIndex: async () => null } as never, onProgress: () => {} },
        { acceptNewer: c.acceptNewer }
      )
      zips.push(out)
    }
  })

  afterAll(() => {
    if (work) rmSync(work, { recursive: true, force: true })
  })

  it.each(games.map((g) => [g.version.id, g] as const))(
    'Minecraft %s rates every export as expected',
    { timeout: 180_000 },
    (_id, game) => {
      const bin = join(javaHome!, 'bin')
      const classes = join(work, `classes-${game.version.id}`)
      execFileSync(join(bin, 'javac'), [
        '-nowarn',
        '-cp',
        game.classpath,
        '-d',
        classes,
        join(ROOT, 'tests/real-jar/CheckPacks.java')
      ])
      const output = execFileSync(
        join(bin, 'java'),
        ['-cp', `${game.classpath}${delimiter}${classes}`, 'CheckPacks', ...zips],
        { cwd: work, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 << 20 }
      )
      const lines = output.split(/\r?\n/).map((l) => l.split('\t'))
      const gameLine = lines.find((l) => l[0] === 'GAME')
      expect(gameLine?.[1]).toBe(game.version.id)
      const { major, minor } = game.version.resourcePack
      expect(gameLine?.[2]).toBe(`${major}.${minor}`)

      const verdicts = Object.fromEntries(
        lines.filter((l) => l[0] === 'PACK').map((l) => [l[1], `${l[2]} ${l[3]}`])
      )
      console.log(
        `Minecraft ${game.version.id}:\n` +
          cases.map((c) => `  ${c.file.padEnd(30)} ${verdicts[c.file]}`).join('\n')
      )
      for (const c of cases) {
        expect(verdicts[c.file]?.split(' ')[0], c.file).toBe(expectedVerdict(game.version, c))
      }
      // The export for the game's own version always loads.
      expect(verdicts[`${game.version.id}.zip`]).toMatch(/^COMPATIBLE /)
    }
  )
})
