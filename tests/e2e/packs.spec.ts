import { expect, test } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { strFromU8, unzipSync, zipSync } from 'fflate'
import { encode } from 'fast-png'
import {
  cleanup,
  lastSaveDefaultName,
  launchApp,
  stubOpenDialog,
  stubSaveDialog,
  type LaunchedApp
} from './app'

type MakeFixtureJar = (outPath: string, versionId: string) => Promise<void>

/** Synthetic Minecraft jar (no Mojang assets) from scripts/make-fixture-jar.mjs (ESM, loaded dynamically). */
async function makeFixtureJar(outPath: string, versionId: string): Promise<void> {
  const mod = (await import('../../scripts/make-fixture-jar.mjs' as string)) as {
    makeFixtureJar: MakeFixtureJar
  }
  await mod.makeFixtureJar(outPath, versionId)
}

let launched: LaunchedApp

function png(color: [number, number, number]): Uint8Array {
  const data = new Uint8Array(16 * 16 * 4)
  for (let i = 0; i < 16 * 16; i++) data.set([...color, 255], i * 4)
  return encode({ width: 16, height: 16, data, channels: 4, depth: 8 })
}

/** A Minecraft folder (official launcher layout) containing the synthetic 26.3 jar. */
async function fixtureMinecraftDir(root: string): Promise<string> {
  const dir = join(root, 'minecraft')
  await mkdir(join(dir, 'versions', '26.3'), { recursive: true })
  await makeFixtureJar(join(dir, 'versions', '26.3', '26.3.jar'), '26.3')
  return dir
}

async function launchWithFixture(): Promise<LaunchedApp> {
  const first = await launchApp()
  const mc = await fixtureMinecraftDir(first.root)
  await first.app.close()
  // Relaunch with the fixture folder registered as a manual Minecraft path.
  const settingsPath = join(first.userDataDir, 'settings.json')
  const settings = JSON.parse(await readFile(settingsPath, 'utf8'))
  settings.minecraftPaths = [mc]
  await writeFile(settingsPath, JSON.stringify(settings))
  return launchApp({ root: first.root })
}

async function prepareVanilla(l: LaunchedApp): Promise<void> {
  const { page } = l
  await page.getByTestId('open-settings').click()
  const row = page.getByTestId('vanilla-row-26.3')
  await expect(row).toContainText('On this computer')
  await row.getByRole('button').click()
  await expect(row).toContainText('Ready', { timeout: 30_000 })
  await page.getByTestId('tab-home').click()
}

async function createPack(l: LaunchedApp, name: string): Promise<void> {
  const { page } = l
  await page.getByTestId('new-pack').click()
  await page.getByTestId('new-pack-name').locator('input').fill(name)
  await page.getByTestId('new-pack-create').click()
  await expect(page.getByTestId('pack-name')).toHaveText(name)
}

test.afterEach(async () => {
  if (launched) await cleanup(launched)
})

