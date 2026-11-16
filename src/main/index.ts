import { app, BrowserWindow, dialog, net, safeStorage, shell } from 'electron'
import { createMainWindow, useAppIconInDev } from './window'
import { hardenSession, hardenWebContents } from './security'
import { registerIpcHandlers } from './ipc/handlers'
import { registerVanillaHandlers } from './ipc/vanilla-handlers'
import { registerPackHandlers } from './ipc/pack-handlers'
import { registerTextureHandlers } from './ipc/texture-handlers'
import { registerPreviewHandlers } from './ipc/preview-handlers'
import { registerAiProviderHandlers } from './ipc/ai-provider-handlers'
import { registerAiAgentHandlers } from './ipc/ai-agent-handlers'
import { registerBulkHandlers } from './ipc/bulk-handlers'
import { registerMergeHandlers } from './ipc/merge-handlers'
import { createMergeService } from './services/merge'
import { createBulkService, createDefaultBulkRunner } from './services/bulk'
import { registerAiEvalHandlers } from './ipc/ai-eval-handlers'
import { send } from './ipc/registry'
import { registerAssetScheme, handleAssetProtocol } from './protocol'
import { createJobReporter } from './jobs'
import { SettingsService } from './services/settings'
import { createUpdaterService } from './services/updater'
import { createDefaultVanillaStore } from './services/vanilla'
import { createPackService, createTextureEditService } from './services/packs'
import { createHistoryService } from './services/history'
import { createPreviewService } from './services/preview'
import { createSecretsStore, secretsFilePath } from './services/secrets'
import { createProviderRegistry } from './services/ai/providers'

const isDev = !app.isPackaged

// Lets E2E tests run against an isolated profile.
if (process.env['BLOCKSMITH_USER_DATA']) {
  app.setPath('userData', process.env['BLOCKSMITH_USER_DATA'])
}

