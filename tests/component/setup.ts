import { vi } from 'vitest'
import { defaultSettings, applySettingsPatch, type Settings } from '@shared/model/settings'
import type { UpdaterStatus, WhatsNew } from '@shared/model/updater'
import type { CategorySummary, PackSummary, TextureEntry } from '@shared/model/pack'
import type { VanillaAvailability } from '@shared/model/vanilla'
import type { EvalReport, ModelInfo, ModelRef, ProviderStatus } from '@shared/ai/types'
import type { BulkPreview } from '@shared/model/bulk'
import type { DataEntry, DataFileData, DataList } from '@shared/model/data'
import type { DoctorReport } from '@shared/model/pack'
import type { CustomItem, ItemCatalog, ItemList, ItemSummary } from '@shared/model/items'
import { itemTexturePath } from '@shared/items/schema'

/**
 * In-memory fake of the preload bridge (`window.blocksmith`) for component tests.
 * Tests can inspect `fakeBridge.calls` and push events with `fakeBridge.emit`.
 */
export interface FakeBridge {
  settings: Settings
  updater: UpdaterStatus
  /** Result of app.whatsNew (the launch after an update). */
  whatsNew: WhatsNew | null
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
  /** Custom items (items.list), their definitions (items.read), the catalog and the base item's recipe uses. */
  itemList: ItemList
  itemDefs: Record<string, CustomItem>
  itemCatalog: ItemCatalog
  baseRecipeUses: string[]
  /** Result of pack.doctor. */
  doctor: DoctorReport
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

/** A handler throws this to answer with a typed AppError. */
export class FakeAppError {
  constructor(
    public code: string,
    public params?: Record<string, string | number>
  ) {}
}

function itemSummary(item: CustomItem): ItemSummary {
  return {
    id: item.id,
    namespace: item.namespace,
    kind: item.kind,
    base: item.base,
    names: item.names,
    texture: itemTexturePath(item),
    hasTexture: true
  }
}

/** items.create / items.save: the definition replaces `previousId` in the fake pack. */
function writeItem(item: CustomItem, previousId?: string): ItemSummary {
  if (previousId) delete fakeBridge.itemDefs[previousId]
  fakeBridge.itemDefs[item.id] = item
  const others = fakeBridge.itemList.items.filter((i) => i.id !== previousId && i.id !== item.id)
  fakeBridge.itemList = { ...fakeBridge.itemList, items: [...others, itemSummary(item)] }
  return itemSummary(item)
}

export const fakeBridge: FakeBridge = {
  settings: defaultSettings(),
  updater: { state: 'disabled', reason: 'dev' },
  whatsNew: null,
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
  itemList: { items: [], invalid: [], namespace: 'my_pack' },
  itemDefs: {},
  itemCatalog: { version: '26.3', items: [], tags: [] },
  baseRecipeUses: [],
  doctor: { issues: [], targets: [], files: 0 },
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
  'ai.item.send': () => ({ runId: 'item-1' }),
  'ai.item.explain': () => ({ runId: 'item-explain-1' }),
  'ai.agent.conversation': () => [],
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
  'items.list': () => fakeBridge.itemList,
  'items.read': (input) => {
    const { id } = input as { id: string }
    const item = fakeBridge.itemDefs[id]
    if (!item) throw new FakeAppError('items.notFound', { id })
    return structuredClone(item)
  },
  'items.create': (input) => {
    const { item } = input as { item: CustomItem }
    if (fakeBridge.itemDefs[item.id]) throw new FakeAppError('items.exists', { id: item.id })
    return writeItem(item)
  },
  'items.save': (input) => {
    const { id, item } = input as { id: string; item: CustomItem }
    return writeItem(item, id)
  },
  'items.delete': (input) => {
    const { id } = input as { id: string }
    delete fakeBridge.itemDefs[id]
    fakeBridge.itemList = {
      ...fakeBridge.itemList,
      items: fakeBridge.itemList.items.filter((i) => i.id !== id)
    }
  },
  'items.regenerate': () => undefined,
  'items.catalog': () => fakeBridge.itemCatalog,
  'items.context': () => ({ baseRecipeUses: fakeBridge.baseRecipeUses }),
  'pack.doctor': () => fakeBridge.doctor,
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
  'app.whatsNew': () => fakeBridge.whatsNew,
  'app.openExternal': () => undefined,
  'app.copyText': () => undefined,
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
      try {
        return { ok: true, value: handler(payload) }
      } catch (err) {
        if (err instanceof FakeAppError) {
          return { ok: false, error: { code: err.code, params: err.params } }
        }
        throw err
      }
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
