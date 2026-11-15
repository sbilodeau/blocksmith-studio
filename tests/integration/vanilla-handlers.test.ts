import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultSettings, type Settings } from '@shared/model/settings'
import type { MinecraftInstall, VanillaIndex } from '@shared/model/vanilla'
import type { InvokeChannel } from '@shared/ipc/channels'
import { versionTable, findVersion, latest } from '@shared/versions'

type AnyHandler = (input: unknown) => unknown
const handlers = new Map<InvokeChannel, AnyHandler>()

vi.mock('../../src/main/ipc/registry', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/main/ipc/registry')>()
  return {
    ...original,
    handle: (channel: InvokeChannel, fn: AnyHandler) => handlers.set(channel, fn)
  }
})

const { registerVanillaHandlers, addPathDialogOptions } =
  await import('../../src/main/ipc/vanilla-handlers')
const { AppErrorException } = await import('../../src/main/ipc/registry')

const install: MinecraftInstall = {
  launcher: 'custom',
  path: '/games/mc',
  versions: [{ id: '26.3', jarPath: '/games/mc/versions/26.3/26.3.jar' }]
}

const index = { versionId: '26.3' } as VanillaIndex

function setup(settingsOverride: Partial<Settings> = {}): {
  vanilla: Record<string, ReturnType<typeof vi.fn>>
  dialog: ReturnType<typeof vi.fn>
  addMinecraftPath: ReturnType<typeof vi.fn>
  progress: ReturnType<typeof vi.fn>
  start: ReturnType<typeof vi.fn>
  call: (channel: InvokeChannel, input?: unknown) => Promise<unknown>
} {
  handlers.clear()
  const settings: Settings = { ...defaultSettings(), ...settingsOverride }
  const vanilla = {
    supportedVersions: vi.fn(),
    latestVersion: vi.fn(() => latest(versionTable)),
    getVersion: vi.fn((id: string) => findVersion(versionTable, id)),
    versionForPackFormat: vi.fn(),
    detectInstalls: vi.fn(async () => [install]),
    availability: vi.fn(async () => []),
    prepare: vi.fn(async () => index),
    getIndex: vi.fn(),
    resolveFile: vi.fn(),
    entityModels: vi.fn(async () => null),
    inspectPath: vi.fn(async (): Promise<MinecraftInstall | null> => install)
  }
  const dialog = vi.fn(async () => ({ canceled: false, filePaths: ['/games/mc'] }))
  const addMinecraftPath = vi.fn(async () => undefined)
  const progress = vi.fn()
  const start = vi.fn(() => progress)
  registerVanillaHandlers({
    vanilla,
    settings: { get: () => settings },
    jobs: { start },
    dialog,
    addMinecraftPath,
    platform: 'darwin'
  })
  const call = async (channel: InvokeChannel, input?: unknown): Promise<unknown> => {
    const handler = handlers.get(channel)
    if (!handler) throw new Error(`no handler for ${channel}`)
    return handler(input)
  }
  return { vanilla, dialog, addMinecraftPath, progress, start, call }
}

describe('vanilla IPC handlers', () => {
  beforeEach(() => handlers.clear())

  it('registers the four channels', () => {
    setup()
    expect([...handlers.keys()].sort()).toEqual([
      'minecraft.addPath',
      'minecraft.detect',
      'vanilla.availability',
      'vanilla.prepare'
    ])
  })

  it('minecraft.detect and vanilla.availability delegate to the store', async () => {
    const { call, vanilla } = setup()
    expect(await call('minecraft.detect')).toEqual([install])
    expect(await call('vanilla.availability')).toEqual([])
    expect(vanilla.detectInstalls).toHaveBeenCalledOnce()
    expect(vanilla.availability).toHaveBeenCalledOnce()
  })

  describe('minecraft.addPath', () => {
    it('opens a folder-or-jar picker on macOS and saves a usable path', async () => {
      const { call, dialog, addMinecraftPath, vanilla } = setup()
      expect(await call('minecraft.addPath')).toEqual(install)
      expect(dialog).toHaveBeenCalledWith(addPathDialogOptions('darwin'))
      expect(addPathDialogOptions('darwin').properties).toEqual(
        expect.arrayContaining(['openDirectory', 'openFile'])
      )
      expect(addPathDialogOptions('win32').properties).toContain('openDirectory')
      expect(addPathDialogOptions('win32').properties).not.toContain('openFile')
      expect(vanilla.inspectPath).toHaveBeenCalledWith('/games/mc')
      expect(addMinecraftPath).toHaveBeenCalledWith('/games/mc')
    })

    it('returns null when cancelled', async () => {
      const { call, dialog, addMinecraftPath } = setup()
      dialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
      expect(await call('minecraft.addPath')).toBeNull()
      expect(addMinecraftPath).not.toHaveBeenCalled()
    })

    it('throws minecraft.noVersionsFound when the path has no supported release', async () => {
      const { call, vanilla, addMinecraftPath } = setup()
      vanilla.inspectPath.mockResolvedValueOnce(null)
      const err = await call('minecraft.addPath').catch((e: unknown) => e)
      expect(err).toBeInstanceOf(AppErrorException)
      expect(err).toMatchObject({
        code: 'minecraft.noVersionsFound',
        params: { path: '/games/mc' }
      })
      expect(addMinecraftPath).not.toHaveBeenCalled()
    })

    it('does not store a path twice', async () => {
      const { call, addMinecraftPath } = setup({ minecraftPaths: ['/games/mc'] })
      expect(await call('minecraft.addPath')).toEqual(install)
      expect(addMinecraftPath).not.toHaveBeenCalled()
    })
  })

  describe('vanilla.prepare', () => {
    it('starts a job, passes the consent setting and returns a ready availability', async () => {
      const { call, vanilla, start, progress } = setup({ allowMojangDownload: true })
      expect(await call('vanilla.prepare', { versionId: '26.3' })).toEqual({
        versionId: '26.3',
        releaseTime: '2026-09-15T11:23:02+00:00',
        state: 'ready',
        isLatest: true
      })
      expect(start).toHaveBeenCalledWith('vanilla.prepare')
      expect(vanilla.prepare).toHaveBeenCalledWith('26.3', {
        allowDownload: true,
        onProgress: progress
      })
    })

    it('does not allow downloads without consent and propagates store errors', async () => {
      const { call, vanilla } = setup()
      vanilla.prepare.mockRejectedValueOnce(
        new AppErrorException('vanilla.downloadNotAllowed', { version: '1.21.4' })
      )
      await expect(call('vanilla.prepare', { versionId: '1.21.4' })).rejects.toMatchObject({
        code: 'vanilla.downloadNotAllowed'
      })
      expect(vanilla.prepare).toHaveBeenCalledWith(
        '1.21.4',
        expect.objectContaining({ allowDownload: false })
      )
    })

    it('flags non-latest versions', async () => {
      const { call } = setup()
      expect(await call('vanilla.prepare', { versionId: '1.21.4' })).toMatchObject({
        isLatest: false,
        releaseTime: '2024-12-03T10:12:57+00:00'
      })
    })
  })
})
