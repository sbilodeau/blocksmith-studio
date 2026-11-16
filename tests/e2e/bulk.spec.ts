import { expect, test, type Page } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { cleanup, launchApp, type LaunchedApp } from './app'
import {
  jsonFixture,
  startFakeProviderServer,
  type FakeProviderServer,
  type RouteHandler
} from '../fixtures/ai/server'

/**
 * M5 end to end: a manual bulk edit of a grid selection (preview, review, apply, undo from History), and the
 * navigation agent changing a selection through a plan reviewed texture by texture (fake Ollama server).
 * M6: the creation agent changing a whole category and the pack name through a plan reviewed step by step.
 */

type MakeFixtureJar = (outPath: string, versionId: string) => Promise<void>

async function makeFixtureJar(outPath: string, versionId: string): Promise<void> {
  const mod = (await import('../../scripts/make-fixture-jar.mjs' as string)) as {
    makeFixtureJar: MakeFixtureJar
  }
  await mod.makeFixtureJar(outPath, versionId)
}

const MODEL = 'qwen3:32b'

let launched: LaunchedApp | undefined
let server: FakeProviderServer | undefined

test.afterEach(async () => {
  if (launched) await cleanup(launched)
  await server?.close()
  launched = undefined
  server = undefined
})

async function setup(ai?: { url: string }): Promise<LaunchedApp> {
  const first = await launchApp()
  const mc = join(first.root, 'minecraft')
  await mkdir(join(mc, 'versions', '26.3'), { recursive: true })
  await makeFixtureJar(join(mc, 'versions', '26.3', '26.3.jar'), '26.3')
  await first.app.close()
  const settingsPath = join(first.userDataDir, 'settings.json')
  const settings = JSON.parse(await readFile(settingsPath, 'utf8'))
  settings.minecraftPaths = [mc]
  if (ai) {
    settings.ai = {
      providers: [
        { id: 'local', kind: 'ollama', label: 'Ollama local', baseUrl: ai.url, enabled: true }
      ],
      agents: {
        navigation: { model: { providerId: 'local', modelId: MODEL } },
        creation: { model: { providerId: 'local', modelId: MODEL } }
      }
    }
  }
  await writeFile(settingsPath, JSON.stringify(settings))
  const l = await launchApp({ root: first.root })
  const { page } = l
  await page.getByTestId('open-settings').click()
  const row = page.getByTestId('vanilla-row-26.3')
  await row.getByRole('button').click()
  await expect(row).toContainText('Ready', { timeout: 30_000 })
  await page.getByTestId('tab-home').click()
  await page.getByTestId('new-pack').click()
  await page.getByTestId('new-pack-name').locator('input').fill('Bulk pack')
  await page.getByTestId('new-pack-create').click()
  await expect(page.getByTestId('pack-name')).toHaveText('Bulk pack')
  return l
}

async function selectStoneAndDirt(page: Page): Promise<void> {
  await page.getByTestId('cat-blocks').click()
  await page.getByTestId('tile-stone').click()
  await page.getByTestId('tile-dirt').click({ modifiers: ['ControlOrMeta'] })
  await expect(page.getByTestId('selection-bar')).toContainText('2 textures selected')
}

test('a manual bulk edit previews, applies to the kept textures and undoes from History', async () => {
  launched = await setup()
  const { page } = launched
  await selectStoneAndDirt(page)

  await page.getByTestId('selection-bulk').click()
  const dialog = page.getByTestId('bulk-dialog')
  await expect(dialog).toBeVisible()
  // Brightness +20% changes the gray fixture textures (a hue shift would not).
  await dialog.getByTestId('bulk-op-kind').click()
  await page.locator('.n-base-select-option', { hasText: 'Brightness' }).click()
  await dialog.getByTestId('bulk-preview').click()

  const review = dialog.getByTestId('bulk-review')
  await expect(review).toContainText('2 textures change')
  await review.getByTestId('bulk-item-dirt').click()
  await review.getByTestId('bulk-apply').click()
  await expect(dialog).toBeHidden()

  await expect(page.getByTestId('tile-stone')).toHaveAttribute('data-status', 'modified')
  await expect(page.getByTestId('tile-dirt')).toHaveAttribute('data-status', 'vanilla')

  await page.getByTestId('pack-history-open').click()
  const history = page.getByTestId('pack-history')
  await expect(history).toContainText('Bulk edit of 1 texture')
  await history.getByTestId('pack-undo').click()
  await expect(page.getByTestId('tile-stone')).toHaveAttribute('data-status', 'vanilla')
})

