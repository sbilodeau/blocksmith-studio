import { expect, test, type Page } from '@playwright/test'
import { mkdir, readFile, readdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { decode } from 'fast-png'
import { cleanup, launchApp, stubOpenDialog, type LaunchedApp } from './app'
import { makeGif } from '../fixtures/gif'

type MakeFixtureJar = (outPath: string, versionId: string) => Promise<void>

let launched: LaunchedApp | undefined

/** Vanilla-based pack on the fixture jar (which has fire_0: a 16x512 strip of 32 frames). */
async function setup(): Promise<{
  launched: LaunchedApp
  packFile: (path: string) => Promise<string>
}> {
  const first = await launchApp()
  const mc = join(first.root, 'minecraft')
  await mkdir(join(mc, 'versions', '26.3'), { recursive: true })
  const mod = (await import('../../scripts/make-fixture-jar.mjs' as string)) as {
    makeFixtureJar: MakeFixtureJar
  }
  await mod.makeFixtureJar(join(mc, 'versions', '26.3', '26.3.jar'), '26.3')
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
  await page.getByTestId('new-pack-name').locator('input').fill('Anim pack')
  await page.getByTestId('new-pack-create').click()
  await expect(page.getByTestId('pack-name')).toHaveText('Anim pack')
  const packFile = async (path: string): Promise<string> => {
    const dirs = await readdir(join(l.workspaceDir, 'packs'))
    return join(l.workspaceDir, 'packs', dirs[0]!, ...path.split('/'))
  }
  return { launched: l, packFile }
}

async function openTexture(page: Page, name: string): Promise<void> {
  await page.getByTestId('cat-all').click()
  await page.getByTestId('grid-search').locator('input').fill(name)
  await page.getByTestId(`tile-${name}`).first().dblclick()
  await expect(page.getByTestId('editor-name')).toHaveText(name)
}

async function clickCanvasCenter(page: Page): Promise<void> {
  const box = (await page.getByTestId('pixel-canvas').boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
}

test.afterEach(async () => {
  if (launched) await cleanup(launched)
  launched = undefined
})

test('edits an animated texture frame by frame and saves its .mcmeta in the pack', async () => {
  const ctx = await setup()
  launched = ctx.launched
  const { page } = launched
  await openTexture(page, 'fire_0')
  await expect(page.getByTestId('animation-panel')).toBeVisible()
  await expect(page.getByTestId('editor-frames')).toHaveText('Frame 1 of 32')

  // Draw on frame 2 only, then duplicate it.
  await page.getByTestId('anim-frame-1').click()
  await expect(page.getByTestId('editor-frames')).toHaveText('Frame 2 of 32')
  await page.getByTestId('tool-pencil').click()
  await clickCanvasCenter(page)
  await expect(page.getByTestId('editor-dirty')).toBeVisible()
  await page.getByTestId('anim-duplicate').click()
  await expect(page.getByTestId('editor-frames')).toHaveText('Frame 3 of 33')
  await expect(page.getByTestId('local-history')).toContainText('Duplicate frame')

  // Slower animation: 3 ticks per frame.
  const frametime = page.getByTestId('anim-frametime').locator('input')
  await frametime.fill('3')
  await frametime.press('Enter')
  await expect(page.getByTestId('anim-frame-0')).toContainText('0.15 s')

  // Onion skin and playback toggle without changing the texture.
  await page.getByTestId('anim-onion').click()
  await page.getByTestId('anim-play').click()
  await expect(page.getByTestId('anim-play')).toHaveText('Pause')
  await page.getByTestId('anim-play').click()

  await page.getByTestId('editor-save').click()
  await expect(page.getByTestId('editor-dirty')).toHaveCount(0)
  const png = decode(
    await readFile(await ctx.packFile('assets/minecraft/textures/block/fire_0.png'))
  )
  expect([png.width, png.height]).toEqual([16, 16 * 33])
  /** True when frame `f` (16 rows) has a black pixel (the fixture's fire frames have none). */
  const hasBlack = (f: number): boolean => {
    for (let y = f * 16; y < f * 16 + 16; y++) {
      for (let x = 0; x < 16; x++) {
        const o = (y * png.width + x) * png.channels
        if (png.data[o] === 0 && png.data[o + 1] === 0 && png.data[o + 2] === 0) return true
      }
    }
    return false
  }
  // Frames 2 and 3 (the copy) have the pixel, frame 1 does not.
  expect([hasBlack(0), hasBlack(1), hasBlack(2)]).toEqual([false, true, true])
  // The pack now has its own .mcmeta (Minecraft would not use vanilla's with the pack's PNG).
  const meta = JSON.parse(
    await readFile(await ctx.packFile('assets/minecraft/textures/block/fire_0.png.mcmeta'), 'utf8')
  )
  expect(meta).toEqual({ animation: { frametime: 3 } })
})

test('animates a still texture from a GIF', async () => {
  const ctx = await setup()
  launched = ctx.launched
  const { page, app, root } = launched
  await openTexture(page, 'stone')
  await expect(page.getByTestId('animation-panel')).toHaveCount(0)
  await page.getByTestId('editor-animate').click()
  await expect(page.getByTestId('editor-frames')).toHaveText('Frame 1 of 1')

  const gif = join(root, 'pulse.gif')
  await writeFile(
    gif,
    makeGif(
      8,
      8,
      [
        [255, 0, 0],
        [0, 0, 255]
      ],
      [10, 30]
    )
  )
  await stubOpenDialog(app, gif)
  await page.getByTestId('anim-import-gif').click()
  await expect(page.getByTestId('editor-frames')).toHaveText('Frame 1 of 2')
  await expect(page.getByTestId('anim-frame-1')).toContainText('0.3 s')

  await page.getByTestId('editor-save').click()
  await expect(page.getByTestId('editor-dirty')).toHaveCount(0)
  const png = decode(
    await readFile(await ctx.packFile('assets/minecraft/textures/block/stone.png'))
  )
  expect([png.width, png.height]).toEqual([16, 32])
  expect(Array.from(png.data.slice(0, 3))).toEqual([255, 0, 0])
  const meta = JSON.parse(
    await readFile(await ctx.packFile('assets/minecraft/textures/block/stone.png.mcmeta'), 'utf8')
  )
  expect(meta).toEqual({ animation: { frametime: 2, frames: [0, { index: 1, time: 6 }] } })
})
