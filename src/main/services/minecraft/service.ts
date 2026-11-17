import { promises as fs } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { hasData, hasResources, type ExportPackType, type Project } from '@shared/model/pack'
import {
  MinecraftErrorCode,
  type GameDir,
  type InstallResult,
  type LiveStatus,
  type MinecraftLink,
  type MinecraftTarget,
  type PackMinecraftStatus
} from '@shared/model/minecraft'
import { AppErrorException } from '../../ipc/registry'
import { writeFileAtomic } from '../packs/files'
import type { PackService } from '../packs/service'
import { buildDeterministicZip } from '../packs/zip'
import { isGameDir, listGameDirs, type GameDirRoot } from './destinations'
import type { MinecraftStore } from './store'
import { removeLiveFolder, syncLiveFolder } from './sync'

export interface MinecraftServiceDeps {
  packs: Pick<PackService, 'exportFiles' | 'locate'>
  store: MinecraftStore
  /** The official launcher's game folder (.minecraft), whether or not it exists; null when unknown. */
  officialRoot: () => string | null
  showItemInFolder: (path: string) => void
  /** Main forwards this as the 'pack.minecraft.status' event. */
  notifyStatus: (packId: string, status: PackMinecraftStatus) => void
  now?: () => Date
  /** Delay between a pack change and the live sync (changes in between are synced together). */
  debounceMs?: number
}

export interface MinecraftService {
  /** The official .minecraft (when it exists) and the folders added by hand, with their worlds. */
  gameDirs(): Promise<GameDir[]>
  /** Remembers a folder picked by the user; throws minecraft.notAGameDir when it is not a game folder. */
  addGameDir(path: string): Promise<GameDir>
  status(packId: string): Promise<PackMinecraftStatus>
  /** Writes `<pack name>.zip` into resourcepacks/ and/or the world's datapacks/, replacing an earlier install. */
  install(target: MinecraftTarget): Promise<InstallResult>
  /** Turns live mode on (first sync done before returning) or off (live folders removed). */
  setLive(packId: string, on: false): Promise<PackMinecraftStatus>
  setLive(packId: string, on: true, target: MinecraftTarget): Promise<PackMinecraftStatus>
  /** Shows the pack's live folder or install in the file manager. */
  reveal(packId: string): Promise<void>
  /** A pack's files changed (any save, undo, AI apply, info edit, deletion): re-syncs its live folders. */
  packChanged(packId: string): void
  /** Re-syncs every pack left in live mode (app start). */
  resume(): void
  /** Resolves once no sync is waiting or running (tests). */
  idle(): Promise<void>
  dispose(): void
}

/** File and folder name of a pack in the game: its name without characters file systems refuse. */
export function gameFileName(name: string): string {
  const cleaned = name
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 64)
    .trim()
  if (!cleaned) return 'pack'
  return /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(cleaned) ? `${cleaned} pack` : cleaned
}

export function liveFolderName(name: string): string {
  return `${gameFileName(name)} [live]`
}

