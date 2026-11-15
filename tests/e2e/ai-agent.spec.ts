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
 * Editor agent end to end, against a local fake Ollama server (http://127.0.0.1 needs no key):
 * a French request produces a reviewable plan, a partial apply lands in the editor as one undoable edit.
 */

type MakeFixtureJar = (outPath: string, versionId: string) => Promise<void>

async function makeFixtureJar(outPath: string, versionId: string): Promise<void> {
  const mod = (await import('../../scripts/make-fixture-jar.mjs' as string)) as {
    makeFixtureJar: MakeFixtureJar
  }
  await mod.makeFixtureJar(outPath, versionId)
}

const MODEL = 'qwen3:32b'

/** One NDJSON chat response: optional thinking, text and tool calls, then the final chunk with usage. */
function chatReply(opts: {
  thinking?: string
  text?: string
  toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>
}): string {
  const at = '2026-11-01T10:00:00.000Z'
  const lines: unknown[] = []
  if (opts.thinking) {
    lines.push({
      model: MODEL,
      created_at: at,
      message: { role: 'assistant', content: '', thinking: opts.thinking },
      done: false
    })
  }
  if (opts.toolCalls?.length) {
    lines.push({
      model: MODEL,
      created_at: at,
      message: {
        role: 'assistant',
        content: '',
        tool_calls: opts.toolCalls.map((c, index) => ({
          function: { index, name: c.name, arguments: c.arguments }
        }))
      },
      done: false
    })
  }
  if (opts.text) {
    lines.push({
      model: MODEL,
      created_at: at,
      message: { role: 'assistant', content: opts.text },
      done: false
    })
  }
  lines.push({
    model: MODEL,
    created_at: at,
    message: { role: 'assistant', content: '' },
    done: true,
    done_reason: 'stop',
    prompt_eval_count: 420,
    eval_count: 64
  })
  return lines.map((l) => JSON.stringify(l)).join('\n') + '\n'
}

/** First turn: rotate then paint flames; once tool results come back, a short French reply. */
const chat: RouteHandler = (req, res) => {
  const body = req.body as { messages: Array<{ role: string }> }
  const last = body.messages[body.messages.length - 1]
  const reply =
    last?.role === 'tool'
      ? chatReply({ text: "J'ai tourné la texture et ajouté des flammes au bout." })
      : chatReply({
          thinking: 'Rotation antihoraire de 90°, puis des pixels orange en haut.',
          toolCalls: [
            { name: 'rotate', arguments: { degrees: 90, direction: 'counterclockwise' } },
            {
              name: 'set_pixels',
              arguments: {
                pixels: [
                  { x: 7, y: 0, color: '#ff6a00' },
                  { x: 8, y: 0, color: '#ffd000' }
                ]
              }
            }
          ]
        })
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
  res.end(reply)
}

let launched: LaunchedApp | undefined
let server: FakeProviderServer | undefined

async function setup(): Promise<LaunchedApp> {
  server = await startFakeProviderServer()
  server.on('GET', '/api/tags', jsonFixture('ollama/tags.json'))
  server.on('POST', '/api/show', jsonFixture('ollama/show-qwen3.json'))
  server.on('POST', '/api/chat', chat)

  const first = await launchApp()
  const mc = join(first.root, 'minecraft')
  await mkdir(join(mc, 'versions', '26.3'), { recursive: true })
  await makeFixtureJar(join(mc, 'versions', '26.3', '26.3.jar'), '26.3')
  await first.app.close()

  const settingsPath = join(first.userDataDir, 'settings.json')
  const settings = JSON.parse(await readFile(settingsPath, 'utf8'))
  settings.minecraftPaths = [mc]
  settings.language = 'fr'
  settings.ai = {
    providers: [
      { id: 'local', kind: 'ollama', label: 'Ollama local', baseUrl: server.url, enabled: true }
    ],
    agents: { editor: { model: { providerId: 'local', modelId: MODEL } } }
  }
  await writeFile(settingsPath, JSON.stringify(settings))

  const l = await launchApp({ root: first.root })
  const { page } = l
  if (process.env['AI_E2E_DEBUG']) {
    l.app.process().stdout?.on('data', (d) => console.log('[main]', String(d)))
    l.app.process().stderr?.on('data', (d) => console.log('[main:err]', String(d)))
    page.on('console', (m) => console.log('[renderer]', m.text()))
  }
  await page.getByTestId('open-settings').click()
  const row = page.getByTestId('vanilla-row-26.3')
  await row.getByRole('button').click()
  await expect(row).toContainText('Prêt', { timeout: 30_000 })
  await page.getByTestId('tab-home').click()
  await page.getByTestId('new-pack').click()
  await page.getByTestId('new-pack-name').locator('input').fill('Pack IA')
  await page.getByTestId('new-pack-create').click()
  await expect(page.getByTestId('pack-name')).toHaveText('Pack IA')
  return l
}

async function openTexture(page: Page, name: string): Promise<void> {
  await page.getByTestId('cat-all').click()
  await page.getByTestId('grid-search').locator('input').fill(name)
  await page.getByTestId(`tile-${name}`).first().dblclick()
  await expect(page.getByTestId('editor-name')).toHaveText(name)
}

test.afterEach(async () => {
  if (process.env['AI_E2E_DEBUG']) {
    console.log(
      server?.requests.map((r) => `${r.method} ${r.path} ${JSON.stringify(r.body)?.slice(0, 300)}`)
    )
  }
  if (launched) await cleanup(launched)
  await server?.close()
  launched = undefined
  server = undefined
})

test('a French request becomes a plan; a partial apply is one undoable edit', async () => {
  launched = await setup()
  const { page } = launched
  await openTexture(page, 'stone')

  await page.locator('.side-tabs .n-tabs-tab[data-name="ai"]').click()
  const panel = page.getByTestId('editor-agent')
  await expect(panel).toBeVisible()
  await panel
    .getByTestId('agent-input')
    .locator('textarea')
    .fill('tourne de 90° à gauche et ajoute des flammes au bout')
  await panel.getByTestId('agent-send').click()

  // The plan is described in French, with one row per mutating step.
  const review = panel.getByTestId('proposal-review')
  await expect(review).toBeVisible({ timeout: 15_000 })
  await expect(review.getByTestId('proposal-step-rotate')).toContainText('Rotation 90° antihoraire')
  await expect(review.getByTestId('proposal-step-set_pixels')).toContainText(
    'Modifier des pixels (2)'
  )
  await expect(panel.getByTestId('agent-text')).toContainText('flammes')
  await expect(panel.getByTestId('agent-usage')).toBeVisible()

  // The request reached the provider in French, with the texture image and the tool list.
  const chatReq = server!.requests.find((r) => r.path === '/api/chat')!
  const sent = chatReq.body as {
    messages: Array<{ role: string; content: string; images?: string[] }>
    tools: Array<{ function: { name: string } }>
  }
  const user = sent.messages.find((m) => m.role === 'user')!
  expect(user.content).toContain('tourne de 90° à gauche')
  expect(sent.tools.map((t) => t.function.name)).toContain('rotate')
  // Reasoning is off by default (sent explicitly: thinking models think by default).
  expect((chatReq.body as { think?: unknown }).think).toBe(false)

  // Partial apply: keep the rotation only.
  await review.getByTestId('proposal-step-set_pixels').locator('.n-checkbox').click()
  await review.getByTestId('proposal-apply').click()
  await expect(review).toContainText('Appliqué en partie')
  await expect(page.getByTestId('editor-dirty')).toBeVisible()

  // One undo reverts the whole AI edit.
  await page.locator('.side-tabs .n-tabs-tab[data-name="draw"]').click()
  await page.getByTestId('undo').click()
  await expect(page.getByTestId('editor-dirty')).toHaveCount(0)
  await expect(page.getByTestId('undo')).toBeDisabled()
})

test('rejecting a plan leaves the texture untouched', async () => {
  launched = await setup()
  const { page } = launched
  await openTexture(page, 'stone')
  await page.locator('.side-tabs .n-tabs-tab[data-name="ai"]').click()
  const panel = page.getByTestId('editor-agent')
  // Raise the reasoning level for this tab: the request asks the model to think.
  await panel.getByTestId('agent-reasoning').click()
  await page.locator('.n-base-select-option', { hasText: 'Élevé' }).click()
  await expect(panel.getByTestId('agent-reasoning')).toContainText('Élevé')
  await panel.getByTestId('agent-input').locator('textarea').fill('rotate it to the left')
  await panel.getByTestId('agent-input').locator('textarea').press('Enter')
  const review = panel.getByTestId('proposal-review')
  await expect(review).toBeVisible({ timeout: 15_000 })
  const chatReq = server!.requests.find((r) => r.path === '/api/chat')!
  expect((chatReq.body as { think?: unknown }).think).toBe(true)
  await review.getByTestId('proposal-reject').click()
  await expect(review).toContainText('Refusé')
  await expect(page.getByTestId('editor-dirty')).toHaveCount(0)
})

test('Settings can test a model with the FR/EN phrases', async () => {
  launched = await setup()
  const { page } = launched
  await page.getByTestId('open-settings').click()
  const box = page.getByTestId('model-test')
  await box.scrollIntoViewIfNeeded()
  await box.getByTestId('model-test-quick').click()
  const report = box.getByTestId('model-test-report')
  await expect(report).toBeVisible({ timeout: 30_000 })
  // The fake model always rotates left then paints: the rotation and rotate-and-flames cases pass.
  await expect(box.getByTestId('model-test-rate')).toHaveText('25 %')
  await expect(report).toContainText('Requêtes ratées (12)')
})

test('a long conversation stays inside the window; Up/Down recall earlier messages', async () => {
  launched = await setup()
  const { page, app } = launched
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1100, 700))
  await openTexture(page, 'stone')
  await page.locator('.side-tabs .n-tabs-tab[data-name="ai"]').click()
  const panel = page.getByTestId('editor-agent')
  const input = panel.getByTestId('agent-input').locator('textarea')
  for (const text of ['tourne 1', 'tourne 2', 'tourne 3']) {
    await input.fill(text)
    await panel.getByTestId('agent-send').click()
    await expect(panel.getByTestId('agent-send')).toBeVisible({ timeout: 15_000 })
  }
  await expect(panel.getByTestId('proposal-review')).toHaveCount(3)

  // The page does not scroll: the canvas and the send button stay in view, the messages scroll instead.
  const viewport = await page.evaluate(() => innerHeight)
  const send = (await panel.getByTestId('agent-send').boundingBox())!
  expect(send.y + send.height).toBeLessThanOrEqual(viewport)
  const canvas = (await page.getByTestId('pixel-canvas').boundingBox())!
  expect(canvas.y).toBeGreaterThanOrEqual(0)
  const pageScrolled = await page.evaluate(() =>
    [...document.querySelectorAll('.n-layout-scroll-container')].some((e) => e.scrollTop > 0)
  )
  expect(pageScrolled).toBe(false)

  // Up walks back through sent messages, Down returns to the draft.
  await input.fill('brouillon')
  await input.press('ArrowUp')
  await expect(input).toHaveValue('tourne 3')
  await input.press('ArrowUp')
  await expect(input).toHaveValue('tourne 2')
  await input.press('ArrowDown')
  await expect(input).toHaveValue('tourne 3')
  await input.press('ArrowDown')
  await expect(input).toHaveValue('brouillon')
})
