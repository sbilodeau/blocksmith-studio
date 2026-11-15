import { app, BrowserWindow } from 'electron'
import { createMainWindow } from './window'
import { hardenSession, hardenWebContents } from './security'
import { registerIpcHandlers } from './ipc/handlers'
import { send } from './ipc/registry'
import { SettingsService } from './services/settings'
import { createUpdaterService } from './services/updater'

const isDev = !app.isPackaged

// Lets E2E tests run against an isolated profile.
if (process.env['BLOCKSMITH_USER_DATA']) {
  app.setPath('userData', process.env['BLOCKSMITH_USER_DATA'])
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  let mainWindow: BrowserWindow | null = null

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  hardenWebContents()

  void app.whenReady().then(async () => {
    app.setAppUserModelId('com.sbilodeau.blocksmithstudio')
    hardenSession(isDev)

    const settings = SettingsService.forUserData(app.getPath('userData'))
    await settings.load()

    const updater = createUpdaterService()

    registerIpcHandlers({ settings, updater })

    mainWindow = createMainWindow()
    mainWindow.on('closed', () => (mainWindow = null))

    settings.onChange((s) => {
      send(mainWindow?.webContents, 'settings.changed', s)
      updater.start({ autoCheck: s.updates.autoCheck })
    })
    updater.onStatus((status) => send(mainWindow?.webContents, 'updater.status', status))
    updater.start({ autoCheck: settings.get().updates.autoCheck })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow()
    })

    app.on('before-quit', () => updater.dispose())
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
