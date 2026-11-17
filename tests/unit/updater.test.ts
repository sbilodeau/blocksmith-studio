import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpdaterStatus } from '@shared/model/updater'
import {
  CHECK_INTERVAL_MS,
  FIRST_CHECK_DELAY_MS,
  createUpdaterService,
  releaseNotesToString,
  macDmgUrl,
  type DownloadProgress,
  type UpdaterDeps,
  type UpdaterLogger
} from '../../src/main/services/updater'

// The service is tested through injected deps only; the real modules are never loaded.
vi.mock('electron', () => ({ app: {}, net: {}, shell: {} }))
vi.mock('electron-updater', () => ({ autoUpdater: {} }))

class FakeAutoUpdater extends EventEmitter {
  autoDownload = true
  autoInstallOnAppQuit = false
  logger: UpdaterLogger | null = null
  checkForUpdates = vi.fn(
    async (): Promise<{ isUpdateAvailable?: boolean; updateInfo: { version: string } } | null> =>
      null
  )
  downloadUpdate = vi.fn(async (): Promise<unknown> => [])
  quitAndInstall = vi.fn()
}

class FakeScheduler {
  private nextId = 1
  timeouts = new Map<number, { cb: () => void; ms: number }>()
  intervals = new Map<number, { cb: () => void; ms: number }>()
  setTimeout = vi.fn((cb: () => void, ms: number) => {
    const id = this.nextId++
    this.timeouts.set(id, { cb, ms })
    return id
  })
  clearTimeout = vi.fn((id: unknown) => void this.timeouts.delete(id as number))
  setInterval = vi.fn((cb: () => void, ms: number) => {
    const id = this.nextId++
    this.intervals.set(id, { cb, ms })
    return id
  })
  clearInterval = vi.fn((id: unknown) => void this.intervals.delete(id as number))
  fireTimeouts(): void {
    for (const [id, t] of [...this.timeouts]) {
      this.timeouts.delete(id)
      t.cb()
    }
  }
  fireIntervals(): void {
    for (const t of this.intervals.values()) t.cb()
  }
}

interface Harness {
  deps: UpdaterDeps
  au: FakeAutoUpdater
  scheduler: FakeScheduler
  logger: {
    info: ReturnType<typeof vi.fn>
    warn: ReturnType<typeof vi.fn>
    error: ReturnType<typeof vi.fn>
  }
  downloadFile: ReturnType<typeof vi.fn>
  openPath: ReturnType<typeof vi.fn>
  getAutoUpdater: ReturnType<typeof vi.fn>
}

const DOWNLOADS = join('/Users', 'me', 'Downloads')

function harness(overrides: Partial<UpdaterDeps> = {}): Harness {
  const au = new FakeAutoUpdater()
  const scheduler = new FakeScheduler()
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const downloadFile = vi.fn(
    async (_url: string, _dest: string, onProgress: DownloadProgress): Promise<void> => {
      onProgress(0, 200)
      onProgress(50, 200)
      onProgress(51, 200) // still 25%: no new status
      onProgress(200, 200)
    }
  )
  const openPath = vi.fn(async (): Promise<void> => undefined)
  const getAutoUpdater = vi.fn(() => au)
  const deps: UpdaterDeps = {
    isPackaged: true,
    platform: 'win32',
    arch: 'x64',
    appVersion: '26.45.0',
    getAutoUpdater,
    downloadFile,
    openPath,
    downloadsDir: DOWNLOADS,
    scheduler,
    logger,
    ...overrides
  }
  return { deps, au, scheduler, logger, downloadFile, openPath, getAutoUpdater }
}

function record(service: ReturnType<typeof createUpdaterService>): UpdaterStatus[] {
  const statuses: UpdaterStatus[] = []
  service.onStatus((s) => statuses.push(s))
  return statuses
}

const available = { version: '26.46.0', releaseNotes: '<p>New stuff</p>' }

describe('updater service: disabled', () => {
  it('is disabled in dev and never touches electron-updater', async () => {
    const h = harness({ isPackaged: false })
    const service = createUpdaterService(h.deps)
    expect(service.getStatus()).toEqual({ state: 'disabled', reason: 'dev' })
    service.start({ autoCheck: true })
    expect(await service.check()).toEqual({ state: 'disabled', reason: 'dev' })
    expect(await service.download()).toEqual({ state: 'disabled', reason: 'dev' })
    await service.install()
    expect(h.getAutoUpdater).not.toHaveBeenCalled()
    expect(h.scheduler.setTimeout).not.toHaveBeenCalled()
    expect(h.scheduler.setInterval).not.toHaveBeenCalled()
  })

  it('is unsupported on Linux', async () => {
    const h = harness({ platform: 'linux' })
    const service = createUpdaterService(h.deps)
    expect(service.getStatus()).toEqual({ state: 'disabled', reason: 'unsupported' })
    expect(await service.check()).toEqual({ state: 'disabled', reason: 'unsupported' })
    expect(h.getAutoUpdater).not.toHaveBeenCalled()
  })
})

