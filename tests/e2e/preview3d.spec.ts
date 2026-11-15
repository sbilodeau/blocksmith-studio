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

test('entity textures preview on their entity model', async () => {
  launched = await setup()
  const { page } = launched
  await openTexture(page, 'zombie')
  await page.getByTestId('editor-3d').click()
  await expect(page.getByTestId('preview3d-kind')).toHaveText('Entity')
  await expect(page.getByTestId('preview3d-walk')).toBeVisible()
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
  await openTexture(page, 'normal')
  await page.keyboard.press('3')
  await expect(page.getByTestId('preview3d-kind')).toHaveText('Flat')
  await expect(page.getByTestId('preview3d-no-model')).toBeVisible()
})
