import { promises as fs } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { z } from 'zod'
import { MinecraftErrorCode } from '@shared/model/minecraft'
import { AppErrorException } from '../../ipc/registry'
import { writeFileAtomic } from '../packs/files'
import { sha256 } from '../packs/paths'
import type { PackFile } from '../packs/validation'
import { isSafeRelativePath, resolveInside } from '../vanilla/paths'

/**
 * Live mode folders: an unzipped copy of the pack in the game's resourcepacks/ (or a world's datapacks/), kept in
 * sync file by file. A marker file records which pack owns the folder and the hash of every file written, so the
 * app only ever changes folders it created, and only rewrites files whose content changed.
 */
export const LIVE_MARKER = '.blocksmith-live.json'

const MarkerSchema = z.object({
  packId: z.string(),
  files: z.record(z.string(), z.string())
})
type Marker = z.infer<typeof MarkerSchema>

async function readMarker(folder: string): Promise<Marker | null> {
  try {
    const parsed = MarkerSchema.safeParse(
      JSON.parse(await fs.readFile(join(folder, LIVE_MARKER), 'utf8'))
    )
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

async function readdirOrNull(folder: string): Promise<string[] | null> {
  try {
    return await fs.readdir(folder)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await fs.stat(path)).isFile()
  } catch {
    return false
  }
}

/** The folder's marker when `packId` owns it; throws minecraft.folderNotOurs for any other non-empty folder. */
async function ownedMarker(folder: string, packId: string): Promise<Marker | null> {
  const entries = await readdirOrNull(folder)
  if (entries === null || entries.length === 0) return null
  const marker = await readMarker(folder)
  if (marker?.packId !== packId) {
    throw new AppErrorException(MinecraftErrorCode.folderNotOurs, {
      name: folder.split(sep).pop() ?? folder
    })
  }
  return marker
}

/** Removes empty folders from `start` up to (not including) `root`. */
async function pruneEmpty(root: string, start: string): Promise<void> {
  let dir = start
  while (dir !== root && !relative(root, dir).startsWith('..')) {
    const entries = await readdirOrNull(dir)
    if (entries === null || entries.length > 0) return
    await fs.rmdir(dir)
    dir = dirname(dir)
  }
}

/**
 * Makes `folder` contain exactly `files`: writes new or changed files (and files deleted from the folder by hand),
 * removes files the previous sync wrote that are gone, then updates the marker. Returns how many files changed.
 */
export async function syncLiveFolder(
  folder: string,
  packId: string,
  files: readonly PackFile[]
): Promise<number> {
  const previous = (await ownedMarker(folder, packId))?.files ?? {}
  await fs.mkdir(folder, { recursive: true })
  const next: Record<string, string> = {}
  let changed = 0
  for (const file of files) {
    const target = isSafeRelativePath(file.path) ? resolveInside(folder, file.path) : null
    if (!target || file.path === LIVE_MARKER) continue
    const hash = sha256(file.data)
    next[file.path] = hash
    if (previous[file.path] === hash && (await fileExists(target))) continue
    await fs.mkdir(dirname(target), { recursive: true })
    await writeFileAtomic(target, file.data)
    changed++
  }
  for (const path of Object.keys(previous)) {
    if (path in next) continue
    const target = isSafeRelativePath(path) ? resolveInside(folder, path) : null
    if (!target) continue
    await fs.rm(target, { force: true })
    await pruneEmpty(folder, dirname(target))
    changed++
  }
  await writeFileAtomic(
    join(folder, LIVE_MARKER),
    JSON.stringify({ packId, files: next } satisfies Marker) + '\n'
  )
  return changed
}

/** Deletes a live folder `packId` owns. Returns false (and leaves it) when the folder is missing or not ours. */
export async function removeLiveFolder(folder: string, packId: string): Promise<boolean> {
  const marker = await readMarker(folder)
  if (marker?.packId !== packId) return false
  await fs.rm(folder, { recursive: true, force: true })
  return true
}
