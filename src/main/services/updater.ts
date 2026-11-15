import type { UpdaterStatus } from '@shared/model/updater'

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

/** Placeholder until the real implementation lands (M0, release pipeline task). */
export function createUpdaterService(): UpdaterService {
  const status: UpdaterStatus = { state: 'disabled', reason: 'dev' }
  return {
    getStatus: () => status,
    start: () => undefined,
    check: async () => status,
    download: async () => status,
    install: async () => undefined,
    onStatus: () => () => undefined,
    dispose: () => undefined
  }
}
