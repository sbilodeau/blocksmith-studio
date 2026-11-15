import { vi } from 'vitest'
import { defaultSettings, applySettingsPatch, type Settings } from '@shared/model/settings'
import type { UpdaterStatus } from '@shared/model/updater'
import type { CategorySummary, PackSummary, TextureEntry } from '@shared/model/pack'
import type { VanillaAvailability } from '@shared/model/vanilla'

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
  calls: Array<{ channel: string; payload: unknown }>
  emit(channel: string, payload: unknown): void
}

const listeners = new Map<string, Set<(p: unknown) => void>>()

export const fakeBridge: FakeBridge = {
  settings: defaultSettings(),
  updater: { state: 'disabled', reason: 'dev' },
  packs: [],
  textures: [],
  categories: [],
  versions: [],
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
  'updater.getStatus': () => fakeBridge.updater,
  'updater.check': () => fakeBridge.updater,
  'workspace.get': () => ({ path: '/Users/test/Documents/Blocksmith Studio' }),
  'packs.list': () => fakeBridge.packs,
  'packs.create': (input) => {
    const i = input as { name: string; description?: string; base: 'vanilla' | 'empty'; authoringVersion: string }
    const pack: PackSummary = {
      id: `p${fakeBridge.packs.length + 1}`,
      name: i.name,
      description: i.description ?? '',
      authoringVersion: i.authoringVersion,
      base: i.base,
      folder: `/ws/packs/${i.name}`,
      changedCount: 0,
      updatedAt: '2026-11-15T12:00:00.000Z'
    }
    fakeBridge.packs = [pack, ...fakeBridge.packs]
    return pack
  },
  'pack.get': (input) => fakeBridge.packs.find((p) => p.id === (input as { packId: string }).packId),
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
