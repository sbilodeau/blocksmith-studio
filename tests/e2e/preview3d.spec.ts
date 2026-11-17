import { expect, test, type Page } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { cleanup, launchApp, type LaunchedApp } from './app'

type MakeFixtureJar = (outPath: string, versionId: string) => Promise<void>

async function makeFixtureJar(outPath: string, versionId: string): Promise<void> {
  const mod = (await import('../../scripts/make-fixture-jar.mjs' as string)) as {
    makeFixtureJar: MakeFixtureJar
  }
  await mod.makeFixtureJar(outPath, versionId)
}

let launched: LaunchedApp

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
  await page.getByTestId('new-pack-name').locator('input').fill('Preview pack')
  await page.getByTestId('new-pack-create').click()
  await expect(page.getByTestId('pack-name')).toHaveText('Preview pack')
  return l
}

async function openTexture(page: Page, name: string): Promise<void> {
  await page.getByTestId('cat-all').click()
  await page.getByTestId('grid-search').locator('input').fill(name)
  await page.getByTestId(`tile-${name}`).first().dblclick()
  await expect(page.getByTestId('editor-name')).toHaveText(name)
}

/** Snapshot of the WebGL canvas (the renderer keeps its drawing buffer). */
async function snapshot(page: Page): Promise<string> {
  return page.getByTestId('preview3d-canvas').evaluate((c) => (c as HTMLCanvasElement).toDataURL())
}

test.afterEach(async () => {
  if (launched) await cleanup(launched)
})

test('block textures preview on their model and update live while painting', async () => {
  launched = await setup()
  const { page } = launched
  await openTexture(page, 'stone')
  await page.getByTestId('editor-3d').click()
  await expect(page.getByTestId('preview3d-kind')).toHaveText('Block model')
  await page.waitForTimeout(300)
  const before = await snapshot(page)

  await page.getByTestId('tool-bucket').click()
  const box = (await page.getByTestId('pixel-canvas').boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await expect.poll(() => snapshot(page)).not.toBe(before)
})

test('block entity textures use the built-in models (the chest)', async () => {
  launched = await setup()
  const { page } = launched
  await openTexture(page, 'normal')
  await page.keyboard.press('3')
  await expect(page.getByTestId('preview3d-kind')).toHaveText('Entity')
})

test('entity textures preview on their entity model', async () => {
  launched = await setup()
  const { page } = launched
  await openTexture(page, 'zombie')
  await page.getByTestId('editor-3d').click()
  await expect(page.getByTestId('preview3d-kind')).toHaveText('Entity')
  // The fixture 26.3 jar carries (synthetic) model code: the zombie comes from the jar, not the built-in set.
  // Its stand-in mesh has no arms, so there is no walk animation to offer.
  await expect(page.getByTestId('preview3d-from-game')).toBeVisible()
  await expect(page.getByTestId('preview3d-walk')).toHaveCount(0)
})

test('item textures preview as an extruded sprite', async () => {
  launched = await setup()
  const { page } = launched
  await openTexture(page, 'diamond_sword')
  await page.keyboard.press('3')
  await expect(page.getByTestId('preview3d-kind')).toHaveText('Item')
})

test('entity textures without a model are shown flat, facing the camera, with a notice', async () => {
  launched = await setup()
  const { page } = launched
  await openTexture(page, 'experience_orb')
  await page.keyboard.press('3')
  await expect(page.getByTestId('preview3d-kind')).toHaveText('Flat')
  await expect(page.getByTestId('preview3d-no-model')).toBeVisible()
})

/** Clicks the middle of a 3D canvas (the model is centered there). */
async function clickCanvasMiddle(page: Page): Promise<void> {
  const box = (await page.getByTestId('preview3d-canvas').boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
}

test('paints directly on the 3D model with the current tool', async () => {
  launched = await setup()
  const { page } = launched
  await openTexture(page, 'stone')
  await page.getByTestId('editor-3d').click()
  await expect(page.getByTestId('preview3d-kind')).toHaveText('Block model')
  await page.getByTestId('tool-pencil').click()
  await page.getByTestId('preview3d-paint').click()
  await expect(page.getByTestId('preview3d-paint')).toHaveAttribute('aria-pressed', 'true')
  await page.waitForTimeout(300)
  await clickCanvasMiddle(page)
  await expect(page.getByTestId('editor-dirty')).toBeVisible()
  await expect(page.getByTestId('local-history')).toContainText('Draw')
})

test('pops the preview out into its own window, which follows and paints the editor texture', async () => {
  launched = await setup()
  const { page, app } = launched
  await openTexture(page, 'stone')
  await page.getByTestId('editor-3d').click()
  const [popout] = await Promise.all([
    app.waitForEvent('window'),
    page.getByTestId('preview3d-popout').click()
  ])
  await expect(popout.getByTestId('preview3d-popout-window')).toBeVisible()
  await expect(popout.getByTestId('popout-path')).toHaveText(
    'assets/minecraft/textures/block/stone.png'
  )
  await expect(popout.getByTestId('preview3d-kind')).toHaveText('Block model')
  const titles = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((w) => w.getTitle())
  )
  expect(titles).toContain('Preview pack - 3D preview')
  // The docked preview gives way to the window.
  await expect(page.getByTestId('preview3d')).toHaveCount(0)

  // Painting in the window edits the texture in the editor.
  await popout.getByTestId('preview3d-paint').click()
  await popout.waitForTimeout(300)
  await clickCanvasMiddle(popout)
  await expect(page.getByTestId('editor-dirty')).toBeVisible()

  // Back in the grid the window says no texture is open; closing it lets the 3D button dock it again.
  await page.getByTestId('editor-save').click()
  await page.getByTestId('editor-back').click()
  await expect(popout.getByTestId('popout-empty')).toBeVisible()
  await popout.close()
  await page.getByTestId('tile-stone').first().dblclick()
  await page.getByTestId('editor-3d').click()
  await expect(page.getByTestId('preview3d')).toBeVisible()
})