describe('updater service: Windows (auto mode)', () => {
  let h: Harness
  beforeEach(() => {
    h = harness({ platform: 'win32' })
  })

  it('configures electron-updater for manual download and install on quit', () => {
    const service = createUpdaterService(h.deps)
    expect(service.getStatus()).toEqual({ state: 'idle' })
    expect(h.au.autoDownload).toBe(false)
    expect(h.au.autoInstallOnAppQuit).toBe(true)
    expect(h.au.logger).toBe(h.logger)
  })

  it('maps electron-updater events to statuses and notifies listeners', async () => {
    const service = createUpdaterService(h.deps)
    const statuses = record(service)
    h.au.checkForUpdates.mockImplementation(async () => {
      h.au.emit('checking-for-update')
      h.au.emit('update-available', available)
      return { isUpdateAvailable: true, updateInfo: available }
    })

    expect(await service.check()).toEqual({
      state: 'available',
      version: '26.46.0',
      mode: 'auto',
      releaseNotes: 'New stuff'
    })

    h.au.downloadUpdate.mockImplementation(async () => {
      h.au.emit('download-progress', { percent: 42.4 })
      h.au.emit('update-downloaded', { version: '26.46.0' })
      return []
    })
    expect(await service.download()).toEqual({
      state: 'downloaded',
      version: '26.46.0',
      mode: 'auto'
    })
    expect(h.au.downloadUpdate).toHaveBeenCalledTimes(1)

    expect(statuses.map((s) => s.state)).toEqual([
      'checking',
      'checking',
      'available',
      'downloading',
      'downloading',
      'downloaded'
    ])
    expect(statuses[4]).toEqual({ state: 'downloading', version: '26.46.0', percent: 42 })

    await service.install()
    expect(h.au.quitAndInstall).toHaveBeenCalledWith(true, true)
  })

  it('reports not-available with the current version', async () => {
    const service = createUpdaterService(h.deps)
    h.au.checkForUpdates.mockImplementation(async () => {
      h.au.emit('update-not-available', { version: '26.45.0' })
      return { isUpdateAvailable: false, updateInfo: { version: '26.45.0' } }
    })
    expect(await service.check()).toEqual({ state: 'not-available', currentVersion: '26.45.0' })
  })

  it('falls back to the check result when no event fired', async () => {
    const service = createUpdaterService(h.deps)
    h.au.checkForUpdates.mockResolvedValue({ isUpdateAvailable: true, updateInfo: available })
    expect(await service.check()).toMatchObject({ state: 'available', version: '26.46.0' })
  })

  it('joins release notes given as an array', async () => {
    const service = createUpdaterService(h.deps)
    h.au.emit('update-available', {
      version: '26.46.0',
      releaseNotes: [
        { version: '26.46.0', note: 'B' },
        { version: '26.45.1', note: null },
        { version: '26.45.0', note: 'A' }
      ]
    })
    expect(service.getStatus()).toMatchObject({ releaseNotes: 'B\n\nA' })
  })

  it('keeps Markdown notes and turns HTML notes into text', () => {
    expect(releaseNotesToString('### M12\n\n- **Releases** <3\n')).toBe(
      '### M12\n\n- **Releases** <3'
    )
    expect(
      releaseNotesToString(
        '<h2>What&#39;s new</h2><ul><li><strong>Faster</strong> &amp; safer</li><li>Fix</li></ul><p>End</p>'
      )
    ).toBe("## What's new\n\n- Faster & safer\n- Fix\n\nEnd")
    expect(releaseNotesToString('<p> </p>')).toBeUndefined()
    expect(releaseNotesToString(null)).toBeUndefined()
  })

  it('shares a single in-flight check', async () => {
    const service = createUpdaterService(h.deps)
    const [a, b] = [service.check(), service.check()]
    await Promise.all([a, b])
    expect(h.au.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('does not install before an update is downloaded', async () => {
    const service = createUpdaterService(h.deps)
    await service.install()
    expect(h.au.quitAndInstall).not.toHaveBeenCalled()
    expect(h.logger.warn).toHaveBeenCalled()
  })

  it('does not re-check once an update is downloaded', async () => {
    const service = createUpdaterService(h.deps)
    h.au.emit('update-available', available)
    await service.download()
    h.au.checkForUpdates.mockClear()
    expect(await service.check()).toMatchObject({ state: 'downloaded' })
    expect(h.au.checkForUpdates).not.toHaveBeenCalled()
  })
})

describe('updater service: macOS (manual mode)', () => {
  it.each([
    ['arm64', 'Blocksmith-Studio-26.46.0-arm64.dmg'],
    ['x64', 'Blocksmith-Studio-26.46.0-x64.dmg']
  ])('downloads the %s DMG from the GitHub release into Downloads', async (arch, file) => {
    const h = harness({ platform: 'darwin', arch })
    const service = createUpdaterService(h.deps)
    expect(h.au.autoDownload).toBe(false)
    expect(h.au.autoInstallOnAppQuit).toBe(false)
    const statuses = record(service)

    h.au.checkForUpdates.mockImplementation(async () => {
      h.au.emit('checking-for-update')
      h.au.emit('update-available', available)
      return { isUpdateAvailable: true, updateInfo: available }
    })
    expect(await service.check()).toMatchObject({ state: 'available', mode: 'manual' })

    const result = await service.download()
    const filePath = join(DOWNLOADS, file)
    expect(h.downloadFile).toHaveBeenCalledWith(
      `https://github.com/sbilodeau/blocksmith-studio/releases/download/v26.46.0/${file}`,
      filePath,
      expect.any(Function)
    )
    expect(result).toEqual({ state: 'downloaded', version: '26.46.0', mode: 'manual', filePath })
    expect(statuses.filter((s) => s.state === 'downloading')).toEqual([
      { state: 'downloading', version: '26.46.0', percent: 0 },
      { state: 'downloading', version: '26.46.0', percent: 25 },
      { state: 'downloading', version: '26.46.0', percent: 100 }
    ])
    expect(h.au.downloadUpdate).not.toHaveBeenCalled()

    await service.install()
    expect(h.openPath).toHaveBeenCalledWith(filePath)
    expect(h.au.quitAndInstall).not.toHaveBeenCalled()
  })

  it('ignores electron-updater download events', () => {
    const h = harness({ platform: 'darwin', arch: 'arm64' })
    const service = createUpdaterService(h.deps)
    h.au.emit('update-available', available)
    h.au.emit('download-progress', { percent: 50 })
    h.au.emit('update-downloaded', available)
    expect(service.getStatus()).toMatchObject({ state: 'available' })
  })

  it('builds DMG URLs matching the electron-builder artifact names', () => {
    expect(macDmgUrl('27.3.1', 'arm64')).toBe(
      'https://github.com/sbilodeau/blocksmith-studio/releases/download/v27.3.1/Blocksmith-Studio-27.3.1-arm64.dmg'
    )
    expect(macDmgUrl('27.3.1', 'x64')).toMatch(/Blocksmith-Studio-27\.3\.1-x64\.dmg$/)
  })

  it('reports a download failure', async () => {
    const h = harness({ platform: 'darwin', arch: 'arm64' })
    h.downloadFile.mockRejectedValue(new Error('HTTP 404'))
    const service = createUpdaterService(h.deps)
    h.au.emit('update-available', available)
    expect(await service.download()).toEqual({
      state: 'error',
      code: 'updater.downloadFailed',
      message: 'HTTP 404'
    })
    expect(h.logger.error).toHaveBeenCalled()
  })

  it('reports a failure to open the DMG', async () => {
    const h = harness({ platform: 'darwin', arch: 'arm64' })
    h.openPath.mockRejectedValue(new Error('no handler'))
    const service = createUpdaterService(h.deps)
    h.au.emit('update-available', available)
    await service.download()
    await expect(service.install()).resolves.toBeUndefined()
    expect(service.getStatus()).toMatchObject({ state: 'error', code: 'updater.installFailed' })
  })
})

describe('updater service: scheduling', () => {
  it('checks 10 s after start, then every 6 h', async () => {
    const h = harness()
    const service = createUpdaterService(h.deps)
    service.start({ autoCheck: true })
    expect(h.scheduler.setTimeout).toHaveBeenCalledWith(expect.any(Function), FIRST_CHECK_DELAY_MS)
    expect(h.scheduler.setInterval).toHaveBeenCalledWith(expect.any(Function), CHECK_INTERVAL_MS)
    expect(FIRST_CHECK_DELAY_MS).toBe(10_000)
    expect(CHECK_INTERVAL_MS).toBe(6 * 60 * 60 * 1000)

    expect(h.au.checkForUpdates).not.toHaveBeenCalled()
    h.scheduler.fireTimeouts()
    expect(h.au.checkForUpdates).toHaveBeenCalledTimes(1)
    await service.check() // joins the in-flight check
    expect(h.au.checkForUpdates).toHaveBeenCalledTimes(1)
    h.scheduler.fireIntervals()
    expect(h.au.checkForUpdates).toHaveBeenCalledTimes(2)
  })

  it('is idempotent when started again with autoCheck true', () => {
    const h = harness()
    const service = createUpdaterService(h.deps)
    service.start({ autoCheck: true })
    service.start({ autoCheck: true })
    expect(h.scheduler.setInterval).toHaveBeenCalledTimes(1)
  })

  it('clears the timers when autoCheck turns false, and can restart', () => {
    const h = harness()
    const service = createUpdaterService(h.deps)
    service.start({ autoCheck: true })
    service.start({ autoCheck: false })
    expect(h.scheduler.timeouts.size).toBe(0)
    expect(h.scheduler.intervals.size).toBe(0)
    service.start({ autoCheck: true })
    expect(h.scheduler.intervals.size).toBe(1)
  })

  it('does not schedule anything when autoCheck is false', () => {
    const h = harness()
    createUpdaterService(h.deps).start({ autoCheck: false })
    expect(h.scheduler.setTimeout).not.toHaveBeenCalled()
  })

  it('clears timers and stops notifying on dispose', () => {
    const h = harness()
    const service = createUpdaterService(h.deps)
    const listener = vi.fn()
    service.onStatus(listener)
    service.start({ autoCheck: true })
    service.dispose()
    expect(h.scheduler.intervals.size).toBe(0)
    h.au.emit('update-available', available)
    expect(listener).not.toHaveBeenCalled()
  })

  it('unsubscribes listeners', () => {
    const h = harness()
    const service = createUpdaterService(h.deps)
    const listener = vi.fn()
    const off = service.onStatus(listener)
    off()
    h.au.emit('checking-for-update')
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('updater service: errors', () => {
  it('never throws from check() and maps the failure to an error code', async () => {
    const h = harness()
    h.au.checkForUpdates.mockRejectedValue(new Error('net::ERR_INTERNET_DISCONNECTED'))
    const service = createUpdaterService(h.deps)
    await expect(service.check()).resolves.toEqual({
      state: 'error',
      code: 'updater.checkFailed',
      message: 'net::ERR_INTERNET_DISCONNECTED'
    })
    expect(h.logger.error).toHaveBeenCalledWith(expect.stringContaining('updater.checkFailed'))
  })

  it('maps the electron-updater error event according to the current step', async () => {
    const h = harness()
    const service = createUpdaterService(h.deps)
    h.au.checkForUpdates.mockImplementation(async () => {
      h.au.emit('checking-for-update')
      h.au.emit('error', new Error('404 latest.yml'))
      throw new Error('404 latest.yml')
    })
    expect(await service.check()).toMatchObject({ state: 'error', code: 'updater.checkFailed' })

    h.au.emit('update-available', available)
    h.au.downloadUpdate.mockImplementation(async () => {
      h.au.emit('error', new Error('sha512 mismatch'))
      throw new Error('sha512 mismatch')
    })
    expect(await service.download()).toEqual({
      state: 'error',
      code: 'updater.downloadFailed',
      message: 'sha512 mismatch'
    })

    h.au.emit('error', new Error('boom'))
    expect(service.getStatus()).toMatchObject({ state: 'error', code: 'updater.failed' })
  })

  it('reports noUpdate when download() is called without an available update', async () => {
    const h = harness()
    const service = createUpdaterService(h.deps)
    expect(await service.download()).toMatchObject({ state: 'error', code: 'updater.noUpdate' })
    expect(h.au.downloadUpdate).not.toHaveBeenCalled()
  })

  it('keeps notifying other listeners when one throws', () => {
    const h = harness()
    const service = createUpdaterService(h.deps)
    const good = vi.fn()
    service.onStatus(() => {
      throw new Error('listener bug')
    })
    service.onStatus(good)
    h.au.emit('checking-for-update')
    expect(good).toHaveBeenCalledWith({ state: 'checking' })
  })
})
