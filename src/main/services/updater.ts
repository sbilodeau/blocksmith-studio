import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { app, net, shell } from 'electron'
import { autoUpdater as electronAutoUpdater } from 'electron-updater'
import type { UpdateMode, UpdaterStatus } from '@shared/model/updater'

/**
 * Self-update service.
 * - Windows (NSIS): electron-updater checks GitHub Releases, downloads in the background, installs on restart.
 * - macOS (unsigned, ad-hoc signed): Squirrel.Mac refuses unsigned updates, so we only use electron-updater to
 *   CHECK (latest-mac.yml), then download the matching DMG (arm64/x64) ourselves into Downloads and open it.
 * - Dev / unpackaged: disabled.
 */
export interface UpdaterService {
  getStatus(): UpdaterStatus
  /** Starts periodic checks (startup + every 6 h) when autoCheck is true. Safe to call again to change it. */
  start(options: { autoCheck: boolean }): void
  check(): Promise<UpdaterStatus>
  download(): Promise<UpdaterStatus>
  /** Windows: quit and install. macOS: open the downloaded DMG. */
  install(): Promise<void>
  onStatus(listener: (status: UpdaterStatus) => void): () => void
  dispose(): void
}

/** GitHub repository that hosts the releases (must match `publish` in electron-builder.yml). */
export const RELEASES_REPO = 'sbilodeau/blocksmith-studio'
export const FIRST_CHECK_DELAY_MS = 10_000
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

/** Error codes reported in `{ state: 'error', code }` (i18n key `errors.<code>`). */
export const UpdaterErrorCode = {
  checkFailed: 'updater.checkFailed',
  downloadFailed: 'updater.downloadFailed',
  installFailed: 'updater.installFailed',
  noUpdate: 'updater.noUpdate',
  failed: 'updater.failed'
} as const

/** Subset of electron-updater's `UpdateInfo` used here. */
export interface UpdateInfoLike {
  version: string
  releaseNotes?: string | ReadonlyArray<{ version: string; note: string | null }> | null
}

/** Subset of electron-updater's `AppUpdater` used here (keeps the service testable without Electron). */
export interface AutoUpdaterLike {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  logger: UpdaterLogger | null
  on(event: 'checking-for-update', listener: () => void): unknown
  on(event: 'update-available', listener: (info: UpdateInfoLike) => void): unknown
  on(event: 'update-not-available', listener: (info: UpdateInfoLike) => void): unknown
  on(event: 'download-progress', listener: (progress: { percent: number }) => void): unknown
  on(event: 'update-downloaded', listener: (info: UpdateInfoLike) => void): unknown
  on(event: 'error', listener: (error: Error, message?: string) => void): unknown
  checkForUpdates(): Promise<{ isUpdateAvailable?: boolean; updateInfo: UpdateInfoLike } | null>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
}

export interface UpdaterLogger {
  info(message?: unknown, ...rest: unknown[]): void
  warn(message?: unknown, ...rest: unknown[]): void
  error(message?: unknown, ...rest: unknown[]): void
}

export type TimerHandle = unknown

export interface UpdaterScheduler {
  setTimeout(callback: () => void, ms: number): TimerHandle
  clearTimeout(handle: TimerHandle): void
  setInterval(callback: () => void, ms: number): TimerHandle
  clearInterval(handle: TimerHandle): void
}

export type DownloadProgress = (transferred: number, total: number) => void

export interface UpdaterDeps {
  isPackaged: boolean
  platform: NodeJS.Platform
  arch: string
  appVersion: string
  /** Lazily returns electron-updater's `autoUpdater` (only called when updates are supported). */
  getAutoUpdater(): AutoUpdaterLike
  /** Downloads `url` (following redirects) to `destPath`, reporting progress. */
  downloadFile(url: string, destPath: string, onProgress: DownloadProgress): Promise<void>
  /** Opens a file with the OS default handler; rejects on failure. */
  openPath(path: string): Promise<void>
  downloadsDir: string
  scheduler: UpdaterScheduler
  logger: UpdaterLogger
}

/** Arch-specific DMG file name; must match `dmg.artifactName` in electron-builder.yml. */
export function macDmgFileName(version: string, arch: string): string {
  return `Blocksmith-Studio-${version}-${arch === 'arm64' ? 'arm64' : 'x64'}.dmg`
}

export function macDmgUrl(version: string, arch: string): string {
  return `https://github.com/${RELEASES_REPO}/releases/download/v${version}/${macDmgFileName(version, arch)}`
}

/**
 * Release notes are Markdown from latest.yml (the release workflow puts the changelog there). Without it,
 * electron-updater falls back to GitHub's HTML feed: that is reduced to Markdown-like text, never shown as HTML.
 */
