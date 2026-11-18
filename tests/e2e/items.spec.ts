import { expect, test, type Page } from '@playwright/test'
import { mkdir, readFile, readdir, stat, writeFile } from 'fs/promises'
import { join } from 'path'
import { strFromU8, unzipSync } from 'fflate'
import { cleanup, launchApp, stubSaveDialog, type LaunchedApp } from './app'

type MakeFixtureJar = (outPath: string, versionId: string) => Promise<void>

let launched: LaunchedApp | undefined

/** A resource pack on the fixture jar (26.3), with vanilla set up. */
async function setup(
  name: string
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
  await page.getByTestId('new-pack-kind-resource').click()
  await page.getByTestId('new-pack-create').click()
  await expect(page.getByTestId('pack-name')).toHaveText(name)
  const packFile = async (path: string): Promise<string> => {
    const dirs = await readdir(join(l.workspaceDir, 'packs'))
    return join(l.workspaceDir, 'packs', dirs[0]!, ...path.split('/'))
  }
  return { launched: l, packFile }
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false
  )
}

/** Puts `id` in a recipe slot through the item picker. */
async function fillSlot(page: Page, slot: number, id: string, search: string): Promise<void> {
  await page.getByTestId(`recipe-slot-${slot}`).click()
  const picker = page.getByTestId('item-picker')
  await picker.getByTestId('item-picker-search').locator('input').fill(search)
  await picker.getByTestId(`item-picker-row-${id}`).click()
  await expect(page.getByTestId(`recipe-slot-${slot}`)).toHaveAttribute('data-value', id)
}

/** Sets an export pack type checkbox. */
async function setType(page: Page, type: 'resource' | 'data', on: boolean): Promise<void> {
  const box = page.getByTestId(`export-type-${type}`)
  if ((await box.getAttribute('aria-checked')) !== String(on)) await box.click()
  await expect(box).toHaveAttribute('aria-checked', String(on))
}

async function exportZip(
  page: Page,
  launchedApp: LaunchedApp,
  type: 'resource' | 'data'
): Promise<Record<string, Uint8Array>> {
  const out = join(launchedApp.root, `items-${type}.zip`)
  await stubSaveDialog(launchedApp.app, out)
  await page.getByTestId('export-open').click()
  await setType(page, type, true)
  await setType(page, type === 'resource' ? 'data' : 'resource', false)
  await page.getByTestId('export-run').click()
  await expect(page.getByTestId('report-dialog')).toBeVisible()
  await page.getByTestId('report-dialog').getByRole('button').last().click()
  await expect(page.getByTestId('report-dialog')).toHaveCount(0)
  return unzipSync(new Uint8Array(await readFile(out)))
}

test.afterEach(async () => {
  if (launched) await cleanup(launched)
  launched = undefined
})

