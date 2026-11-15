import { expect, test } from '@playwright/test'
import { cleanup, launchApp, type LaunchedApp } from './app'

let launched: LaunchedApp

test.beforeAll(async () => {
  launched = await launchApp()
})

test.afterAll(async () => {
  await cleanup(launched)
})

test('renderer has no Node.js access', async () => {
  const result = await launched.page.evaluate(() => ({
    require: typeof (window as unknown as { require?: unknown }).require,
    process: typeof (window as unknown as { process?: unknown }).process,
    module: typeof (window as unknown as { module?: unknown }).module
  }))
  expect(result).toEqual({ require: 'undefined', process: 'undefined', module: 'undefined' })
})

test('the bridge exposes only invoke and on', async () => {
  const keys = await launched.page.evaluate(() => Object.keys(window.blocksmith).sort())
  expect(keys).toEqual(['invoke', 'on'])
})

test('unknown IPC channels are refused', async () => {
  const result = await launched.page.evaluate(() =>
    (window.blocksmith.invoke as (c: string) => Promise<unknown>)('fs.readFile')
  )
  expect(result).toEqual({ ok: false, error: { code: 'ipc.unknownChannel' } })
})

test('invalid payloads are rejected by main', async () => {
  const result = await launched.page.evaluate(() =>
    (window.blocksmith.invoke as (c: string, p: unknown) => Promise<unknown>)('settings.update', {
      language: 'klingon'
    })
  )
  expect(result).toMatchObject({ ok: false, error: { code: 'ipc.invalidInput' } })
})

test('windows run with context isolation and sandbox', async () => {
  const prefs = await launched.app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    // Present at runtime but missing from Electron's type definitions.
    const wc = win.webContents as unknown as {
      getLastWebPreferences(): Electron.WebPreferences | null
    }
    const p = wc.getLastWebPreferences()
    return {
      contextIsolation: p?.contextIsolation,
      sandbox: p?.sandbox,
      nodeIntegration: p?.nodeIntegration,
      webviewTag: p?.webviewTag
    }
  })
  expect(prefs).toEqual({
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    webviewTag: false
  })
})

test('the page carries a strict Content-Security-Policy', async () => {
  const csp = await launched.page.evaluate(
    () =>
      document
        .querySelector('meta[http-equiv="Content-Security-Policy"]')
        ?.getAttribute('content') ?? ''
  )
  expect(csp).toContain("default-src 'self'")
  expect(csp).toContain("script-src 'self';")
  expect(csp).toContain("connect-src 'self';")
})

test('remote network requests from the renderer are blocked', async () => {
  const blocked = await launched.page.evaluate(async () => {
    try {
      await fetch('https://example.com')
      return false
    } catch {
      return true
    }
  })
  expect(blocked).toBe(true)
})
