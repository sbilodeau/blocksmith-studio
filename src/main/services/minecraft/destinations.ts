import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import type { GameDir, GameWorld } from '@shared/model/minecraft'

/** A candidate game folder: the official launcher's .minecraft or a folder added by hand. */
export interface GameDirRoot {
  kind: GameDir['kind']
  path: string
}

/** Opaque, stable id of a game folder (the renderer never sends paths). */
export function gameDirId(path: string): string {
  return createHash('sha256').update(resolve(path)).digest('hex').slice(0, 16)
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await fs.stat(path)).isDirectory()
  } catch {
    return false
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path)
    return true
  } catch {
    return false
  }
}

/** Entries that only a Minecraft game folder has (any one is enough). */
const GAME_DIR_MARKERS = ['options.txt', 'saves', 'resourcepacks', 'versions']

/** True when `path` looks like a Minecraft game folder (a .minecraft or a launcher instance's game folder). */
export async function isGameDir(path: string): Promise<boolean> {
  if (!(await isDirectory(path))) return false
  for (const marker of GAME_DIR_MARKERS) if (await exists(join(path, marker))) return true
  return false
}

/** Worlds of a game folder: `saves/<folder>` that contain a level.dat, sorted by name. */
export async function listWorlds(gameDir: string): Promise<GameWorld[]> {
  const saves = join(gameDir, 'saves')
  let names: string[]
  try {
    names = (await fs.readdir(saves, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name)
  } catch {
    return []
  }
  const worlds: GameWorld[] = []
  for (const name of names) {
    if (await exists(join(saves, name, 'level.dat'))) worlds.push({ id: name })
  }
  return worlds.sort((a, b) => a.id.localeCompare(b.id))
}

/** The existing folders among `roots` (first occurrence of a path wins), with their worlds. */
export async function listGameDirs(roots: readonly GameDirRoot[]): Promise<GameDir[]> {
  const out: GameDir[] = []
  const seen = new Set<string>()
  for (const root of roots) {
    const path = resolve(root.path)
    if (seen.has(path) || !(await isDirectory(path))) continue
    seen.add(path)
    out.push({ id: gameDirId(path), kind: root.kind, path, worlds: await listWorlds(path) })
  }
  return out
}
