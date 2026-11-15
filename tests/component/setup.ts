import { vi } from 'vitest'
import { defaultSettings, applySettingsPatch, type Settings } from '@shared/model/settings'
import type { UpdaterStatus } from '@shared/model/updater'

/**
 * In-memory fake of the preload bridge (`window.blocksmith`) for component tests.
 * Tests can inspect `fakeBridge.calls` and push events with `fakeBridge.emit`.
 */
export interface FakeBridge {
  settings: Settings
  updater: UpdaterStatus
  calls: Array<{ channel: string; payload: unknown }>
  emit(channel: string, payload: unknown): void
}

const listeners = new Map<string, Set<(p: unknown) => void>>()

export const fakeBridge: FakeBridge = {
  settings: defaultSettings(),
  updater: { state: 'disabled', reason: 'dev' },
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
