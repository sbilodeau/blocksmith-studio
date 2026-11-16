import { expect, test, type Page } from '@playwright/test'
import { mkdir, readFile, readdir, stat, writeFile } from 'fs/promises'
import { join } from 'path'
import { strFromU8, unzipSync } from 'fflate'
import { cleanup, launchApp, stubSaveDialog, type LaunchedApp } from './app'

type MakeFixtureJar = (outPath: string, versionId: string) => Promise<void>

let launched: LaunchedApp | undefined

/** A pack of `kind` on the fixture jar (vanilla data: 2 recipes, a loot table, 2 tags, an advancement). */
async function setup(
  name: string,
  kind: 'resource' | 'data'
): Promise<{ launched: LaunchedApp; packFile: (path: string) => Promise<string> }> {
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
  await page.getByTestId('new-pack-name').locator('input').fill(name)
  await page.getByTestId(`new-pack-kind-${kind}`).click()
  await page.getByTestId('new-pack-create').click()
  await expect(page.getByTestId('pack-name')).toHaveText(name)
  const packFile = async (path: string): Promise<string> => {
    const dirs = await readdir(join(l.workspaceDir, 'packs'))
    return join(l.workspaceDir, 'packs', dirs[0]!, ...path.split('/'))
  }
  return { launched: l, packFile }
}

/** Replaces the whole text of the open code editor. */
async function setEditorText(page: Page, text: string): Promise<void> {
  const content = page.getByTestId('data-editor').getByTestId('code-editor').locator('.cm-content')
  await content.click()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
  await page.keyboard.press('Delete')
  await page.keyboard.insertText(text)
}

test.afterEach(async () => {
  if (launched) await cleanup(launched)
  launched = undefined
})

test('edits a vanilla recipe with live checks, creates a file and exports a data pack', async () => {
  const ctx = await setup('Data pack', 'data')
  launched = ctx.launched
  const { page, app, root } = launched
  await expect(page.getByTestId('pack-kind')).toContainText('Data pack')
  await expect(page.getByTestId('data-list')).toBeVisible()
  await expect(page.getByTestId('data-kind-recipe')).toContainText('2')
  await expect(page.getByTestId('data-kind-tag')).toContainText('2')

  // Open the vanilla stone slab recipe and break it: the check reports the missing result.
  await page.getByTestId('data-row-minecraft:stone_slab').click()
  await expect(page.getByTestId('data-name')).toHaveText('minecraft:stone_slab')
  await expect(page.getByTestId('data-status')).toHaveText('Vanilla')
  await setEditorText(
    page,
    '{"type": "minecraft:crafting_shaped", "pattern": ["###"], "key": {"#": "minecraft:stone"}}'
  )
  await expect(page.getByTestId('data-summary')).toContainText('1 error')
  await expect(page.getByTestId('data-issue-0')).toContainText('"result" is required')

  // Fix it (3 slabs instead of 6), format and save with the keyboard.
  await setEditorText(
    page,
    '{"type": "minecraft:crafting_shaped", "pattern": ["###"], "key": {"#": "minecraft:stone"}, "result": {"id": "minecraft:stone_slab", "count": 3}}'
  )
  await expect(page.getByTestId('data-summary')).not.toContainText('error')
  await page.getByTestId('data-format').click()
  await page.getByTestId('data-save').click()
  await expect(page.getByTestId('data-dirty')).toHaveCount(0)
  await expect(page.getByTestId('data-status')).toHaveText('Modified')
  const saved = JSON.parse(
    await readFile(await ctx.packFile('data/minecraft/recipe/stone_slab.json'), 'utf8')
  )
  expect(saved.result).toEqual({ id: 'minecraft:stone_slab', count: 3 })

  // Back to the list: one changed recipe.
  await page.getByTestId('data-back').click()
  await page.getByTestId('data-filter-changed').click()
  await expect(page.getByTestId('data-row-minecraft:stone_slab')).toBeVisible()

  // A new recipe in the pack's namespace, from a template.
  await page.getByTestId('data-new').click()
  await page.getByTestId('data-new-name').locator('input').fill('ruby')
  await page.getByTestId('data-new-create').click()
  await expect(page.getByTestId('data-name')).toHaveText('data_pack:ruby')
  await expect(page.getByTestId('data-summary')).not.toContainText('error')
  expect((await stat(await ctx.packFile('data/data_pack/recipe/ruby.json'))).isFile()).toBe(true)
  await page.getByTestId('data-back').click()

  // Export: a data pack zip with the data pack format and only data/ files.
  const out = join(root, 'data-pack.zip')
  await stubSaveDialog(app, out)
  await page.getByTestId('export-open').click()
  await expect(page.getByTestId('export-type-data')).toHaveCount(0)
  await page.getByTestId('export-run').click()
  await expect(page.getByTestId('export-dialog')).toHaveCount(0)
  const zip = unzipSync(new Uint8Array(await readFile(out)))
  expect(Object.keys(zip).sort()).toEqual([
    'data/data_pack/recipe/ruby.json',
    'data/minecraft/recipe/stone_slab.json',
    'pack.mcmeta',
    'pack.png'
  ])
  expect(JSON.parse(strFromU8(zip['pack.mcmeta']!)).pack.pack_format).toBe(121)
})

test('turns a resource pack into a combined pack with a data section', async () => {
  const ctx = await setup('Both pack', 'resource')
  launched = ctx.launched
  const { page } = launched
  await expect(page.getByTestId('pack-section-data')).toHaveCount(0)
  await page.getByTestId('pack-kind').click()
  await page.getByText('Resource + data pack', { exact: true }).click()
  await expect(page.getByTestId('pack-kind')).toContainText('Resource + data pack')
  await page.getByTestId('pack-section-data').click()
  await expect(page.getByTestId('data-list')).toBeVisible()
  await page.getByTestId('data-kind-loot_table').click()
  await expect(page.getByTestId('data-row-minecraft:blocks/stone')).toBeVisible()
  await page.getByTestId('pack-section-textures').click()
  await expect(page.getByTestId('category-sidebar')).toBeVisible()
  // Both zips are offered by default.
  await page.getByTestId('export-open').click()
  await expect(page.getByTestId('export-type-resource')).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('export-type-data')).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('export-run')).toContainText('Export 2 .zip files')
  const meta = JSON.parse(await readFile(await ctx.packFile('pack.mcmeta'), 'utf8'))
  expect(meta.pack.pack_format).toBe(97)
})
