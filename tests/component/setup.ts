import { vi } from 'vitest'
import { defaultSettings, applySettingsPatch, type Settings } from '@shared/model/settings'
import type { UpdaterStatus } from '@shared/model/updater'
import type { CategorySummary, PackSummary, TextureEntry } from '@shared/model/pack'
import type { VanillaAvailability } from '@shared/model/vanilla'
import type { EvalReport, ModelInfo, ModelRef, ProviderStatus } from '@shared/ai/types'
import type { BulkPreview } from '@shared/model/bulk'
import type { DataEntry, DataFileData, DataList } from '@shared/model/data'

/**
 * In-memory fake of the preload bridge (`window.blocksmith`) for component tests.
 * Tests can inspect `fakeBridge.calls` and push events with `fakeBridge.emit`.
 */
export interface FakeBridge {
  settings: Settings
  updater: UpdaterStatus
  packs: PackSummary[]
  textures: TextureEntry[]
  categories: CategorySummary[]
  versions: VanillaAvailability[]
  providers: ProviderStatus[]
  models: ModelInfo[]
  /** Settings > "Test models" results, by model id. */
  evalReports: Record<string, EvalReport>
  /** Result of bulk.preview (manual bulk action). */
  bulkPreview: BulkPreview | null
  /** Data browser (data.list) and file texts (data.read), by path. */
  dataList: DataList
  dataFiles: Record<string, DataFileData>
  calls: Array<{ channel: string; payload: unknown }>
  emit(channel: string, payload: unknown): void
}

const listeners = new Map<string, Set<(p: unknown) => void>>()

/** Entry returned by data.create / data.save: the pack's own file. */
function dataEntry({ path }: { path: string }): DataEntry {
  const [, namespace = '', folder = ''] = path.split('/')
  const existing = fakeBridge.dataList.entries.find((e) => e.path === path)
  return {
    path,
    namespace,
    kind: existing?.kind ?? (folder === 'function' ? 'function' : (folder as DataEntry['kind'])),
    id:
      existing?.id ??
      `${namespace}:${path
        .split('/')
        .slice(3)
        .join('/')
        .replace(/\.\w+$/, '')}`,
    status: existing && existing.status !== 'added' ? 'modified' : 'added'
  }
}

export const fakeBridge: FakeBridge = {
  settings: defaultSettings(),
  updater: { state: 'disabled', reason: 'dev' },
  packs: [],
  textures: [],
  categories: [],
  versions: [],
  providers: [],
  models: [],
  evalReports: {},
  bulkPreview: null,
  dataList: { entries: [], vanillaData: true, ids: { items: [], blocks: [], tags: {} } },
  dataFiles: {},
  calls: [],
  emit(channel, payload) {
    listeners.get(channel)?.forEach((l) => l(payload))
  }
}

const handlers: Record<string, (payload: unknown) => unknown> = {
  'settings.get': () => fakeBridge.settings,
  'settings.update': (patch) => {
    fakeBridge.settings = applySettingsPatch(fakeBridge.settings, patch as never)
    return fakeBridge.settings
  },
  'ai.providers.list': () => fakeBridge.providers,
  'ai.providers.save': (config) => {
    const c = config as Omit<ProviderStatus, 'hasKey' | 'keyRequired'>
    const status = { hasKey: false, keyRequired: true, ...c }
    fakeBridge.providers = [...fakeBridge.providers.filter((p) => p.id !== c.id), status]
    return fakeBridge.providers
  },
  'ai.models.list': () => fakeBridge.models,
  'ai.eval.run': (input) => {
    const { model } = input as { model: ModelRef }
    return fakeBridge.evalReports[model.modelId]
  },
  'ai.eval.stop': () => undefined,
  'ai.data.explain': () => ({ runId: 'explain-1' }),
  'ai.agent.stop': () => undefined,
  'bulk.preview': () => fakeBridge.bulkPreview,
  'bulk.apply': (input) => ({ applied: (input as { paths: string[] }).paths.length }),
  'bulk.discard': () => undefined,
  'data.list': () => fakeBridge.dataList,
  'data.read': (input) => {
    const { path } = input as { path: string }
    return fakeBridge.dataFiles[path] ?? { path, text: null, origin: 'none', vanillaText: null }
  },
  'data.create': (input) => dataEntry(input as { path: string }),
  'data.save': (input) => dataEntry(input as { path: string }),
  'data.delete': () => undefined,
  'updater.getStatus': () => fakeBridge.updater,
  'updater.check': () => fakeBridge.updater,
  'workspace.get': () => ({ path: '/Users/test/Documents/Blocksmith Studio' }),
  'packs.list': () => fakeBridge.packs,
  'packs.create': (input) => {
    const i = input as {
      name: string
      description?: string
      base: 'vanilla' | 'empty'
      kind?: PackSummary['kind']
      authoringVersion: string
    }
    const pack: PackSummary = {
      id: `p${fakeBridge.packs.length + 1}`,
      name: i.name,
      description: i.description ?? '',
      authoringVersion: i.authoringVersion,
      base: i.base,
      kind: i.kind ?? 'resource',
      folder: `/ws/packs/${i.name}`,
      changedCount: 0,
      updatedAt: '2026-11-15T12:00:00.000Z'
    }
    fakeBridge.packs = [pack, ...fakeBridge.packs]
    return pack
  },
  'pack.get': (input) =>
    fakeBridge.packs.find((p) => p.id === (input as { packId: string }).packId),
  'pack.textures': () => fakeBridge.textures,
  'pack.categories': () => fakeBridge.categories,
  'minecraft.detect': () => [],
  'vanilla.availability': () => fakeBridge.versions,
  'app.getInfo': () => ({
    name: 'Blocksmith Studio',
    version: '26.46.0',
    platform: 'darwin',
    arch: 'arm64',
    electron: '45.0.0',
    chrome: '1',
    node: '22',
    isPackaged: false
  })
}

Object.defineProperty(window, 'blocksmith', {
  value: {
    invoke: vi.fn(async (channel: string, payload?: unknown) => {
      fakeBridge.calls.push({ channel, payload })
      const handler = handlers[channel]
      if (!handler) return { ok: false, error: { code: 'ipc.unknownChannel' } }
      return { ok: true, value: handler(payload) }
    }),
    on: vi.fn((channel: string, listener: (p: unknown) => void) => {
      if (!listeners.has(channel)) listeners.set(channel, new Set())
      listeners.get(channel)!.add(listener)
      return () => listeners.get(channel)?.delete(listener)
    })
  },
  configurable: true
})

// Naive UI relies on matchMedia (useOsTheme).
if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    value: () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined
    })
  })
}
