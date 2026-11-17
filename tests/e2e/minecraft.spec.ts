import { expect, test, type Page } from '@playwright/test'
import { mkdir, readFile, readdir, stat, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { unzipSync } from 'fflate'
import { cleanup, launchApp, type LaunchedApp } from './app'

type MakeFixtureJar = (outPath: string, versionId: string) => Promise<void>

async function makeFixtureJar(outPath: string, versionId: string): Promise<void> {
  const mod = (await import('../../scripts/make-fixture-jar.mjs' as string)) as {
    makeFixtureJar: MakeFixtureJar
  }
  await mod.makeFixtureJar(outPath, versionId)
}

let launched: LaunchedApp

test.afterEach(async () => {
  if (launched) await cleanup(launched)
})

/**
 * A fake official .minecraft (BLOCKSMITH_MINECRAFT_DIR, see app.ts) with the fixture jar, an options.txt and one
 * world, and a vanilla-based pack.
 */
async function setup(): Promise<LaunchedApp> {
  const first = await launchApp()
  const mc = first.minecraftDir
  await mkdir(join(mc, 'versions', '26.3'), { recursive: true })
  await makeFixtureJar(join(mc, 'versions', '26.3', '26.3.jar'), '26.3')
  await writeFile(join(mc, 'options.txt'), 'lang:en_us\n')
  await mkdir(join(mc, 'saves', 'Test World'), { recursive: true })
  await writeFile(join(mc, 'saves', 'Test World', 'level.dat'), 'x')
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
  await page.getByTestId('new-pack-name').locator('input').fill('Live pack')
  await page.getByTestId('new-pack-create').click()
  await expect(page.getByTestId('pack-name')).toHaveText('Live pack')
  return l
}

async function paintStoneAndSave(page: Page): Promise<void> {
  await page.getByTestId('cat-blocks').click()
  await page.getByTestId('tile-stone').dblclick()
  await page.getByTestId('tool-pencil').click()
  const box = (await page.getByTestId('pixel-canvas').boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await page.getByTestId('editor-save').click()
  await expect(page.getByTestId('saved-history')).toContainText('Saved stone')
}

test('installs the pack into Minecraft and keeps a live copy in sync with saves', async () => {
  launched = await setup()
  const { page, minecraftDir } = launched
  const resourcepacks = join(minecraftDir, 'resourcepacks')

  // Install: a zip with a stable name in resourcepacks/.
  await page.getByTestId('play-open').click()
  await expect(page.getByTestId('play-game-dir')).toContainText('Minecraft launcher')
  await expect(page.getByTestId('play-version')).toContainText('26.3')
  await page.getByTestId('play-install').click()
  await expect(page.getByTestId('play-installed')).toContainText('Installed Live pack.zip.')
  const zip = unzipSync(new Uint8Array(await readFile(join(resourcepacks, 'Live pack.zip'))))
  expect(Object.keys(zip)).toContain('pack.mcmeta')

  // Live mode: an unzipped copy, then every save re-syncs it.
  await page.getByTestId('play-live').click()
  await expect(page.getByTestId('play-live-status')).toContainText('Synced at')
  await expect(page.getByTestId('play-live-hint')).toContainText('"Live pack [live]"')
  const live = join(resourcepacks, 'Live pack [live]')
  expect(existsSync(join(live, 'pack.mcmeta'))).toBe(true)
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('play-dialog')).toHaveCount(0)
  await expect(page.locator('[data-testid^="tab-live-"]')).toHaveText('LIVE')
  await expect(page.getByTestId('play-open')).toHaveText('Live in Minecraft')

  const stone = join(live, 'assets/minecraft/textures/block/stone.png')
  expect(existsSync(stone)).toBe(false)
  await paintStoneAndSave(page)
  await expect.poll(() => existsSync(stone), { timeout: 5000 }).toBe(true)
  const packStone = join(
    launched.workspaceDir,
    'packs',
    (await readdir(join(launched.workspaceDir, 'packs')))[0],
    'assets/minecraft/textures/block/stone.png'
  )
  expect(await readFile(stone)).toEqual(await readFile(packStone))

  // Undo in the pack history removes the texture from the live copy too.
  await page.getByTestId('editor-back').click()
  await page.getByTestId('pack-history-open').click()
  await page.getByTestId('pack-undo').click()
  await expect.poll(() => existsSync(stone), { timeout: 5000 }).toBe(false)
  await page.keyboard.press('Escape')

  // Switching live mode off removes the live folder and keeps the installed zip.
  await page.getByTestId('play-open').click()
  await page.getByTestId('play-live').click()
  await expect(page.getByTestId('play-live-status')).toHaveCount(0)
  expect(existsSync(live)).toBe(false)
  expect((await stat(join(resourcepacks, 'Live pack.zip'))).isFile()).toBe(true)
  await expect(page.locator('[data-testid^="tab-live-"]')).toHaveCount(0)
})