// Custom schemes must be registered before the app is ready.
registerAssetScheme()

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  let mainWindow: BrowserWindow | null = null
  const webContents = (): Electron.WebContents | undefined => mainWindow?.webContents

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  hardenWebContents()

  void app.whenReady().then(async () => {
    app.setAppUserModelId('com.sbilodeau.blocksmithstudio')
    useAppIconInDev()
    hardenSession(isDev)

    const settings = SettingsService.forUserData(app.getPath('userData'))
    await settings.load()

    const updater = createUpdaterService()
    const jobs = createJobReporter((progress) => send(webContents(), 'job.progress', progress))

    const vanilla = createDefaultVanillaStore({
      userDataDir: app.getPath('userData'),
      getMinecraftPaths: () => settings.get().minecraftPaths
    })

    const packs = createPackService({
      vanilla,
      jobs,
      documentsDir: app.getPath('documents'),
      getWorkspacePath: () => settings.get().workspacePath,
      setWorkspacePath: async (path) => {
        await settings.setWorkspacePath(path)
      },
      trashItem: (path) => shell.trashItem(path),
      showItemInFolder: (path) => shell.showItemInFolder(path),
      notifyChanged: (packId) => send(webContents(), 'packs.changed', { packId })
    })
    const history = createHistoryService({
      locate: (id) => packs.locate(id),
      onFilesChanged: (location, paths) => packs.invalidate(location, paths),
      notifyChanged: (packId) => send(webContents(), 'packs.changed', { packId })
    })
    const textures = createTextureEditService({
      packs,
      vanilla,
      history,
      notifyChanged: (packId) => send(webContents(), 'packs.changed', { packId })
    })
    const preview = createPreviewService({ packs, vanilla })
    const secrets = createSecretsStore({
      filePath: secretsFilePath(app.getPath('userData')),
      safeStorage
    })
    const aiProviders = createProviderRegistry({
      getProviders: () => settings.get().ai.providers,
      getModelSettings: () => ({
        overrides: settings.get().ai.modelOverrides,
        costTiers: settings.get().ai.costTiers
      }),
      secrets,
      fetch: (url, init) => net.fetch(url, init)
    })

    // Dialogs are looked up at call time (E2E tests replace them on the dialog module).
    const parent = (): BrowserWindow | undefined => mainWindow ?? undefined
    registerIpcHandlers({ settings, updater })
    registerVanillaHandlers({
      vanilla,
      settings,
      jobs,
      dialog: (options) => {
        const win = parent()
        return win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options)
      },
      addMinecraftPath: (path) => settings.addMinecraftPath(path)
    })
    registerPackHandlers({
      packs,
      dialogs: {
        chooseFolder: async (defaultPath) => {
          const options: Electron.OpenDialogOptions = {
            defaultPath,
            properties: ['openDirectory', 'createDirectory']
          }
          const win = parent()
          const r = win
            ? await dialog.showOpenDialog(win, options)
            : await dialog.showOpenDialog(options)
          return r.canceled ? null : (r.filePaths[0] ?? null)
        },
        openZip: async () => {
          const options: Electron.OpenDialogOptions = {
            properties: ['openFile'],
            filters: [{ name: 'Resource pack', extensions: ['zip'] }]
          }
          const win = parent()
          const r = win
            ? await dialog.showOpenDialog(win, options)
            : await dialog.showOpenDialog(options)
          return r.canceled ? null : (r.filePaths[0] ?? null)
        },
        saveZip: async (defaultFileName) => {
          const options: Electron.SaveDialogOptions = {
            defaultPath: defaultFileName,
            filters: [{ name: 'Resource pack', extensions: ['zip'] }]
          }
          const win = parent()
          const r = win
            ? await dialog.showSaveDialog(win, options)
            : await dialog.showSaveDialog(options)
          return r.canceled || !r.filePath ? null : r.filePath
        }
      }
    })
    registerTextureHandlers({
      textures,
      history,
      openGif: async () => {
        const options: Electron.OpenDialogOptions = {
          properties: ['openFile'],
          filters: [{ name: 'GIF', extensions: ['gif'] }]
        }
        const win = parent()
        const r = win
          ? await dialog.showOpenDialog(win, options)
          : await dialog.showOpenDialog(options)
        return r.canceled ? null : (r.filePaths[0] ?? null)
      }
    })
    registerPreviewHandlers({ preview })
    registerAiProviderHandlers({ settings, secrets, registry: aiProviders })
    const bulk = createBulkService({
      packs,
      textures,
      // The brief service is created with the agent handlers below (read at call time).
      brief: { get: (packId) => agentServices.brief.get(packId) },
      run: createDefaultBulkRunner(),
      jobs
    })
    registerBulkHandlers({ bulk })
    const agentServices = registerAiAgentHandlers({
      navigation: {
        textures: (packId) => packs.textures(packId),
        readPng: async (packId, path) => (await textures.read(packId, path)).png,
        bulk
      },
      creation: {
        catalog: (packId) => packs.catalog(packId),
        readPng: (packId, path) => textures.readCatalog(packId, path),
        meta: async (packId) => {
          const { name, description, base } = await packs.get(packId)
          return { name, description, base }
        },
        setMeta: async (packId, patch) => {
          await packs.updateMeta(packId, patch)
        },
        jobs
      },
      providers: aiProviders,
      getAgentSettings: (agent) => settings.get().ai.agents[agent],
      packs,
      readVanillaPng: async (packId, path) => (await textures.read(packId, path)).vanillaPng,
      previewModel: (packId, path) => preview.preview(packId, path),
      emit: (event) => send(webContents(), 'ai.event', event)
    })
    registerMergeHandlers({
      merge: createMergeService({ packs, history, brief: agentServices.brief })
    })
    registerAiEvalHandlers({
      providers: aiProviders,
      emit: (progress) => send(webContents(), 'ai.eval.progress', progress)
    })
    handleAssetProtocol({ vanilla, locatePack: (id) => packs.locate(id) })

    mainWindow = createMainWindow()
    mainWindow.on('closed', () => (mainWindow = null))

    settings.onChange((s) => {
      send(webContents(), 'settings.changed', s)
      updater.start({ autoCheck: s.updates.autoCheck })
    })
    updater.onStatus((status) => send(webContents(), 'updater.status', status))
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
