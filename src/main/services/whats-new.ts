import { compareVersions } from '@shared/changelog'
import type { WhatsNew } from '@shared/model/updater'

export interface LaunchInfo {
  isPackaged: boolean
  currentVersion: string
  /** Version recorded by the previous launch (settings.lastRunVersion). */
  lastRunVersion?: string
  /** A settings file existed before this launch (the app ran before). */
  ranBefore: boolean
}

/**
 * Whether this launch follows an update, and from which version: the renderer then shows the changelog sections
 * in between. A first install, a development build, the same version or a downgrade show nothing. An app that ran
 * before without a recorded version (26.46.0 did not record it) shows the current version's notes.
 */
export function launchWhatsNew(info: LaunchInfo): WhatsNew | null {
  if (!info.isPackaged) return null
  const { lastRunVersion: previous, currentVersion } = info
  if (previous === undefined) {
    return info.ranBefore ? { previousVersion: null, version: currentVersion } : null
  }
  if (compareVersions(currentVersion, previous) <= 0) return null
  return { previousVersion: previous, version: currentVersion }
}
