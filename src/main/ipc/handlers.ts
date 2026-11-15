import { app, shell } from 'electron'
import { handle, AppErrorException } from './registry'
import { isAllowedExternalUrl } from '../security'
import type { SettingsService } from '../services/settings'
import type { UpdaterService } from '../services/updater'

export interface HandlerDeps {
  settings: SettingsService
  updater: UpdaterService
}

export function registerIpcHandlers({ settings, updater }: HandlerDeps): void {
  handle('app.getInfo', () => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    isPackaged: app.isPackaged
  }))

  handle('app.openExternal', async ({ url }) => {
    if (!isAllowedExternalUrl(url)) throw new AppErrorException('app.urlNotAllowed')
    await shell.openExternal(url)
  })

  handle('settings.get', () => settings.get())
  handle('settings.update', (patch) => settings.update(patch))

  handle('updater.getStatus', () => updater.getStatus())
  handle('updater.check', () => updater.check())
  handle('updater.download', () => updater.download())
  handle('updater.install', () => updater.install())
}
