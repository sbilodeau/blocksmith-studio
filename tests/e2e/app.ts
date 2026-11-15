import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

export interface LaunchedApp {
  app: ElectronApplication
  page: Page
  /** Temp root holding userData/, workspace/ and anything a test adds. */
  root: string
  userDataDir: string
  workspaceDir: string
}

export interface LaunchOptions {
  /** Reuse an existing temp root (e.g. to test persistence across restarts). */
  root?: string
  /** Extra Minecraft folders/jars to seed into settings (e.g. a folder with a fixture jar). */
  minecraftPaths?: string[]
}

/**
 * Launches the built app with an isolated profile: its own userData and its own workspace folder, so tests never
 * touch the real Documents folder or settings.
 */
export async function launchApp(options: LaunchOptions = {}): Promise<LaunchedApp> {
  const root = options.root ?? (await mkdtemp(join(tmpdir(), 'blocksmith-e2e-')))
  const userDataDir = join(root, 'userData')
  const workspaceDir = join(root, 'workspace')
  if (!options.root) {
    await mkdir(userDataDir, { recursive: true })
    await mkdir(join(workspaceDir, 'packs'), { recursive: true })
    await writeFile(
      join(userDataDir, 'settings.json'),
      JSON.stringify({
        schemaVersion: 1,
        workspacePath: workspaceDir,
        minecraftPaths: options.minecraftPaths ?? [],
        updates: { autoCheck: false }
      })
    )
  }

  // Editors built on Electron (VS Code) may leak ELECTRON_RUN_AS_NODE, which would start Electron as plain Node.
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value
  }
  const app = await electron.launch({
    // Launch the project folder so Electron reads package.json (name, version, main -> out/main/index.js).
    args: [resolve(__dirname, '../..')],
    env: { ...env, BLOCKSMITH_USER_DATA: userDataDir, NODE_ENV: 'production' }
  })
  const page = await app.firstWindow()
  await page.waitForSelector('[data-testid="app-name"]')
  return { app, page, root, userDataDir, workspaceDir }
}

export async function closeApp(launched: LaunchedApp): Promise<void> {
  await launched.app.close()
}

export async function cleanup(launched: LaunchedApp): Promise<void> {
  await launched.app.close().catch(() => undefined)
  await rm(launched.root, { recursive: true, force: true })
}

/** Makes the next native open/save dialog return `path` (dialogs cannot be driven by Playwright). */
export async function stubOpenDialog(app: ElectronApplication, path: string): Promise<void> {
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [p]
    })) as typeof dialog.showOpenDialog
  }, path)
}

export async function stubSaveDialog(app: ElectronApplication, path: string): Promise<void> {
  await app.evaluate(({ dialog }, p) => {
    dialog.showSaveDialog = (async () => ({
      canceled: false,
      filePath: p
    })) as typeof dialog.showSaveDialog
  }, path)
}
