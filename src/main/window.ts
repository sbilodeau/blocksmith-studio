import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import icon from '../../resources/icon.png?asset'

/**
 * Shows the Blocksmith icon while running unpackaged (`npm run dev`): the stock Electron binary would show its own
 * icon in the macOS Dock and the Windows taskbar. Packaged builds get the icon from electron-builder (build/).
 */
export function useAppIconInDev(): void {
  if (process.platform === 'darwin' && !app.isPackaged) app.dock?.setIcon(icon)
}

/** Same isolation for every app window: sandboxed renderer, preload bridge only. */
function webPreferences(): Electron.WebPreferences {
  return {
    preload: join(__dirname, '../preload/index.js'),
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    webSecurity: true,
    webviewTag: false,
    spellcheck: false
  }
}

/** Loads the renderer at a hash route (`''` = home). */
function loadRenderer(win: BrowserWindow, hash: string): void {
  // electron-vite sets ELECTRON_RENDERER_URL in dev (HMR); production loads the bundled file.
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void win.loadURL(hash ? `${devUrl}#${hash}` : devUrl)
  else void win.loadFile(join(__dirname, '../renderer/index.html'), hash ? { hash } : undefined)
}

/** Pop-out 3D preview of a pack tab (M11): the same renderer at its bare `/popout/preview/<packId>` route. */
export function createPopoutWindow(packId: string, title: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 560,
    height: 600,
    minWidth: 320,
    minHeight: 320,
    show: false,
    title,
    autoHideMenuBar: true,
    ...(process.platform === 'darwin' ? {} : { icon }),
    webPreferences: webPreferences()
  })
  // The page sets its own <title>: keep the one given by main.
  win.on('page-title-updated', (e) => e.preventDefault())
  win.once('ready-to-show', () => win.show())
  loadRenderer(win, `/popout/preview/${encodeURIComponent(packId)}`)
  return win
}

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'Blocksmith Studio',
    autoHideMenuBar: true,
    // macOS takes the window icon from the app bundle (or the Dock, see useAppIconInDev).
    ...(process.platform === 'darwin' ? {} : { icon }),
    webPreferences: webPreferences()
  })

  win.once('ready-to-show', () => win.show())

  loadRenderer(win, '')

  return win
}
