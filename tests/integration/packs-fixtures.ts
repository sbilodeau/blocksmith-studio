/**
 * Test helpers for the packs integration tests: generated PNGs, a fake VanillaStore backed by a temp folder,
 * and a pack service wired to a temp workspace. No Mojang assets are used.
 */
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { encode } from 'fast-png'
import { vi } from 'vitest'
import type { McVersion, PackFormat } from '@shared/model/versions'
import type { VanillaIndex, VanillaIndexEntry } from '@shared/model/vanilla'
import type { JobReporter, VanillaStore } from '../../src/main/services/contracts'
import {
  createPackService,
  type PackService,
  type PackServiceDeps
} from '../../src/main/services/packs'

export const VERSIONS: McVersion[] = [
  {
    id: '26.3',
    releaseTime: '2026-10-20T10:00:00+00:00',
    resourcePack: { major: 97, minor: 0 },
    dataPack: { major: 120, minor: 0 },
    mcmetaStyle: 'minmax'
  },
  {
    id: '26.2',
    releaseTime: '2026-07-01T10:00:00+00:00',
    resourcePack: { major: 88, minor: 0 },
    dataPack: { major: 110, minor: 0 },
    mcmetaStyle: 'minmax'
  },
  {
    id: '1.21.4',
    releaseTime: '2024-12-03T10:00:00+00:00',
    resourcePack: { major: 46, minor: 0 },
    dataPack: { major: 61, minor: 0 },
    mcmetaStyle: 'pack_format'
  }
]

/** Solid-colour PNG (optionally with a second colour on the first pixel to make variants). */
export function makePng(
  width: number,
  height: number,
  rgba: [number, number, number, number] = [120, 120, 120, 255],
  firstPixel?: [number, number, number, number]
): Uint8Array {
  const data = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) data.set(rgba, i * 4)
  if (firstPixel) data.set(firstPixel, 0)
  return encode({ width, height, data, channels: 4, depth: 8 })
}

export function sha(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex')
}

export const json = (value: unknown): Uint8Array =>
  new TextEncoder().encode(JSON.stringify(value, null, 2))

/** In-memory VanillaStore over a temp cache folder. Versions listed in `ready` have an index. */
export class FakeVanillaStore implements VanillaStore {
  readonly indexes = new Map<string, VanillaIndex>()
  getIndexCalls = 0

  constructor(readonly cacheDir: string) {}

  supportedVersions(): McVersion[] {
    return VERSIONS
  }
  latestVersion(): McVersion {
    return VERSIONS[0]
  }
  getVersion(versionId: string): McVersion | undefined {
    return VERSIONS.find((v) => v.id === versionId)
  }
  versionForPackFormat(format: PackFormat): McVersion | undefined {
    return VERSIONS.find((v) => v.resourcePack.major === format.major)
  }
  async detectInstalls(): Promise<never[]> {
    return []
  }
  async availability(): Promise<never[]> {
    return []
  }
  async prepare(versionId: string): Promise<VanillaIndex> {
    const index = this.indexes.get(versionId)
    if (!index) throw new Error('not prepared in fake')
    return index
  }
  async getIndex(versionId: string): Promise<VanillaIndex | null> {
    this.getIndexCalls++
    return this.indexes.get(versionId) ?? null
  }
  resolveFile(versionId: string, packPath: string): string | null {
    const index = this.indexes.get(versionId)
    if (!index || !index.entries[packPath]) return null
    return join(this.cacheDir, versionId, ...packPath.split('/'))
  }

  /** Writes vanilla files for a version and builds its index (PNG sizes and animation from .mcmeta). */
  async addVersion(versionId: string, files: Record<string, Uint8Array>): Promise<VanillaIndex> {
    const entries: Record<string, VanillaIndexEntry> = {}
    for (const [path, data] of Object.entries(files)) {
      const abs = join(this.cacheDir, versionId, ...path.split('/'))
      await mkdir(dirname(abs), { recursive: true })
      await writeFile(abs, data)
      const entry: VanillaIndexEntry = { path, sha256: sha(data), size: data.byteLength }
      if (path.endsWith('.png')) {
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
        entry.width = view.getUint32(16)
        entry.height = view.getUint32(20)
        if (files[`${path}.mcmeta`]) {
          entry.animated = true
          entry.frameCount = entry.height / entry.width
        }
      }
      entries[path] = entry
    }
    const version = this.getVersion(versionId)!
    const index: VanillaIndex = {
      schemaVersion: 1,
      versionId,
      resourcePack: version.resourcePack,
      dataPack: version.dataPack,
      createdAt: new Date().toISOString(),
      entries
    }
    this.indexes.set(versionId, index)
    return index
  }
}

