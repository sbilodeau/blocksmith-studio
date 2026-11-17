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

const AXE_SOURCE = readFile(require.resolve('axe-core/axe.min.js'), 'utf8')

interface Found {
  id: string
  impact: string | null
  help: string
  targets: string[]
}

/** Serious and critical WCAG 2.1 A/AA violations on the current screen, as readable lines. */
async function violations(page: Page, screen: string): Promise<string[]> {
  // Finite animations (dialogs fading in) would be measured half transparent: let them finish.
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity)
  )
  // axe runs inside the renderer (evaluated over the DevTools protocol, not subject to the page CSP).
  await page.evaluate(await AXE_SOURCE)
  const found = await page.evaluate(async () => {
    const axe = (
      window as unknown as {
        axe: {
          run(options: unknown): Promise<{
            violations: Array<{
              id: string
              impact: string | null
              help: string
              nodes: Array<{ target: string[] }>
            }>
          }>
        }
      }
    ).axe
    const result = await axe.run({
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }
    })
    return result.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      targets: v.nodes.map((n) => n.target.join(' '))
    }))
  })
  return (found as Found[])
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `[${screen}] ${v.id}: ${v.help} -> ${v.targets.slice(0, 5).join(' | ')}`)
}

let launched: LaunchedApp

test.afterEach(async () => {
  if (launched) await cleanup(launched)
})

for (const theme of ['light', 'dark'] as const) {
  test(`main screens have no serious accessibility violations (${theme} theme)`, async () => {
    const first = await launchApp()
    const mc = join(first.root, 'minecraft')
    await mkdir(join(mc, 'versions', '26.3'), { recursive: true })
    await makeFixtureJar(join(mc, 'versions', '26.3', '26.3.jar'), '26.3')
    await first.app.close()
    const settingsPath = join(first.userDataDir, 'settings.json')
    const settings = JSON.parse(await readFile(settingsPath, 'utf8'))
    settings.minecraftPaths = [mc]
    settings.theme = theme
    await writeFile(settingsPath, JSON.stringify(settings))
    launched = await launchApp({ root: first.root })
    const { page } = launched
    const found: string[] = []

    found.push(...(await violations(page, 'home')))
    await page.getByTestId('open-settings').click()
    const row = page.getByTestId('vanilla-row-26.3')
    await row.getByRole('button').click()
    await expect(row).toContainText('Ready', { timeout: 30_000 })
    found.push(...(await violations(page, 'settings')))

    await page.getByTestId('tab-home').click()
    await page.getByTestId('new-pack').click()
    found.push(...(await violations(page, 'new pack dialog')))
    await page.getByTestId('new-pack-name').locator('input').fill('A11y pack')
    await page.getByTestId('new-pack-create').click()
    await expect(page.getByTestId('pack-name')).toHaveText('A11y pack')
    found.push(...(await violations(page, 'navigator')))

    await page.getByTestId('edit-categories').click()
    await expect(page.getByTestId('cat-editor')).toBeVisible()
    found.push(...(await violations(page, 'category editor')))
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('cat-editor')).toHaveCount(0)

    await page.getByTestId('play-open').click()
    await expect(page.getByTestId('play-dialog')).toBeVisible()
    await expect(page.getByTestId('play-game-dir')).toContainText('Minecraft launcher')
    found.push(...(await violations(page, 'play in Minecraft dialog')))
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('play-dialog')).toHaveCount(0)

    await page.getByTestId('cat-blocks').click()
    found.push(...(await violations(page, 'grid')))

    await page.getByTestId('tile-stone').dblclick()
    await page.getByTestId('layer-add').click()
    await page.getByTestId('editor-3d').click()
    await expect(page.getByTestId('preview3d-kind')).toHaveText('Block model')
    found.push(...(await violations(page, 'editor')))

    expect(found).toEqual([])
  })
}

test('editor controls work from the keyboard', async () => {
  launched = await launchApp()
  const { page } = launched
  // The keyboard rules are checked on the settings screen (no Minecraft needed): switches toggle with Space.
  await page.getByTestId('open-settings').click()
  const autoCheck = page.getByTestId('auto-check')
  const before = await autoCheck.getAttribute('aria-checked')
  await autoCheck.focus()
  await page.keyboard.press('Space')
  await expect(autoCheck).not.toHaveAttribute('aria-checked', before ?? '')
})