/** First turn: brighten every selected texture; after the tool result, a short French reply. */
const chat: RouteHandler = (req, res) => {
  const body = req.body as { messages: Array<{ role: string }> }
  const last = body.messages[body.messages.length - 1]
  const message =
    last?.role === 'tool'
      ? { role: 'assistant', content: "J'ai éclairci les textures." }
      : {
          role: 'assistant',
          content: '',
          tool_calls: [{ function: { name: 'brightness', arguments: { delta: 0.3 } } }]
        }
  const lines = [
    { model: MODEL, message, done: false },
    {
      model: MODEL,
      message: { role: 'assistant', content: '' },
      done: true,
      done_reason: 'stop',
      prompt_eval_count: 300,
      eval_count: 20
    }
  ]
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
  res.end(lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
}

test('the navigation agent changes a selection through a reviewed plan', async () => {
  server = await startFakeProviderServer()
  server.on('GET', '/api/tags', jsonFixture('ollama/tags.json'))
  server.on('POST', '/api/show', jsonFixture('ollama/show-qwen3.json'))
  server.on('POST', '/api/chat', chat)
  launched = await setup({ url: server.url })
  const { page } = launched
  await selectStoneAndDirt(page)

  await page.getByTestId('selection-ai').click()
  const panel = page.getByTestId('navigation-agent')
  await expect(panel.getByTestId('navigation-selection')).toContainText('2 selected textures')
  await panel.getByTestId('agent-input').locator('textarea').fill('mets tout plus clair')
  await panel.getByTestId('agent-send').click()

  const review = panel.getByTestId('bulk-review')
  await expect(review).toBeVisible({ timeout: 15_000 })
  await expect(review.getByTestId('bulk-step-brightness')).toBeVisible()
  await expect(review).toContainText('2 textures change')
  await expect(panel.getByTestId('agent-text')).toContainText('éclairci')

  // The request listed the selection by number.
  const sent = server.requests.find((r) => r.path === '/api/chat')!.body as {
    messages: Array<{ role: string; content: string }>
    tools: Array<{ function: { name: string } }>
  }
  const user = sent.messages.filter((m) => m.role === 'user').at(-1)!
  expect(user.content).toContain('[Selection: 2 textures]')
  expect(user.content).toMatch(/#1 block\/(stone|dirt)/)
  expect(sent.tools.map((t) => t.function.name)).not.toContain('set_pixels')

  await review.getByTestId('bulk-apply').click()
  await expect(page.getByTestId('tile-stone')).toHaveAttribute('data-status', 'modified')
  await expect(page.getByTestId('tile-dirt')).toHaveAttribute('data-status', 'modified')
  await page.getByTestId('pack-history-open').click()
  await expect(page.getByTestId('pack-history')).toContainText('AI plan on 2 textures')
})

/** Creation agent: brighten every block and rename the pack; after the tool results, a short French reply. */
const creationChat: RouteHandler = (req, res) => {
  const body = req.body as { messages: Array<{ role: string }> }
  const last = body.messages[body.messages.length - 1]
  const message =
    last?.role === 'tool'
      ? { role: 'assistant', content: 'Voici le plan.' }
      : {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              function: {
                name: 'apply_to_all',
                arguments: {
                  operation: { tool: 'brightness', args: { delta: 0.3 } },
                  filter: { categories: ['blocks'] }
                }
              }
            },
            { function: { name: 'set_pack_meta', arguments: { name: 'Fire Pack' } } }
          ]
        }
  const lines = [
    { model: MODEL, message, done: false },
    {
      model: MODEL,
      message: { role: 'assistant', content: '' },
      done: true,
      done_reason: 'stop',
      prompt_eval_count: 300,
      eval_count: 20
    }
  ]
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
  res.end(lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
}

test('the creation agent changes a whole category and the pack name through a plan', async () => {
  server = await startFakeProviderServer()
  server.on('GET', '/api/tags', jsonFixture('ollama/tags.json'))
  server.on('POST', '/api/show', jsonFixture('ollama/show-qwen3.json'))
  server.on('POST', '/api/chat', creationChat)
  launched = await setup({ url: server.url })
  const { page } = launched

  // On the pack overview the AI button opens the creation agent (whole pack).
  await page.getByTestId('creation-toggle').click()
  const panel = page.getByTestId('creation-agent')
  await expect(panel.getByTestId('creation-context')).toContainText('Whole pack:')
  await panel.getByTestId('agent-input').locator('textarea').fill('fais un pack de feu')
  await panel.getByTestId('agent-send').click()

  const review = panel.getByTestId('creation-review')
  await expect(review).toBeVisible({ timeout: 15_000 })
  await expect(review.getByTestId('plan-step-brightness')).toContainText('Blocks')
  await expect(review.getByTestId('plan-step-set_pack_meta')).toContainText('Name: Fire Pack')
  await expect(panel.getByTestId('agent-text')).toContainText('Voici le plan')

  // The request described the pack by category; the tools are the creation scope's.
  const sent = server.requests.find((r) => r.path === '/api/chat')!.body as {
    messages: Array<{ role: string; content: string }>
    tools: Array<{ function: { name: string } }>
  }
  const user = sent.messages.filter((m) => m.role === 'user').at(-1)!
  expect(user.content).toContain('[Pack: "Bulk pack"]')
  expect(user.content).toMatch(/- blocks: \d+/)
  expect(sent.tools.map((t) => t.function.name)).toEqual([
    'apply_to_all',
    'list_textures',
    'set_pack_meta',
    'update_style_brief'
  ])

  await review.getByTestId('plan-apply').click()
  await expect(page.getByTestId('pack-name')).toHaveText('Fire Pack')
  await expect(review).toContainText('Applied')
  await page.getByTestId('cat-blocks').click()
  await expect(page.getByTestId('tile-stone')).toHaveAttribute('data-status', 'modified')
  await page.getByTestId('pack-history-open').click()
  await expect(page.getByTestId('pack-history')).toContainText('AI plan, step 1 of 1')
})
