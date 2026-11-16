import { expect, test, type Page } from '@playwright/test'
import { mkdir, readFile, readdir, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { decode } from 'fast-png'
import { unzipSync } from 'fflate'
import { cleanup, launchApp, stubSaveDialog, type LaunchedApp } from './app'

type MakeFixtureJar = (outPath: string, versionId: string) => Promise<void>

async function makeFixtureJar(outPath: string, versionId: string): Promise<void> {
  const mod = (await import('../../scripts/make-fixture-jar.mjs' as string)) as {
    makeFixtureJar: MakeFixtureJar
  }
  await mod.makeFixtureJar(outPath, versionId)
}

let launched: LaunchedApp

async function setup(): Promise<{ launched: LaunchedApp; packFolder: () => Promise<string> }> {
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
  await page.getByTestId('new-pack-name').locator('input').fill('Editor pack')
  await page.getByTestId('new-pack-create').click()
  await expect(page.getByTestId('pack-name')).toHaveText('Editor pack')
  const packFolder = async (): Promise<string> => {
    const dirs = await readdir(join(l.workspaceDir, 'packs'))
    return join(l.workspaceDir, 'packs', dirs[0])
  }
  return { launched: l, packFolder }
}

/** Clicks the center of the editor canvas (the texture is fitted and centered, so this is pixel (w/2, h/2)). */
async function clickCanvasCenter(page: Page): Promise<void> {
  const box = (await page.getByTestId('pixel-canvas').boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
}

test.afterEach(async () => {
  if (launched) await cleanup(launched)
})

test('draws, undoes, saves a texture and exports it', async () => {
  const ctx = await setup()
  launched = ctx.launched
  const { page, app, root } = launched

  await page.getByTestId('cat-blocks').click()
  await page.getByTestId('tile-stone').dblclick()
  await expect(page.getByTestId('texture-editor')).toBeVisible()
  await expect(page.getByTestId('editor-name')).toHaveText('stone')

  // Draw one black pixel with the pencil, undo it, draw again.
  await page.getByTestId('tool-pencil').click()
  await clickCanvasCenter(page)
  await expect(page.getByTestId('editor-dirty')).toBeVisible()
  await expect(page.getByTestId('local-history')).toContainText('Draw')
  await page.keyboard.press('ControlOrMeta+z')
  await expect(page.getByTestId('editor-dirty')).toHaveCount(0)
  await clickCanvasCenter(page)

  // Save writes the PNG into the pack with the exact pixel.
  await page.getByTestId('editor-save').click()
  await expect(page.getByTestId('editor-dirty')).toHaveCount(0)
  await expect(page.getByTestId('saved-history')).toContainText('Saved stone')
  const file = join(await ctx.packFolder(), 'assets/minecraft/textures/block/stone.png')
  const png = decode(await readFile(file))
  let black = 0
  for (let i = 0; i < png.width * png.height; i++) {
    const o = i * png.channels
    if (png.data[o] === 0 && png.data[o + 1] === 0 && png.data[o + 2] === 0) black++
  }
  // The fixture stone has no black pixels; exactly the one drawn pixel was saved.
  expect(black).toBe(1)

  // Back in the grid the texture is marked modified.
  await page.getByTestId('editor-back').click()
  await expect(page.getByTestId('tile-stone')).toHaveAttribute('data-status', 'modified')

  // Export contains the edited texture.
  const out = join(root, 'edited.zip')
  await stubSaveDialog(app, out)
  await page.getByTestId('export-open').click()
  await page.getByTestId('export-run').click()
  await expect(page.getByTestId('report-dialog')).toBeVisible()
  const files = unzipSync(new Uint8Array(await readFile(out)))
  expect(Object.keys(files)).toContain('assets/minecraft/textures/block/stone.png')
})

test('saved changes can be undone from the pack history, and compare shows vanilla', async () => {
  const ctx = await setup()
  launched = ctx.launched
  const { page } = launched

  await page.getByTestId('cat-blocks').click()
  await page.getByTestId('tile-stone').dblclick()
  await page.getByTestId('tool-bucket').click()
  await clickCanvasCenter(page)
  await page.keyboard.press('ControlOrMeta+s')
  await expect(page.getByTestId('saved-history')).toContainText('Saved stone')
  const file = join(await ctx.packFolder(), 'assets/minecraft/textures/block/stone.png')
  expect(existsSync(file)).toBe(true)

  await page.getByTestId('editor-compare').click()
  await expect(page.getByTestId('vanilla-canvas')).toBeVisible()

  await page.getByTestId('undo-saved').click()
  await expect.poll(() => existsSync(file)).toBe(false)
  await page.getByTestId('editor-back').click()
  await expect(page.getByTestId('tile-stone')).toHaveAttribute('data-status', 'vanilla')
})

test('previous/next navigation asks before discarding unsaved edits', async () => {
  const ctx = await setup()
  launched = ctx.launched
  const { page } = launched

  await page.getByTestId('cat-blocks').click()
  await page.getByTestId('tile-stone').dblclick()
  const first = await page.getByTestId('editor-name').textContent()
  await page.getByTestId('tool-pencil').click()
  await clickCanvasCenter(page)
  // stone is the last texture of its category, so go to the previous one.
  await expect(page.getByTestId('editor-next')).toBeDisabled()
  await page.getByTestId('editor-prev').click()
  await page.getByRole('button', { name: 'Discard' }).click()
  await expect(page.getByTestId('editor-name')).not.toHaveText(first ?? '')
  await expect(page.getByTestId('editor-dirty')).toHaveCount(0)
})

test('closing the editor brings back the grid at the same scroll position', async () => {
  const ctx = await setup()
  launched = ctx.launched
  const { page } = launched
  await page.setViewportSize({ width: 900, height: 520 })

  await page.getByTestId('cat-all').click()
  const grid = page.getByTestId('texture-grid')
  // A small window so the fixture textures overflow the grid.
  await grid.evaluate((el) => (el.scrollTop = el.scrollHeight))
  const scrolled = await grid.evaluate((el) => el.scrollTop)
  expect(scrolled).toBeGreaterThan(0)

  const tile = page.locator('[data-testid^="tile-"]').last()
  await tile.dblclick()
  await expect(page.getByTestId('editor-name')).toBeVisible()
  await page.getByTestId('editor-back').click()
  await expect(grid).toBeVisible()
  // Not back at the top: the same place (the selection bar that appeared may shift it a little), with the edited
  // texture's tile in view.
  await expect.poll(() => grid.evaluate((el) => el.scrollTop)).toBeGreaterThanOrEqual(scrolled)
  await expect(tile).toBeInViewport()
})