export function releaseNotesToString(notes: UpdateInfoLike['releaseNotes']): string | undefined {
  if (!notes) return undefined
  const text =
    typeof notes === 'string'
      ? notes
      : notes
          .map((n) => n.note ?? '')
          .filter(Boolean)
          .join('\n\n')
  const result = /<\/?[a-z][^>]*>/i.test(text) ? htmlToText(text) : text.trim()
  return result || undefined
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' '
}

function htmlToText(html: string): string {
  return html
    .replace(
      /<h([1-6])[^>]*>/gi,
      (_, level: string) => `\n\n${'#'.repeat(Math.min(4, Number(level)))} `
    )
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<(br|\/p|\/h[1-6]|\/ul|\/ol|\/div)[^>]*>/gi, '\n\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const code =
          e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
        return Number.isFinite(code) ? String.fromCodePoint(code) : m
      }
      return ENTITIES[e.toLowerCase()] ?? m
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function createUpdaterService(
  deps: UpdaterDeps = createDefaultUpdaterDeps()
): UpdaterService {
  const { logger, scheduler } = deps
  const listeners = new Set<(status: UpdaterStatus) => void>()
  const mode: UpdateMode = deps.platform === 'win32' ? 'auto' : 'manual'

  let status: UpdaterStatus
  if (!deps.isPackaged) status = { state: 'disabled', reason: 'dev' }
  else if (deps.platform !== 'win32' && deps.platform !== 'darwin') {
    status = { state: 'disabled', reason: 'unsupported' }
  } else status = { state: 'idle' }

  const enabled = status.state !== 'disabled'
  let updater: AutoUpdaterLike | null = null
  let availableVersion: string | null = null
  let checking: Promise<UpdaterStatus> | null = null
  let downloading: Promise<UpdaterStatus> | null = null
  let firstCheckTimer: TimerHandle | null = null
  let intervalTimer: TimerHandle | null = null
  let disposed = false

  function setStatus(next: UpdaterStatus): void {
    if (disposed) return
    status = next
    for (const listener of listeners) {
      try {
        listener(next)
      } catch (err) {
        logger.error('[updater] status listener failed', err)
      }
    }
  }

  function fail(code: string, err: unknown): UpdaterStatus {
    const message = errorMessage(err)
    logger.error(`[updater] ${code}: ${message}`)
    setStatus({ state: 'error', code, message })
    return status
  }

  function markAvailable(info: UpdateInfoLike): void {
    availableVersion = info.version
    setStatus({
      state: 'available',
      version: info.version,
      mode,
      releaseNotes: releaseNotesToString(info.releaseNotes)
    })
  }

  if (enabled) {
    updater = deps.getAutoUpdater()
    updater.logger = logger
    updater.autoDownload = false
    // Only Windows installs through electron-updater; on macOS Squirrel.Mac would reject the unsigned app.
    updater.autoInstallOnAppQuit = deps.platform === 'win32'

    updater.on('checking-for-update', () => setStatus({ state: 'checking' }))
    updater.on('update-available', (info) => markAvailable(info))
    updater.on('update-not-available', () =>
      setStatus({ state: 'not-available', currentVersion: deps.appVersion })
    )
    if (mode === 'auto') {
      updater.on('download-progress', (progress) => {
        if (!availableVersion) return
        setStatus({
          state: 'downloading',
          version: availableVersion,
          percent: Math.round(progress.percent)
        })
      })
      updater.on('update-downloaded', (info) =>
        setStatus({ state: 'downloaded', version: info.version, mode: 'auto' })
      )
    }
    updater.on('error', (err) => {
      if (status.state === 'checking') fail(UpdaterErrorCode.checkFailed, err)
      else if (status.state === 'downloading') fail(UpdaterErrorCode.downloadFailed, err)
      else fail(UpdaterErrorCode.failed, err)
    })
  }

  async function runCheck(au: AutoUpdaterLike): Promise<UpdaterStatus> {
    setStatus({ state: 'checking' })
    try {
      const result = await au.checkForUpdates()
      // Events normally set the status; fall back to the result if none fired.
      if (status.state === 'checking') {
        if (result?.isUpdateAvailable) markAvailable(result.updateInfo)
        else setStatus({ state: 'not-available', currentVersion: deps.appVersion })
      }
    } catch (err) {
      if (status.state !== 'error') fail(UpdaterErrorCode.checkFailed, err)
    }
    return status
  }

  function check(): Promise<UpdaterStatus> {
    if (!updater || disposed) return Promise.resolve(status)
    // Do not lose a download in progress or an update ready to install.
    if (status.state === 'downloading' || status.state === 'downloaded') {
      return Promise.resolve(status)
    }
    if (!checking) checking = runCheck(updater).finally(() => (checking = null))
    return checking
  }

  async function downloadWindows(au: AutoUpdaterLike, version: string): Promise<UpdaterStatus> {
    setStatus({ state: 'downloading', version, percent: 0 })
    try {
      await au.downloadUpdate()
      if (status.state !== 'downloaded') setStatus({ state: 'downloaded', version, mode: 'auto' })
    } catch (err) {
      // The 'error' event usually reported it already.
      if (status.state !== 'error') fail(UpdaterErrorCode.downloadFailed, err)
    }
    return status
  }

  async function downloadMac(version: string): Promise<UpdaterStatus> {
    const url = macDmgUrl(version, deps.arch)
    const filePath = join(deps.downloadsDir, macDmgFileName(version, deps.arch))
    logger.info(`[updater] downloading ${url} to ${filePath}`)
    setStatus({ state: 'downloading', version, percent: 0 })
    let lastPercent = 0
    try {
      await deps.downloadFile(url, filePath, (transferred, total) => {
        if (total <= 0) return
        const percent = Math.min(100, Math.floor((transferred / total) * 100))
        if (percent === lastPercent) return
        lastPercent = percent
        setStatus({ state: 'downloading', version, percent })
      })
      setStatus({ state: 'downloaded', version, mode: 'manual', filePath })
    } catch (err) {
      fail(UpdaterErrorCode.downloadFailed, err)
    }
    return status
  }

  function download(): Promise<UpdaterStatus> {
    if (!updater || disposed) return Promise.resolve(status)
    if (downloading) return downloading
    if (status.state === 'downloaded') return Promise.resolve(status)
    const version = availableVersion
    if (!version) {
      return Promise.resolve(fail(UpdaterErrorCode.noUpdate, 'download() called with no update'))
    }
    const run = mode === 'auto' ? downloadWindows(updater, version) : downloadMac(version)
    downloading = run.finally(() => (downloading = null))
    return downloading
  }

  async function install(): Promise<void> {
    if (!updater || disposed) return
    if (status.state !== 'downloaded') {
      logger.warn(`[updater] install() ignored in state ${status.state}`)
      return
    }
    try {
      if (status.mode === 'auto') {
        // Silent install with the previously chosen options, then relaunch the app.
        updater.quitAndInstall(true, true)
      } else if (status.filePath) {
        await deps.openPath(status.filePath)
      }
    } catch (err) {
      fail(UpdaterErrorCode.installFailed, err)
    }
  }

  function clearTimers(): void {
    if (firstCheckTimer !== null) scheduler.clearTimeout(firstCheckTimer)
    if (intervalTimer !== null) scheduler.clearInterval(intervalTimer)
    firstCheckTimer = null
    intervalTimer = null
  }

  function start({ autoCheck }: { autoCheck: boolean }): void {
    if (!updater || disposed) return
    if (!autoCheck) {
      clearTimers()
      return
    }
    if (intervalTimer !== null) return // already scheduled
    firstCheckTimer = scheduler.setTimeout(() => {
      firstCheckTimer = null
      void check()
    }, FIRST_CHECK_DELAY_MS)
    intervalTimer = scheduler.setInterval(() => void check(), CHECK_INTERVAL_MS)
  }

  return {
    getStatus: () => status,
    start,
    check,
    download,
    install,
    onStatus(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispose() {
      clearTimers()
      listeners.clear()
      disposed = true
    }
  }
}

/** Streams a URL to disk with Electron's `net.fetch` (follows GitHub's redirects to its CDN). */
async function netDownloadFile(
  url: string,
  destPath: string,
  onProgress: DownloadProgress
): Promise<void> {
  const response = await net.fetch(url, { redirect: 'follow' })
  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status} while downloading ${url}`)
  }
  const body = response.body
  const total = Number(response.headers.get('content-length')) || 0
  const partPath = `${destPath}.download`
  await mkdir(dirname(destPath), { recursive: true })

  async function* chunks(): AsyncGenerator<Uint8Array> {
    const reader = body.getReader()
    let transferred = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) return
        transferred += value.byteLength
        onProgress(transferred, total)
        yield value
      }
    } finally {
      reader.releaseLock()
    }
  }

  try {
    await pipeline(chunks, createWriteStream(partPath))
    await rename(partPath, destPath)
  } catch (err) {
    await rm(partPath, { force: true })
    throw err
  }
}

/** Wires the real Electron / electron-updater implementations. Call after `app.whenReady()`. */
export function createDefaultUpdaterDeps(): UpdaterDeps {
  return {
    isPackaged: app.isPackaged,
    platform: process.platform,
    arch: process.arch,
    appVersion: app.getVersion(),
    getAutoUpdater: () => electronAutoUpdater,
    downloadFile: netDownloadFile,
    async openPath(path) {
      const error = await shell.openPath(path)
      if (error) throw new Error(error)
    },
    downloadsDir: app.getPath('downloads'),
    scheduler: {
      setTimeout: (callback, ms) => setTimeout(callback, ms),
      clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
      setInterval: (callback, ms) => setInterval(callback, ms),
      clearInterval: (handle) => clearInterval(handle as NodeJS.Timeout)
    },
    logger: console
  }
}