export const T = (key: string): string => `assets/minecraft/textures/${key}`

/** A small vanilla 26.3 set covering several categories. */
export function vanillaFiles(): Record<string, Uint8Array> {
  return {
    'pack.png': makePng(64, 64, [1, 2, 3, 255]),
    [T('block/stone.png')]: makePng(16, 16, [125, 125, 125, 255]),
    [T('block/dirt.png')]: makePng(16, 16, [134, 96, 67, 255]),
    [T('block/grass_block_side.png')]: makePng(16, 16, [90, 160, 60, 255]),
    [T('block/diamond_ore.png')]: makePng(16, 16, [100, 200, 200, 255]),
    [T('block/water_still.png')]: makePng(16, 512, [40, 60, 200, 180]),
    [T('block/water_still.png.mcmeta')]: json({ animation: { frametime: 2 } }),
    [T('item/diamond_pickaxe.png')]: makePng(16, 16, [90, 220, 220, 255]),
    [T('item/apple.png')]: makePng(16, 16, [200, 20, 20, 255]),
    [T('entity/zombie/zombie.png')]: makePng(64, 64, [40, 120, 40, 255]),
    [T('gui/sprites/hud/heart/full.png')]: makePng(9, 9, [255, 0, 0, 255]),
    'assets/minecraft/models/block/stone.json': json({ parent: 'block/cube_all' })
  }
}

export interface TestEnv {
  root: string
  documentsDir: string
  vanilla: FakeVanillaStore
  service: PackService
  deps: PackServiceDeps & {
    trashItem: ReturnType<typeof vi.fn>
    showItemInFolder: ReturnType<typeof vi.fn>
    notifyChanged: ReturnType<typeof vi.fn>
    setWorkspacePath: ReturnType<typeof vi.fn>
  }
  progress: Array<{ kind: string; phase: string; done: number; total: number }>
  workspace: { path?: string }
  cleanup(): Promise<void>
}

export async function createTestEnv(
  options: { vanillaReady?: boolean; overrides?: Partial<PackServiceDeps> } = {}
): Promise<TestEnv> {
  const root = await mkdtemp(join(tmpdir(), 'blocksmith-packs-'))
  const documentsDir = join(root, 'Documents')
  await mkdir(documentsDir, { recursive: true })
  const vanilla = new FakeVanillaStore(join(root, 'vanilla'))
  if (options.vanillaReady !== false) await vanilla.addVersion('26.3', vanillaFiles())

  const progress: TestEnv['progress'] = []
  const jobs: JobReporter = {
    start: (kind) => (phase, done, total) => progress.push({ kind, phase, done, total })
  }
  const workspace: { path?: string } = {}
  let clock = Date.parse('2026-11-15T10:00:00Z')
  let counter = 0
  const deps = {
    vanilla,
    jobs,
    documentsDir,
    getWorkspacePath: () => workspace.path,
    setWorkspacePath: vi.fn(async (path: string) => {
      workspace.path = path
    }),
    trashItem: vi.fn(async (path: string) => {
      await rm(path, { recursive: true, force: true })
    }),
    showItemInFolder: vi.fn(),
    notifyChanged: vi.fn(),
    now: () => new Date((clock += 1000)),
    newId: () => `pack${String(++counter).padStart(4, '0')}`
  }
  const service = createPackService({ ...deps, ...options.overrides })
  return {
    root,
    documentsDir,
    vanilla,
    service,
    deps,
    progress,
    workspace,
    cleanup: () => rm(root, { recursive: true, force: true })
  }
}
