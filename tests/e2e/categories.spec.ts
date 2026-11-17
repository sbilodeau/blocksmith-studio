import { expect, test } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { cleanup, launchApp, type LaunchedApp } from './app'

/**
 * M11 category mapping editor: a custom category added to the "All packs" mapping shows up in the navigator with
 * its own name and the textures its pattern matches (synthetic jar, no network).
 */

type MakeFixtureJar = (outPath: string, versionId: string) => Promise<void>

async function makeFixtureJar(outPath: string, versionId: string): Promise<void> {
  const mod = (await import('../../scripts/make-fixture-jar.mjs' as string)) as {
    makeFixtureJar: MakeFixtureJar
  }
  await mod.makeFixtureJar(outPath, versionId)
}

let launched: LaunchedApp | undefined

test.afterEach(async () => {
  if (launched) await cleanup(launched)
  launched = undefined
})

async function setup(): Promise<LaunchedApp> {
  const first = await launchApp()
  const mc = join(first.root, 'minecraft')
  await mkdir(join(mc, 'versions', '26.3'), { recursive: true })
  await makeFixtureJar(join(mc, 'versions', '26.3', '26.3.jar'), '26.3')
  await first.app.close()
  const settingsPath = join(first.userDataDir, 'settings.json')
  const settings = JSON.parse(await readFile(settingsPath, 'utf8'))
  settings.minecraftPaths = [mc]
  await writeFile(settingsPath, JSON.stringify(settings))
  const l = await launchApp({ root: first.root })
  const { page } = l
  await page.getByTestId('open-settings').click()
  const row = page.getByTestId('vanilla-row-26.3')
  await row.getByRole('button').click()
  await expect(row).toContainText('Ready', { timeout: 30_000 })
  await page.getByTestId('tab-home').click()
  await page.getByTestId('new-pack').click()
  await page.getByTestId('new-pack-name').locator('input').fill('Wood pack')
  await page.getByTestId('new-pack-create').click()
  await expect(page.getByTestId('pack-name')).toHaveText('Wood pack')
  return l
}

test('adds a custom category in the editor and sees it in the navigator', async () => {
  launched = await setup()
  const { page, userDataDir } = launched
  await expect(page.getByTestId('cat-blocks')).toBeVisible()
  await expect(page.locator('[data-testid="cat-oak_stuff"]')).toHaveCount(0)

  await page.getByTestId('edit-categories').click()
  const editor = page.getByTestId('cat-editor-global')
  await expect(editor.getByTestId('cat-rule-blocks')).toBeVisible()

  await editor.getByTestId('cat-new-name').locator('input').fill('Oak stuff')
  await editor.getByTestId('cat-add').click()
  await expect(editor.getByTestId('cat-rule-oak_stuff')).toContainText('Oak stuff')
  await editor.getByTestId('glob-add-include').click()
  const glob = editor.getByTestId('glob-include-0')

  // An invalid pattern is flagged inline and blocks saving.
  await glob.locator('input').fill('block/{oak_*.png')
  await expect(glob).toContainText('Unbalanced')
  await expect(page.getByTestId('cat-save')).toBeDisabled()

  await glob.locator('input').fill('block/oak_*.png')
  await expect(glob).toContainText('3 textures')
  await editor.getByTestId('cat-test-path').locator('input').fill('block/oak_log.png')
  await expect(editor.getByTestId('cat-test-result')).toContainText('Oak stuff')

  await page.getByTestId('cat-save').click()
  await expect(page.getByTestId('cat-editor-global')).toBeHidden()

  // The navigator shows the new category with its label and count, and its textures.
  const item = page.getByTestId('cat-oak_stuff')
  await expect(item).toContainText('Oak stuff')
  await expect(item).toContainText('3')
  await expect(page.getByTestId('overview-oak_stuff')).toContainText('Oak stuff')
  await item.click()
  await expect(page.getByTestId('tile-oak_planks')).toBeVisible()
  await expect(page.locator('[data-testid^="tile-"]')).toHaveCount(3)

  const saved = JSON.parse(await readFile(join(userDataDir, 'categories.json'), 'utf8'))
  expect(saved.categories.at(-1)).toMatchObject({
    id: 'oak_stuff',
    label: 'Oak stuff',
    include: ['block/oak_*.png']
  })
})
