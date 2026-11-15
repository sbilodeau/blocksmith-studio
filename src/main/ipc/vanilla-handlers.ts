import type { OpenDialogOptions } from 'electron'
import type { VanillaAvailability } from '@shared/model/vanilla'
import type { Settings } from '@shared/model/settings'
import { handle, AppErrorException } from './registry'
import type { JobReporter, VanillaStore } from '../services/contracts'
import type { VanillaStoreImpl } from '../services/vanilla/store'

/** `dialog.showOpenDialog`-like function (bind the parent window in the caller). */
export type OpenDialogFn = (
  options: OpenDialogOptions
) => Promise<{ canceled: boolean; filePaths: string[] }>

export interface VanillaHandlerDeps {
  vanilla: VanillaStore & Pick<VanillaStoreImpl, 'inspectPath'>
  /** The SettingsService (only `get()` is used). */
  settings: { get(): Settings }
  jobs: JobReporter
  dialog: OpenDialogFn
  /** Appends a folder / jar to settings.minecraftPaths and persists it (SettingsService.addMinecraftPath). */
  addMinecraftPath: (path: string) => Promise<unknown>
  platform?: NodeJS.Platform
}

/** Picker options: a launcher folder anywhere; on macOS a client .jar can be picked in the same dialog. */
export function addPathDialogOptions(platform: NodeJS.Platform): OpenDialogOptions {
  if (platform === 'darwin') {
    return {
      properties: ['openDirectory', 'openFile', 'showHiddenFiles', 'dontAddToRecent'],
      filters: [{ name: 'Minecraft client (.jar)', extensions: ['jar'] }]
    }
  }
  // Windows and Linux dialogs cannot pick files and folders at once: folders only.
  return { properties: ['openDirectory', 'showHiddenFiles', 'dontAddToRecent'] }
}

export function registerVanillaHandlers({
  vanilla,
  settings,
  jobs,
  dialog,
  addMinecraftPath,
  platform = process.platform
}: VanillaHandlerDeps): void {
  handle('minecraft.detect', () => vanilla.detectInstalls())

  handle('minecraft.addPath', async () => {
    const result = await dialog(addPathDialogOptions(platform))
    const picked = result.filePaths[0]
    if (result.canceled || !picked) return null
    const install = await vanilla.inspectPath(picked)
    if (!install) throw new AppErrorException('minecraft.noVersionsFound', { path: picked })
    if (!settings.get().minecraftPaths.includes(install.path)) {
      await addMinecraftPath(install.path)
    }
    return install
  })

  handle('vanilla.availability', () => vanilla.availability())

  handle('vanilla.prepare', async ({ versionId }): Promise<VanillaAvailability> => {
    const onProgress = jobs.start('vanilla.prepare')
    await vanilla.prepare(versionId, {
      allowDownload: settings.get().allowMojangDownload,
      onProgress
    })
    const version = vanilla.getVersion(versionId)
    return {
      versionId,
      releaseTime: version?.releaseTime ?? '',
      state: 'ready',
      isLatest: vanilla.latestVersion().id === versionId
    }
  })
}
