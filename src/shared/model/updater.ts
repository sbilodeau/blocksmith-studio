/**
 * Update flow state shared by main and renderer.
 * - 'auto' mode (Windows): electron-updater downloads and installs on restart.
 * - 'manual' mode (unsigned macOS): the app downloads the DMG and opens it; the user drags the app to Applications.
 */
export type UpdateMode = 'auto' | 'manual'

export type UpdaterStatus =
  | { state: 'disabled'; reason: 'dev' | 'unsupported' }
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'not-available'; currentVersion: string }
  | { state: 'available'; version: string; mode: UpdateMode; releaseNotes?: string }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'downloaded'; version: string; mode: UpdateMode; filePath?: string }
  | { state: 'error'; code: string; message?: string }

/** This launch follows an update from `previousVersion` (null: unknown, show only `version`'s notes). */
export interface WhatsNew {
  previousVersion: string | null
  version: string
}