export function createMinecraftService(deps: MinecraftServiceDeps): MinecraftService {
  const { store, packs } = deps
  const now = deps.now ?? (() => new Date())
  const debounceMs = deps.debounceMs ?? 400
  const liveStatus = new Map<string, LiveStatus>()
  /** Live folders written for each pack in this session (so a renamed pack's old folder is removed). */
  const liveFolders = new Map<string, string[]>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const running = new Map<string, Promise<void>>()
  const again = new Set<string>()
  let disposed = false

  function roots(): GameDirRoot[] {
    const official = deps.officialRoot()
    return [
      ...(official ? [{ kind: 'official' as const, path: official }] : []),
      ...store.gameDirs().map((path) => ({ kind: 'custom' as const, path }))
    ]
  }

  async function requireGameDir(id: string): Promise<GameDir> {
    const dir = (await listGameDirs(roots())).find((d) => d.id === id)
    if (!dir) throw new AppErrorException(MinecraftErrorCode.gameDirMissing)
    return dir
  }

  /** Where each part goes: resourcepacks/ or the world's datapacks/. */
  async function destinations(
    project: Project,
    link: Pick<MinecraftLink, 'gameDirId' | 'parts' | 'worldId'>
  ): Promise<{ part: ExportPackType; dir: string }[]> {
    const gameDir = await requireGameDir(link.gameDirId)
    const out: { part: ExportPackType; dir: string }[] = []
    for (const part of [...new Set(link.parts)].sort()) {
      const supported = part === 'resource' ? hasResources(project.kind) : hasData(project.kind)
      if (!supported) throw new AppErrorException(MinecraftErrorCode.partNotInPack, { part })
      if (part === 'resource') {
        out.push({ part, dir: join(gameDir.path, 'resourcepacks') })
        continue
      }
      if (!link.worldId) throw new AppErrorException(MinecraftErrorCode.worldRequired)
      const world = gameDir.worlds.find((w) => w.id === link.worldId)
      if (!world) {
        throw new AppErrorException(MinecraftErrorCode.worldMissing, { world: link.worldId })
      }
      out.push({ part, dir: join(gameDir.path, 'saves', world.id, 'datapacks') })
    }
    return out
  }

  async function projectOf(packId: string): Promise<Project> {
    const location = await packs.locate(packId)
    if (!location) throw new AppErrorException('packs.notFound', { packId })
    return location.project
  }

  async function currentStatus(packId: string): Promise<PackMinecraftStatus> {
    const link = store.link(packId)
    const live: LiveStatus = link?.live
      ? (liveStatus.get(packId) ?? { state: 'syncing' })
      : { state: 'off' }
    const names = link?.live ? (liveFolders.get(packId) ?? []).map((p) => basename(p)) : []
    if (link?.live && names.length === 0) {
      const location = await packs.locate(packId)
      if (location) names.push(liveFolderName(location.project.name))
    }
    return { link, live, liveNames: [...new Set(names)] }
  }

  async function publish(packId: string, live?: LiveStatus): Promise<PackMinecraftStatus> {
    if (live) liveStatus.set(packId, live)
    const status = await currentStatus(packId)
    if (!disposed) deps.notifyStatus(packId, status)
    return status
  }

  function errorStatus(err: unknown): LiveStatus {
    const at = now().toISOString()
    if (err instanceof AppErrorException)
      return { state: 'error', at, code: err.code, params: err.params }
    return { state: 'error', at, code: 'minecraft.syncFailed' }
  }

  async function removeFolders(packId: string, folders: readonly string[]): Promise<void> {
    for (const folder of folders) await removeLiveFolder(folder, packId).catch(() => false)
  }

  /** One live sync of every part; removes folders of an earlier name or destination. */
  async function syncNow(packId: string): Promise<number> {
    const link = store.link(packId)
    if (!link?.live) return 0
    const project = await projectOf(packId)
    const name = liveFolderName(project.name)
    let changed = 0
    const written: string[] = []
    for (const { part, dir } of await destinations(project, link)) {
      const { collected } = await packs.exportFiles(packId, link.version, { packType: part })
      const folder = join(dir, name)
      changed += await syncLiveFolder(folder, packId, collected.files)
      written.push(resolve(folder))
    }
    const stale = (liveFolders.get(packId) ?? []).filter((f) => !written.includes(f))
    await removeFolders(packId, stale)
    liveFolders.set(packId, written)
    return changed
  }

  async function runSync(packId: string): Promise<void> {
    if (!store.link(packId)?.live) return
    if (!(await packs.locate(packId))) {
      // The pack was deleted: its live copies go too.
      await removeFolders(packId, liveFolders.get(packId) ?? [])
      liveFolders.delete(packId)
      liveStatus.delete(packId)
      await store.setLink(packId, null)
      return
    }
    await publish(packId, { state: 'syncing' })
    try {
      const changed = await syncNow(packId)
      await publish(packId, { state: 'synced', at: now().toISOString(), changed })
    } catch (err) {
      await publish(packId, errorStatus(err))
    }
  }

  function schedule(packId: string): void {
    if (disposed) return
    if (running.has(packId)) {
      again.add(packId)
      return
    }
    const task = runSync(packId).finally(() => {
      running.delete(packId)
      if (again.delete(packId)) schedule(packId)
    })
    running.set(packId, task)
  }

  function sameTarget(link: MinecraftLink, target: MinecraftTarget): boolean {
    return (
      link.gameDirId === target.gameDirId &&
      link.version === target.version &&
      link.worldId === target.worldId &&
      [...link.parts].sort().join() === [...target.parts].sort().join()
    )
  }

  function linkFrom(target: MinecraftTarget, live: boolean): MinecraftLink {
    return {
      gameDirId: target.gameDirId,
      version: target.version,
      parts: [...new Set(target.parts)].sort(),
      ...(target.worldId ? { worldId: target.worldId } : {}),
      live
    }
  }

  async function waitFor(packId: string): Promise<void> {
    const timer = timers.get(packId)
    if (timer) clearTimeout(timer)
    timers.delete(packId)
    again.delete(packId)
    await running.get(packId)
  }

  return {
    async gameDirs() {
      return listGameDirs(roots())
    },

    async addGameDir(path) {
      const abs = resolve(path)
      if (!(await isGameDir(abs))) throw new AppErrorException(MinecraftErrorCode.notAGameDir)
      if (deps.officialRoot() === null || resolve(deps.officialRoot()!) !== abs) {
        await store.addGameDir(abs)
      }
      const dir = (await listGameDirs(roots())).find((d) => d.path === abs)
      if (!dir) throw new AppErrorException(MinecraftErrorCode.notAGameDir)
      return dir
    },

    status: currentStatus,

    async install(target) {
      const project = await projectOf(target.packId)
      const where = await destinations(project, target)
      const name = `${gameFileName(project.name)}.zip`
      const written: InstallResult['written'] = []
      const warnings = new Map<string, { code: string; path?: string }>()
      for (const { part, dir } of where) {
        const { collected } = await packs.exportFiles(target.packId, target.version, {
          packType: part
        })
        await fs.mkdir(dir, { recursive: true })
        await writeFileAtomic(join(dir, name), buildDeterministicZip(collected.files))
        written.push({ part, name })
        for (const w of collected.warnings) warnings.set(`${w.code}|${w.path ?? ''}`, w)
      }
      // Remember the destination for next time (not while live mode runs on another one).
      const link = store.link(target.packId)
      if (!link?.live) await store.setLink(target.packId, linkFrom(target, false))
      return { written, warnings: [...warnings.values()] }
    },

    async setLive(packId: string, on: boolean, target?: MinecraftTarget) {
      await waitFor(packId)
      const link = store.link(packId)
      if (!on) {
        await removeFolders(packId, liveFolders.get(packId) ?? [])
        // Folders of an earlier session: recompute them from the saved destination.
        if (link?.live && !liveFolders.has(packId)) {
          const location = await packs.locate(packId)
          if (location) {
            const where = await destinations(location.project, link).catch(() => [])
            const name = liveFolderName(location.project.name)
            await removeFolders(
              packId,
              where.map((w) => join(w.dir, name))
            )
          }
        }
        liveFolders.delete(packId)
        liveStatus.delete(packId)
        if (link) await store.setLink(packId, { ...link, live: false })
        return publish(packId)
      }
      if (!target) throw new AppErrorException('ipc.invalidInput')
      if (link?.live && !sameTarget(link, target)) {
        await removeFolders(packId, liveFolders.get(packId) ?? [])
        liveFolders.delete(packId)
      }
      await store.setLink(packId, linkFrom(target, true))
      await publish(packId, { state: 'syncing' })
      try {
        const changed = await syncNow(packId)
        return await publish(packId, { state: 'synced', at: now().toISOString(), changed })
      } catch (err) {
        // The first sync failed (folder not ours, missing world...): live mode stays off.
        await store.setLink(packId, linkFrom(target, false))
        liveStatus.delete(packId)
        await publish(packId)
        throw err
      }
    },

    async reveal(packId) {
      const link = store.link(packId)
      if (!link) return
      const project = await projectOf(packId)
      const [first] = await destinations(project, link)
      if (!first) return
      const candidates = [
        ...(link.live
          ? (liveFolders.get(packId) ?? [join(first.dir, liveFolderName(project.name))])
          : []),
        join(first.dir, `${gameFileName(project.name)}.zip`),
        first.dir
      ]
      for (const path of candidates) {
        try {
          await fs.access(path)
          deps.showItemInFolder(path)
          return
        } catch {
          // Try the next one.
        }
      }
    },

    packChanged(packId) {
      if (disposed || !store.link(packId)?.live) return
      const timer = timers.get(packId)
      if (timer) clearTimeout(timer)
      timers.set(
        packId,
        setTimeout(() => {
          timers.delete(packId)
          schedule(packId)
        }, debounceMs)
      )
    },

    resume() {
      for (const [packId, link] of store.links()) if (link.live) schedule(packId)
    },

    async idle() {
      while (timers.size > 0 || running.size > 0) {
        await Promise.all([...running.values()])
        if (timers.size > 0) await new Promise((r) => setTimeout(r, debounceMs + 5))
      }
    },

    dispose() {
      disposed = true
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
    }
  } as MinecraftService
}