test('creates, edits, undoes and exports a custom weapon', async () => {
  const ctx = await setup('Item pack')
  launched = ctx.launched
  const { page } = launched

  // A resource pack shows the Items section, which offers to switch to a combined pack.
  await expect(page.getByTestId('pack-section-data')).toHaveCount(0)
  await page.getByTestId('pack-section-items').click()
  await expect(page.getByTestId('items-needs-combined')).toBeVisible()
  await page.getByTestId('items-make-combined').click()
  await expect(page.getByTestId('pack-kind')).toContainText('Resource + data pack')
  await expect(page.getByTestId('pack-section-data')).toBeVisible()
  await expect(page.getByTestId('items-empty')).toBeVisible()

  // A weapon from the preset (diamond sword texture), with English and French names.
  await page.getByTestId('items-new').click()
  await page.getByTestId('item-new-kind-weapon').click()
  await page.getByTestId('item-new-name-en').locator('input').fill('Ruby Sword')
  await page.getByTestId('item-new-name-fr').locator('input').fill('Épée en rubis')
  await expect(page.getByTestId('item-new-id').locator('input')).toHaveValue('ruby_sword')
  await expect(page.getByTestId('item-new-texture-path')).toHaveText(
    'assets/minecraft/textures/item/diamond_sword.png'
  )
  await page.getByTestId('item-new-create').click()
  await expect(page.getByTestId('item-editor')).toBeVisible()
  await expect(page.getByTestId('item-name')).toHaveText('Ruby Sword')
  expect(await exists(await ctx.packFile('assets/item_pack/textures/item/ruby_sword.png'))).toBe(
    true
  )
  const created = JSON.parse(
    await readFile(await ctx.packFile('blocksmith/items/ruby_sword.json'), 'utf8')
  )
  expect(created).toMatchObject({ kind: 'weapon', base: 'minecraft:stone_sword', recipe: null })
  expect(created.weapon.attackDamage).toBe(7)

  // 9 attack damage and a shaped recipe (two apples above a stick, for 2 swords).
  await page.getByTestId('item-attack-damage').locator('input').fill('9')
  await page.getByTestId('recipe-mode-shaped').click()
  await fillSlot(page, 1, 'minecraft:apple', 'apple')
  await fillSlot(page, 4, 'minecraft:apple', 'apple')
  await fillSlot(page, 7, 'minecraft:stick', 'stick')
  await page.getByTestId('recipe-count').locator('input').fill('2')
  await expect(page.getByTestId('item-dirty')).toBeVisible()
  await page.getByTestId('item-save').click()
  await expect(page.getByTestId('item-dirty')).toHaveCount(0)

  const saved = JSON.parse(
    await readFile(await ctx.packFile('blocksmith/items/ruby_sword.json'), 'utf8')
  )
  expect(saved.weapon).toEqual({ attackDamage: 9, attackSpeed: 1.6 })
  expect(saved.recipe).toEqual({
    type: 'shaped',
    grid: [
      null,
      'minecraft:apple',
      null,
      null,
      'minecraft:apple',
      null,
      null,
      'minecraft:stick',
      null
    ],
    count: 2
  })
  const recipe = JSON.parse(
    await readFile(await ctx.packFile('data/item_pack/recipe/ruby_sword.json'), 'utf8')
  )
  expect(recipe.type).toBe('minecraft:crafting_shaped')
  expect(recipe.result).toMatchObject({ id: 'minecraft:stone_sword', count: 2 })
  const fr = JSON.parse(
    await readFile(await ctx.packFile('assets/item_pack/lang/fr_fr.json'), 'utf8')
  )
  expect(fr['item.item_pack.ruby_sword']).toBe('Épée en rubis')
  expect(
    await readFile(await ctx.packFile('data/item_pack/function/give/ruby_sword.mcfunction'), 'utf8')
  ).toContain('give @s minecraft:stone_sword[')
  await expect(page.getByTestId('item-how-to-function')).toHaveText(
    '/function item_pack:give/ruby_sword'
  )

  // Undo puts the item back as created (one history entry), in the form too; redo brings the edit back.
  await page.getByTestId('pack-history-open').click()
  const history = page.getByTestId('pack-history')
  await expect(history).toContainText('Saved item Ruby Sword')
  await history.getByTestId('pack-undo').click()
  await expect(page.getByTestId('item-attack-damage').locator('input')).toHaveValue('7')
  expect(
    JSON.parse(await readFile(await ctx.packFile('blocksmith/items/ruby_sword.json'), 'utf8'))
      .weapon.attackDamage
  ).toBe(7)
  expect(await exists(await ctx.packFile('data/item_pack/recipe/ruby_sword.json'))).toBe(false)
  await history.getByTestId('pack-redo').click()
  await expect(page.getByTestId('item-attack-damage').locator('input')).toHaveValue('9')
  await page.keyboard.press('Escape')
  await expect(history).toBeHidden()

  // Exports regenerate the files for the target and leave the definitions out.
  const resource = await exportZip(page, launched, 'resource')
  const resourcePaths = Object.keys(resource)
  expect(resourcePaths.filter((p) => p.startsWith('blocksmith/'))).toEqual([])
  expect(resourcePaths).toEqual(
    expect.arrayContaining([
      'assets/item_pack/items/ruby_sword.json',
      'assets/item_pack/models/item/ruby_sword.json',
      'assets/item_pack/textures/item/ruby_sword.png',
      'assets/item_pack/lang/en_us.json',
      'assets/item_pack/lang/fr_fr.json'
    ])
  )
  expect(JSON.parse(strFromU8(resource['assets/item_pack/models/item/ruby_sword.json']!))).toEqual({
    parent: 'minecraft:item/handheld',
    textures: { layer0: 'item_pack:item/ruby_sword' }
  })
  const data = await exportZip(page, launched, 'data')
  const dataPaths = Object.keys(data)
  expect(dataPaths.filter((p) => p.startsWith('blocksmith/'))).toEqual([])
  expect(dataPaths).toEqual(
    expect.arrayContaining([
      'data/item_pack/recipe/ruby_sword.json',
      'data/item_pack/function/give/ruby_sword.mcfunction'
    ])
  )

  // The texture opens in the pixel editor (no prev / next), and Back returns to the item page.
  await page.getByTestId('item-texture-edit').click()
  await expect(page.getByTestId('texture-editor')).toBeVisible()
  await expect(page.getByTestId('editor-name')).toContainText('ruby_sword')
  await expect(page.getByTestId('editor-prev')).toHaveCount(0)
  await expect(page.getByTestId('editor-back')).toHaveText('Back to the item')
  await page.getByTestId('editor-back').click()
  await expect(page.getByTestId('item-editor')).toBeVisible()
  await expect(page.getByTestId('item-attack-damage').locator('input')).toHaveValue('9')
  await page.getByTestId('item-back').click()
  await expect(page.getByTestId('item-row-ruby_sword')).toContainText('Ruby Sword')
})

test('shows generated data files read-only and opens their item', async () => {
  const ctx = await setup('Gen pack')
  launched = ctx.launched
  const { page } = launched
  await page.getByTestId('pack-kind').click()
  await page.getByText('Resource + data pack', { exact: true }).click()
  await expect(page.getByTestId('pack-kind')).toContainText('Resource + data pack')
  await page.getByTestId('pack-section-items').click()
  await page.getByTestId('items-new').click()
  await page.getByTestId('item-new-name-en').locator('input').fill('Coin')
  await page.getByTestId('item-new-create').click()
  await expect(page.getByTestId('item-name')).toHaveText('Coin')
  await page.getByTestId('item-back').click()

  // The give function is in the data files, read-only, with a way back to the item.
  await page.getByTestId('pack-section-data').click()
  await page.getByTestId('data-kind-function').click()
  await page.getByTestId('data-row-gen_pack:give/coin').click()
  await expect(page.getByTestId('data-generated')).toContainText('"coin"')
  await expect(page.getByTestId('data-save')).toHaveCount(0)
  await page.getByTestId('data-open-item').click()
  await expect(page.getByTestId('item-editor')).toBeVisible()
  await expect(page.getByTestId('item-name')).toHaveText('Coin')
})
