import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

export interface LaunchedApp {
  app: ElectronApplication
  page: Page
  userDataDir: string
}

/** Launches the built app (out/main/index.js) with an isolated user data directory. */
export async function launchApp(userDataDir?: string): Promise<LaunchedApp> {
  const dir = userDataDir ?? (await mkdtemp(join(tmpdir(), 'blocksmith-e2e-')))
  // Editors built on Electron (VS Code) may leak ELECTRON_RUN_AS_NODE, which would start Electron as plain Node.
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value
  }
  const app = await electron.launch({
    // Launch the project folder so Electron reads package.json (name, version, main -> out/main/index.js).
    args: [resolve(__dirname, '../..')],
    env: { ...env, BLOCKSMITH_USER_DATA: dir, NODE_ENV: 'production' }
  })
  const page = await app.firstWindow()
  await page.waitForSelector('[data-testid="app-name"]')
  return { app, page, userDataDir: dir }
}

export async function cleanup(launched: LaunchedApp): Promise<void> {
  await launched.app.close()
  await rm(launched.userDataDir, { recursive: true, force: true })
}
