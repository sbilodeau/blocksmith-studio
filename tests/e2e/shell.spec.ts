import { expect, test } from '@playwright/test'
import { cleanup, launchApp, type LaunchedApp } from './app'

let launched: LaunchedApp

test.afterEach(async () => {
  if (launched) await cleanup(launched)
})

test('launches with the app shell and the empty pack list', async () => {
  launched = await launchApp()
  const { page } = launched
  await expect(page).toHaveTitle('Blocksmith Studio')
  await expect(page.getByTestId('app-name')).toHaveText('Blocksmith Studio')
  await expect(page.getByTestId('tab-home')).toBeVisible()
  await expect(page.getByTestId('home-empty')).toContainText('No packs yet')
})

test('reports the app version from package.json', async () => {
  launched = await launchApp()
  const { page } = launched
  await page.getByTestId('open-settings').click()
  const expected = await launched.app.evaluate(({ app }) => app.getVersion())
  await expect(page.getByTestId('app-version')).toHaveText(expected)
  expect(expected).not.toBe(await launched.app.evaluate(() => process.versions.electron))
})

test('switches to French and keeps the choice after a restart', async () => {
  launched = await launchApp()
  const { page, root } = launched
  await page.getByTestId('open-settings').click()
  await page.getByTestId('language-select').click()
  await page.locator('.n-base-select-option', { hasText: 'Français' }).click()
  await expect(page.getByTestId('open-settings')).toHaveText('Paramètres')

  await launched.app.close()
  launched = await launchApp({ root })
  await expect(launched.page.getByTestId('home-empty')).toContainText("Aucun pack pour l'instant")
})

test('applies the dark theme', async () => {
  launched = await launchApp()
  const { page } = launched
  await page.getByTestId('open-settings').click()
  await page.getByTestId('theme-dark').click()
  // Naive UI dark layout background is a near-black rgb; the change lands after an IPC round trip.
  await expect
    .poll(async () => {
      const bg = await page
        .locator('.n-layout')
        .first()
        .evaluate((el) => getComputedStyle(el).backgroundColor)
      const [r, g, b] = bg.match(/\d+/g)!.map(Number)
      return r + g + b
    })
    .toBeLessThan(150)
})

test('shows that updates are disabled for unpackaged builds', async () => {
  launched = await launchApp()
  await launched.page.getByTestId('open-settings').click()
  await expect(launched.page.getByTestId('update-status')).toContainText(
    'Updates are disabled in development builds.'
  )
})

test('shows the bundled release notes from Settings and nothing on launch of a development build', async () => {
  launched = await launchApp()
  const { page } = launched
  // A development build never shows the "updated" dialog on launch.
  expect(await page.evaluate(() => window.blocksmith.invoke('app.whatsNew'))).toMatchObject({
    ok: true,
    value: null
  })
  await expect(page.getByTestId('whats-new-dialog')).toHaveCount(0)

  await page.getByTestId('open-settings').click()
  await page.getByTestId('current-notes').click()
  const dialog = page.getByTestId('whats-new-dialog')
  await expect(dialog).toBeVisible()
  // A development build has no section for its own version: it shows the upcoming (Unreleased) notes.
  await expect(dialog.getByTestId('whats-new-notes')).toContainText('Releases and updates')
  await dialog.getByTestId('whats-new-close').click()
  await expect(dialog).toHaveCount(0)
})
