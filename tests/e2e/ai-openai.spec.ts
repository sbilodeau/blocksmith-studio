import { expect, test } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { cleanup, launchApp, type LaunchedApp } from './app'
import {
  jsonFixture,
  sse,
  startFakeProviderServer,
  type FakeProviderServer,
  type RouteHandler
} from '../fixtures/ai/server'

/**
 * M4 end to end: an OpenAI-compatible provider (a local fake server on 127.0.0.1, so no key) lists its models
 * with estimated prices, runs the editor agent through /v1/chat/completions (SSE, tool call fragments), and the
 * request cost is computed from the price table.
 */

type MakeFixtureJar = (outPath: string, versionId: string) => Promise<void>

async function makeFixtureJar(outPath: string, versionId: string): Promise<void> {
  const mod = (await import('../../scripts/make-fixture-jar.mjs' as string)) as {
    makeFixtureJar: MakeFixtureJar
  }
  await mod.makeFixtureJar(outPath, versionId)
}

const MODEL = 'gpt-4o-mini'

function events(chunks: unknown[]): string {
  return chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n'
}

/** First turn: a rotate call streamed in two fragments; after the tool result, a short reply. */
const chat: RouteHandler = (req, res) => {
  const body = req.body as { messages: Array<{ role: string }> }
  const last = body.messages[body.messages.length - 1]
  const usage = {
    choices: [],
    usage: { prompt_tokens: 100_000, completion_tokens: 10_000 }
  }
  const text =
    last?.role === 'tool'
      ? events([
          {
            choices: [{ index: 0, delta: { content: 'Texture flipped.' }, finish_reason: 'stop' }]
          },
          usage
        ])
      : events([
          {
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call_1',
                      type: 'function',
                      function: { name: 'flip', arguments: '{"axis":' }
                    }
                  ]
                },
                finish_reason: null
              }
            ]
          },
          {
            choices: [
              {
                index: 0,
                delta: { tool_calls: [{ index: 0, function: { arguments: '"horizontal"}' } }] },
                finish_reason: 'tool_calls'
              }
            ]
          },
          usage
        ])
  void sse(text)(req, res)
}

let launched: LaunchedApp | undefined
let server: FakeProviderServer | undefined

test.afterEach(async () => {
  if (launched) await cleanup(launched)
  await server?.close()
  launched = undefined
  server = undefined
})

test('an OpenAI-compatible provider runs the editor agent, with prices and cost', async () => {
  server = await startFakeProviderServer()
  server.on('GET', '/v1/models', jsonFixture('openai/models-openai.json'))
  server.on('POST', '/v1/chat/completions', chat)

  const first = await launchApp()
  const mc = join(first.root, 'minecraft')
  await mkdir(join(mc, 'versions', '26.3'), { recursive: true })
  await makeFixtureJar(join(mc, 'versions', '26.3', '26.3.jar'), '26.3')
  await first.app.close()

  const settingsPath = join(first.userDataDir, 'settings.json')
  const settings = JSON.parse(await readFile(settingsPath, 'utf8'))
  settings.minecraftPaths = [mc]
  settings.ai = {
    providers: [
      {
        id: 'local-oai',
        kind: 'openai-compatible',
        label: 'Local OpenAI',
        baseUrl: `${server.url}/v1`,
        enabled: true
      }
    ],
    agents: { editor: { model: { providerId: 'local-oai', modelId: MODEL } } }
  }
  await writeFile(settingsPath, JSON.stringify(settings))

  launched = await launchApp({ root: first.root })
  const { page } = launched

  // Settings: the models table shows the estimated price; non-chat models are not listed.
  await page.getByTestId('open-settings').click()
  const table = page.getByTestId('model-table')
  await expect(table).toContainText(MODEL, { timeout: 15_000 })
  await expect(table).toContainText('$0.15 in / $0.6 out')
  await expect(table).not.toContainText('whisper')

  const row = page.getByTestId('vanilla-row-26.3')
  await row.getByRole('button').click()
  await expect(row).toContainText('Ready', { timeout: 30_000 })
  await page.getByTestId('tab-home').click()
  await page.getByTestId('new-pack').click()
  await page.getByTestId('new-pack-name').locator('input').fill('OpenAI pack')
  await page.getByTestId('new-pack-create').click()
  await expect(page.getByTestId('pack-name')).toHaveText('OpenAI pack')

  await page.getByTestId('cat-all').click()
  await page.getByTestId('grid-search').locator('input').fill('stone')
  await page.getByTestId('tile-stone').first().dblclick()
  await expect(page.getByTestId('editor-name')).toHaveText('stone')

  await page.locator('.side-tabs .n-tabs-tab[data-name="ai"]').click()
  const panel = page.getByTestId('editor-agent')
  await panel.getByTestId('agent-input').locator('textarea').fill('flip it horizontally')
  await panel.getByTestId('agent-send').click()

  const review = panel.getByTestId('proposal-review')
  await expect(review).toBeVisible({ timeout: 15_000 })
  await expect(review.getByTestId('proposal-step-flip')).toBeVisible()
  await expect(panel.getByTestId('agent-text')).toContainText('Texture flipped.')
  // 100k in + 10k out at $0.15 / $0.60 per million = $0.021 per round trip.
  await expect(panel.getByTestId('agent-usage').last()).toContainText('$0.0')

  // The wire format was OpenAI's: tools as functions, the tool result answered by id.
  const chats = server.requests.filter((r) => r.path === '/v1/chat/completions')
  expect(chats).toHaveLength(2)
  const firstBody = chats[0]!.body as { stream: boolean; tools: Array<{ type: string }> }
  expect(firstBody.stream).toBe(true)
  expect(firstBody.tools[0]!.type).toBe('function')
  const second = chats[1]!.body as { messages: Array<{ role: string; tool_call_id?: string }> }
  expect(second.messages.find((m) => m.role === 'tool')?.tool_call_id).toBe('call_1')
})
