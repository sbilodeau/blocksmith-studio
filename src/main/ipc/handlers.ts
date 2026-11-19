import { app, clipboard, shell } from 'electron'
import { handle, AppErrorException } from './registry'
import { isAllowedExternalUrl } from '../security'
import type { SettingsService } from '../services/settings'
import type { UpdaterService } from '../services/updater'
import type { WhatsNew } from '@shared/model/updater'

export interface HandlerDeps {
  settings: SettingsService
  updater: UpdaterService
  /** Returns this launch's "What's new" once, then null. */
  takeWhatsNew?: () => WhatsNew | null
}

export function registerIpcHandlers({ settings, updater, takeWhatsNew }: HandlerDeps): void {
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

  handle('app.copyText', async ({ text }) => {
    await clipboard.writeText(text)
  })

  handle('app.whatsNew', () => takeWhatsNew?.() ?? null)

  handle('settings.get', () => settings.get())
  handle('settings.update', (patch) => settings.update(patch))

  handle('updater.getStatus', () => updater.getStatus())
  handle('updater.check', () => updater.check())
  handle('updater.download', () => updater.download())
  handle('updater.install', () => updater.install())
}