test('extracts vanilla from a local jar, creates a pack and browses categories', async () => {
  launched = await launchWithFixture()
  const { page } = launched
  await prepareVanilla(launched)
  await createPack(launched, 'Fire pack')

  // One tab per pack.
  await expect(page.getByTestId('tab-home')).toBeVisible()
  await expect(page.locator('[data-testid^="tab-"]')).toHaveCount(2)

  // Navigator shows categories with counts and real thumbnails from bs-asset://.
  await expect(page.getByTestId('overview-blocks')).toBeVisible()
  const icon = page.getByTestId('overview-blocks').locator('img')
  await expect
    .poll(() => icon.evaluate((img) => (img as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0)

  // Grid of a category, search and selection.
  await page.getByTestId('cat-blocks').click()
  await expect(page.getByTestId('tile-stone')).toBeVisible()
  await expect(page.getByTestId('tile-stone')).toHaveAttribute('data-status', 'vanilla')
  await page.getByTestId('grid-search').locator('input').fill('stone')
  await expect(page.locator('[data-testid^="tile-"]')).toHaveCount(1)
  await page.getByTestId('tile-stone').click()
  await expect(page.getByTestId('selection-bar')).toContainText('1 texture selected')

  // The pack is listed on the home tab.
  await page.getByTestId('tab-home').click()
  await expect(page.getByTestId('pack-list')).toContainText('Fire pack')
})

test('imports a zip, marks modified textures and exports only changed files', async () => {
  launched = await launchWithFixture()
  const { page, app, root } = launched
  await prepareVanilla(launched)

  const zipPath = join(root, 'my-pack.zip')
  await writeFile(
    zipPath,
    zipSync({
      'My Pack/pack.mcmeta': new TextEncoder().encode(
        JSON.stringify({ pack: { min_format: [97, 1], max_format: 97, description: 'Red stone' } })
      ),
      'My Pack/assets/minecraft/textures/block/stone.png': png([200, 30, 30]),
      'My Pack/assets/minecraft/textures/item/ruby.png': png([220, 0, 60])
    })
  )
  await stubOpenDialog(app, zipPath)
  await page.getByTestId('import-pack').click()
  await expect(page.getByTestId('report-dialog')).toContainText('imported')
  await page.getByTestId('report-dialog').getByRole('button', { name: 'Close' }).last().click()

  await page.locator('[data-testid^="pack-open-"]').first().click()
  await page.getByTestId('cat-all').click()
  await expect(page.getByTestId('tile-stone')).toHaveAttribute('data-status', 'modified')
  await expect(page.getByTestId('tile-ruby')).toHaveAttribute('data-status', 'added')

  const outPath = join(root, 'export.zip')
  await stubSaveDialog(app, outPath)
  await page.getByTestId('export-open').click()
  await page.getByTestId('export-run').click()
  await expect(page.getByTestId('report-dialog')).toContainText('26.3')

  const files = unzipSync(new Uint8Array(await readFile(outPath)))
  expect(Object.keys(files).sort()).toEqual([
    'assets/minecraft/textures/block/stone.png',
    'assets/minecraft/textures/item/ruby.png',
    'pack.mcmeta',
    'pack.png'
  ])
  const mcmeta = JSON.parse(strFromU8(files['pack.mcmeta']))
  expect(mcmeta.pack).toMatchObject({ pack_format: 97, min_format: [97, 0], max_format: [97, 1] })
  expect(mcmeta.pack.description).toBe('Red stone')

  // "Also accept newer versions" (snapshots) opens the range.
  const openPath = join(root, 'export-open.zip')
  await stubSaveDialog(app, openPath)
  await page.getByTestId('report-dialog').getByRole('button').last().click()
  await page.getByTestId('export-open').click()
  await page.getByTestId('export-accept-newer').click()
  await page.getByTestId('export-run').click()
  await expect(page.getByTestId('report-dialog')).toContainText('26.3')
  const open = JSON.parse(
    strFromU8(unzipSync(new Uint8Array(await readFile(openPath)))['pack.mcmeta'])
  )
  expect(open.pack).toMatchObject({ pack_format: 97, min_format: [97, 0], max_format: 999 })

  // The newest snapshot is an export target with its own pack format.
  const snapPath = join(root, 'export-snapshot.zip')
  await stubSaveDialog(app, snapPath)
  await page.getByTestId('report-dialog').getByRole('button').last().click()
  await page.getByTestId('export-open').click()
  await page.getByTestId('export-accept-newer').click()
  await page.getByTestId('export-target').locator('.n-base-suffix').click()
  // allTextContents() does not wait: let the menu render first.
  await expect(page.locator('.n-base-select-option').first()).toBeVisible()
  // Newer snapshots first, then the pack's version and the older releases of the support window.
  const optionTexts = await page.locator('.n-base-select-option').allTextContents()
  expect(optionTexts.slice(0, 3)).toEqual([
    '26.4-snapshot-8 (snapshot)',
    '26.3 (pack version)',
    '26.2'
  ])
  // Multiple choice: untick the preselected pack version, tick the snapshot.
  await page.locator('.n-base-select-option', { hasText: '26.3 (pack version)' }).click()
  await page.locator('.n-base-select-option', { hasText: '26.4-snapshot-8 (snapshot)' }).click()
  await page.keyboard.press('Escape')
  await page.getByTestId('export-run').click()
  await expect(page.getByTestId('report-dialog')).toContainText('26.4-snapshot-8')
  const snap = JSON.parse(
    strFromU8(unzipSync(new Uint8Array(await readFile(snapPath)))['pack.mcmeta'])
  )
  expect(snap.pack).toMatchObject({ pack_format: 103, min_format: [103, 0], max_format: [103, 0] })
  expect(await lastSaveDefaultName(app)).toBe('my-pack-26.4-snapshot-8-resource-pack.zip')

  // Several versions: one zip each in a folder; the older one gets its own pack format.
  const folder = join(root, 'exports')
  await mkdir(folder, { recursive: true })
  await stubOpenDialog(app, folder)
  await page.getByTestId('report-dialog').getByRole('button').last().click()
  await page.getByTestId('export-open').click()
  await page.getByTestId('export-target').locator('.n-base-suffix').click()
  // The dialog remembered the last export (the snapshot): replace it with 26.3 and 1.21.4.
  await page.locator('.n-base-select-option', { hasText: '26.4-snapshot-8 (snapshot)' }).click()
  await page.locator('.n-base-select-option', { hasText: '26.3 (pack version)' }).click()
  // The list is long (only visible options are rendered): type to filter.
  await page.getByTestId('export-target').locator('input').fill('1.21.4')
  await page.locator('.n-base-select-option', { hasText: /^1\.21\.4$/ }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('export-run')).toHaveText('Export 2 .zip files')
  await page.getByTestId('export-run').click()
  await expect(page.getByTestId('report-dialog')).toContainText('1.21.4')
  const old = unzipSync(
    new Uint8Array(await readFile(join(folder, 'my-pack-1.21.4-resource-pack.zip')))
  )
  expect(JSON.parse(strFromU8(old['pack.mcmeta'])).pack.pack_format).toBe(46)
  expect(Object.keys(old)).toContain('assets/minecraft/textures/block/stone.png')
  await readFile(join(folder, 'my-pack-26.3-resource-pack.zip'))

  // The data pack choice is hidden until data pack editing (M10).
  await page.getByTestId('report-dialog').getByRole('button').last().click()
  await page.getByTestId('export-open').click()
  await expect(page.getByTestId('export-dialog')).toContainText('Options > Resource Packs')
  await expect(page.getByTestId('export-pack-type')).toHaveCount(0)
})

test('deleting a pack moves it out of the list', async () => {
  launched = await launchWithFixture()
  const { page } = launched
  await prepareVanilla(launched)
  await createPack(launched, 'Temp pack')
  await page.getByTestId('tab-home').click()
  await page.locator('[data-testid^="pack-delete-"]').first().click()
  await page.getByRole('button', { name: 'Delete' }).last().click()
  await expect(page.getByTestId('home-empty')).toBeVisible()
  await expect(page.locator('[data-testid^="tab-"]')).toHaveCount(1)
})

test('a pack made for an older version is upgraded to the latest one', async () => {
  launched = await launchWithFixture()
  const { page } = launched
  await prepareVanilla(launched)
  await page.getByTestId('new-pack').click()
  await page.getByTestId('new-pack-name').locator('input').fill('Older pack')
  await page.getByTestId('new-pack-base-empty').click()
  await page.getByTestId('new-pack-version').locator('input').fill('26.2')
  await page
    .locator('.n-base-select-option', { hasText: /^26\.2/ })
    .first()
    .click()
  await page.getByTestId('new-pack-create').click()
  await expect(page.getByTestId('pack-name')).toHaveText('Older pack')
  await expect(page.getByTestId('pack-view')).toContainText('Minecraft 26.2')

  await page.getByTestId('pack-upgrade').click()
  await page.locator('.n-popconfirm').getByRole('button').last().click()
  await expect(page.getByTestId('report-dialog')).toContainText('Moved from Minecraft 26.2 to 26.3')
  await page.getByTestId('report-dialog').getByRole('button').last().click()
  await expect(page.getByTestId('pack-view')).toContainText('Minecraft 26.3')
  await expect(page.getByTestId('pack-upgrade')).toHaveCount(0)

  // Pack Doctor: nothing wrong in a fresh pack, and every other version is listed.
  await page.getByTestId('pack-doctor-open').click()
  const doctor = page.getByTestId('pack-doctor')
  await expect(doctor.getByTestId('doctor-ok')).toBeVisible()
  await expect(doctor.getByTestId('doctor-targets')).toContainText('1.21.4')
  await expect(doctor.getByTestId('doctor-targets')).not.toContainText('26.3')
})

test('merges two packs into a new one, then sends a texture to a pack', async () => {
  launched = await launchWithFixture()
  const { page, workspaceDir } = launched
  await prepareVanilla(launched)
  await createPack(launched, 'Source A')
  await page.getByTestId('tab-home').click()
  await createPack(launched, 'Source B')
  const T = (p: string): string => `assets/minecraft/textures/${p}.png`
  const put = async (pack: string, path: string, rgb: [number, number, number]): Promise<void> => {
    const abs = join(workspaceDir, 'packs', pack, ...path.split('/'))
    await mkdir(join(abs, '..'), { recursive: true })
    await writeFile(abs, png(rgb))
  }
  await put('source-a', T('block/stone'), [255, 0, 0])
  await put('source-b', T('block/stone'), [0, 0, 255])
  await put('source-b', T('item/ruby'), [200, 0, 50])

  // Merge A and B (A first) into a new pack.
  await page.getByTestId('tab-home').click()
  await page.getByTestId('merge-open').click()
  const dialog = page.getByTestId('merge-dialog')
  await dialog.getByTestId('merge-sources').locator('.n-base-suffix').click()
  await page.locator('.n-base-select-option', { hasText: 'Source A' }).click()
  await page.locator('.n-base-select-option', { hasText: 'Source B' }).click()
  await page.keyboard.press('Escape')
  await expect(dialog.getByTestId('merge-order')).toContainText('1.Source A')
  await dialog.getByTestId('merge-target').click()
  await page.locator('.n-base-select-option', { hasText: 'A new pack' }).click()
  await dialog.getByTestId('merge-new-name').locator('input').fill('Merged')
  await dialog.getByTestId('merge-preview').click()

  const review = dialog.getByTestId('merge-review')
  await expect(review.getByTestId('merge-added')).toContainText('1 file added')
  await expect(review.getByTestId('merge-conflicts')).toContainText('block/stone.png')
  // Keep Source B's blue stone instead of the first source's.
  await review.getByTestId('merge-choice-Source B').click()
  await dialog.getByTestId('merge-apply').click()
  await expect(page.getByTestId('pack-name')).toHaveText('Merged')
  await page.getByTestId('cat-all').click()
  await expect(page.getByTestId('tile-stone')).toHaveAttribute('data-status', 'modified')
  await expect(page.getByTestId('tile-ruby')).toHaveAttribute('data-status', 'added')
  await page.getByTestId('pack-history-open').click()
  await expect(page.getByTestId('pack-history')).toContainText('Merged 3 files from 2 packs') // stone, ruby and the icon
  await page.keyboard.press('Escape')

  // Send Source A's red stone to "Merged": a conflict with its blue stone.
  await page.locator('[data-testid^="tab-"]', { hasText: 'Source A' }).first().click()
  // The files were written outside the app: tell the open tab to reload (the app sends this after its own writes).
  await launched.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.webContents.send('packs.changed', {})
  )
  await page.getByTestId('cat-all').click()
  await page.getByTestId('tile-stone').click()
  await page.getByTestId('selection-send').click()
  const send = page.getByTestId('merge-dialog')
  await expect(send).toContainText('1 file from "Source A"')
  await send.getByTestId('merge-target').click()
  await page.locator('.n-base-select-option', { hasText: 'Merged' }).click()
  await send.getByTestId('merge-preview').click()
  await expect(send.getByTestId('merge-conflicts')).toContainText('block/stone.png')
  await send.getByTestId('merge-apply').click()
  await expect(send).toBeHidden()
})
