/**
 * Finds Minecraft client jars on disk: official launcher, Prism Launcher, MultiMC, Modrinth App, CurseForge, plus
 * folders or jars added by hand (settings.minecraftPaths). Only release ids listed in the version table are
 * reported. Missing folders are skipped silently. See docs/versions.md for the layouts.
 */
import { stat, readFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import type { MinecraftInstall } from '@shared/model/vanilla'
import { parseJarVersionJson } from './version-json'

export type LauncherId = MinecraftInstall['launcher']

/**
 * Where client jars live relative to a launcher root:
 * - 'versions':  versions/<id>/<id>.jar (official launcher, CurseForge's minecraft/Install)
 * - 'libraries': libraries/com/mojang/minecraft/<id>/minecraft-<id>-client.jar (Prism Launcher, MultiMC)
 * - 'meta':      meta/versions/<id>/<id>.jar (Modrinth App)
 * - 'flat':      <id>/<id>.jar (a `versions` folder picked by hand)
 */
export type JarLayout = 'versions' | 'libraries' | 'meta' | 'flat'

export interface DetectEnv {
  platform: NodeJS.Platform
  homedir: string
  env: Record<string, string | undefined>
}

export interface DetectFs {
  isFile(path: string): Promise<boolean>
  isDirectory(path: string): Promise<boolean>
  readFile(path: string): Promise<Uint8Array>
  /** Cache key for a file, `<size in bytes>:<mtime>`; null if missing. */
  fingerprint(path: string): Promise<string | null>
}

export const nodeDetectFs: DetectFs = {
  async isFile(path) {
    try {
      return (await stat(path)).isFile()
    } catch {
      return false
    }
  },
  async isDirectory(path) {
    try {
      return (await stat(path)).isDirectory()
    } catch {
      return false
    }
  },
  readFile: (path) => readFile(path),
  async fingerprint(path) {
    try {
      const s = await stat(path)
      return `${s.size}:${s.mtimeMs}`
    } catch {
      return null
    }
  }
}

export interface LauncherCandidate {
  launcher: LauncherId
  root: string
  layout: JarLayout
}

/** Default launcher folders for a platform (they may or may not exist). */
export function launcherCandidates({ platform, homedir, env }: DetectEnv): LauncherCandidate[] {
  const c = (launcher: LauncherId, root: string, layout: JarLayout): LauncherCandidate => ({
    launcher,
    root,
    layout
  })
  if (platform === 'win32') {
    const appData = env['APPDATA'] || join(homedir, 'AppData', 'Roaming')
    return [
      c('official', join(appData, '.minecraft'), 'versions'),
      c('prism', join(appData, 'PrismLauncher'), 'libraries'),
      // MultiMC is portable on Windows (no fixed folder): users add it by hand.
      c('modrinth', join(appData, 'com.modrinth.theseus'), 'meta'),
      c('modrinth', join(appData, 'ModrinthApp'), 'meta'),
      c('curseforge', join(homedir, 'curseforge', 'minecraft', 'Install'), 'versions')
    ]
  }
  if (platform === 'darwin') {
    const support = join(homedir, 'Library', 'Application Support')
    return [
      c('official', join(support, 'minecraft'), 'versions'),
      c('prism', join(support, 'PrismLauncher'), 'libraries'),
      c('multimc', join(support, 'MultiMC'), 'libraries'),
      c('modrinth', join(support, 'com.modrinth.theseus'), 'meta'),
      c('modrinth', join(support, 'ModrinthApp'), 'meta'),
      c('curseforge', join(homedir, 'Documents', 'curseforge', 'minecraft', 'Install'), 'versions')
    ]
  }
  const data = env['XDG_DATA_HOME'] || join(homedir, '.local', 'share')
  return [
    c('official', join(homedir, '.minecraft'), 'versions'),
    c('prism', join(data, 'PrismLauncher'), 'libraries'),
    c(
      'prism',
      join(homedir, '.var', 'app', 'org.prismlauncher.PrismLauncher', 'data', 'PrismLauncher'),
      'libraries'
    ),
    c('multimc', join(data, 'multimc'), 'libraries'),
    c('modrinth', join(data, 'com.modrinth.theseus'), 'meta'),
    c('modrinth', join(data, 'ModrinthApp'), 'meta')
  ]
}

export function jarPathFor(root: string, layout: JarLayout, id: string): string {
  switch (layout) {
    case 'versions':
      return join(root, 'versions', id, `${id}.jar`)
    case 'libraries':
      return join(root, 'libraries', 'com', 'mojang', 'minecraft', id, `minecraft-${id}-client.jar`)
    case 'meta':
      return join(root, 'meta', 'versions', id, `${id}.jar`)
    case 'flat':
      return join(root, id, `${id}.jar`)
  }
}

async function scanLayouts(
  root: string,
  layouts: readonly JarLayout[],
  versionIds: readonly string[],
  fs: DetectFs
): Promise<MinecraftInstall['versions']> {
  const found: MinecraftInstall['versions'] = []
  for (const id of versionIds) {
    for (const layout of layouts) {
      const jarPath = jarPathFor(root, layout, id)
      if (await fs.isFile(jarPath)) {
        found.push({ id, jarPath })
        break
      }
    }
  }
  return found
}

const jarIdCache = new Map<string, string | null>()
const MAX_JAR_BYTES = 256 * 1024 * 1024

/** Version id of a client jar, from its file name when it is a known id, else from its version.json. */
export async function jarVersionId(
  jarPath: string,
  versionIds: readonly string[],
  fs: DetectFs = nodeDetectFs
): Promise<string | null> {
  const name = basename(jarPath)
  const fromName = /^minecraft-(.+)-client\.jar$/i.exec(name)?.[1] ?? /^(.+)\.jar$/i.exec(name)?.[1]
  if (fromName && versionIds.includes(fromName)) return fromName

  const fingerprint = await fs.fingerprint(jarPath)
  // Client jars are ~30-50 MB; do not load arbitrary huge files to look for a version.json.
  if (!fingerprint || Number.parseInt(fingerprint, 10) > MAX_JAR_BYTES) return null
  const key = `${jarPath}|${fingerprint}`
  if (jarIdCache.has(key)) return jarIdCache.get(key) ?? null
  let id: string | null
  try {
    const files = unzipSync(await fs.readFile(jarPath), {
      filter: (f) => f.name === 'version.json'
    })
    const bytes = files['version.json']
    id = bytes ? (parseJarVersionJson(JSON.parse(strFromU8(bytes)))?.id ?? null) : null
  } catch {
    id = null
  }
  jarIdCache.set(key, id)
  return id
}

/** Scans one folder or jar added by hand. Returns null when it holds no known release. */
export async function scanManualPath(
  path: string,
  versionIds: readonly string[],
  fs: DetectFs = nodeDetectFs
): Promise<MinecraftInstall | null> {
  const root = resolve(path)
  if (await fs.isFile(root)) {
    if (!root.toLowerCase().endsWith('.jar')) return null
    const id = await jarVersionId(root, versionIds, fs)
    if (!id || !versionIds.includes(id)) return null
    return { launcher: 'custom', path: root, versions: [{ id, jarPath: root }] }
  }
  if (!(await fs.isDirectory(root))) return null
  // A launcher root (any supported layout), a CurseForge folder, or a bare `versions` folder.
  const versions = await scanLayouts(
    root,
    ['versions', 'libraries', 'meta', 'flat'],
    versionIds,
    fs
  )
  const known = new Set(versions.map((v) => v.id))
  for (const sub of [join(root, 'minecraft', 'Install'), join(root, 'Install')]) {
    for (const v of await scanLayouts(sub, ['versions'], versionIds, fs)) {
      if (!known.has(v.id)) {
        known.add(v.id)
        versions.push(v)
      }
    }
  }
  return versions.length > 0 ? { launcher: 'custom', path: root, versions } : null
}

export interface DetectOptions {
  env: DetectEnv
  /** Release ids to look for (the version table). */
  versionIds: readonly string[]
  /** settings.minecraftPaths */
  manualPaths: readonly string[]
  fs?: DetectFs
}

/**
 * Auto-detected launchers whose folder exists (even with no known version, so the UI can say so), followed by
 * manual entries that still exist and contain at least one known release.
 */
export async function detectInstalls({
  env,
  versionIds,
  manualPaths,
  fs = nodeDetectFs
}: DetectOptions): Promise<MinecraftInstall[]> {
  const installs: MinecraftInstall[] = []
  const seen = new Set<string>()
  for (const candidate of launcherCandidates(env)) {
    const root = resolve(candidate.root)
    if (seen.has(root) || !(await fs.isDirectory(root))) continue
    seen.add(root)
    installs.push({
      launcher: candidate.launcher,
      path: root,
      versions: await scanLayouts(root, [candidate.layout], versionIds, fs)
    })
  }
  for (const manual of manualPaths) {
    const root = resolve(manual)
    if (seen.has(root)) continue
    seen.add(root)
    const install = await scanManualPath(root, versionIds, fs)
    if (install) installs.push(install)
  }
  return installs
}
