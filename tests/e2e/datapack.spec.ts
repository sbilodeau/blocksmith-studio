import { expect, test, type Page } from '@playwright/test'
import { mkdir, readFile, readdir, stat, writeFile } from 'fs/promises'
import { join } from 'path'
import { strFromU8, unzipSync } from 'fflate'
import { cleanup, launchApp, stubSaveDialog, type LaunchedApp } from './app'
import {
  jsonFixture,
  startFakeProviderServer,
  type FakeProviderServer,
  type RouteHandler
} from '../fixtures/ai/server'

type MakeFixtureJar = (outPath: string, versionId: string) => Promise<void>

let launched: LaunchedApp | undefined
let server: FakeProviderServer | undefined

/** A pack of `kind` on the fixture jar (vanilla data: 2 recipes, a loot table, 2 tags, an advancement). */
async function setup(
  name: string,
  kind: 'resource' | 'data',
  ai?: { url: string; model: string }
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
  if (ai) {
    settings.ai = {
      providers: [
        { id: 'local', kind: 'ollama', label: 'Ollama local', baseUrl: ai.url, enabled: true }
      ],
      agents: { creation: { model: { providerId: 'local', modelId: ai.model } } }
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

const MODEL = 'qwen3:32b'

/** One NDJSON chat response from the fake Ollama server: text and/or tool calls, then the final chunk. */
function ollamaReply(opts: {
  text?: string
  toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>
}): string {
  const at = '2026-11-16T10:00:00.000Z'
  const lines: unknown[] = []
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
    prompt_eval_count: 900,
    eval_count: 20
  })
  return lines.map((l) => JSON.stringify(l)).join('\n') + '\n'
}

async function startServer(chat: RouteHandler): Promise<FakeProviderServer> {
  const s = await startFakeProviderServer()
  s.on('GET', '/api/tags', jsonFixture('ollama/tags.json'))
  s.on('POST', '/api/show', jsonFixture('ollama/show-qwen3.json'))
  s.on('POST', '/api/chat', chat)
  return s
}

test.afterEach(async () => {
  if (launched) await cleanup(launched)
  await server?.close()
  launched = undefined
  server = undefined
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

test('explains an edited vanilla recipe with the AI, comparing it with the original', async () => {
  server = await startServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
    res.end(ollamaReply({ text: '3 stone now make 3 slabs instead of 6.' }))
  })
  const ctx = await setup('Explained', 'data', { url: server.url, model: MODEL })
  launched = ctx.launched
  const { page } = launched
  await page.getByTestId('data-row-minecraft:stone_slab').click()
  await setEditorText(
    page,
    '{"type": "minecraft:crafting_shaped", "pattern": ["###"], "key": {"#": "minecraft:stone"}, "result": {"id": "minecraft:stone_slab", "count": 3}}'
  )
  await page.getByTestId('data-ai-open').click()
  await page.locator('[data-testid="data-ai"] .n-tabs-tab[data-name="explain"]').click()
  const panel = page.getByTestId('data-explain')
  await expect(panel.getByTestId('data-explain-text')).toHaveText(
    '3 stone now make 3 slabs instead of 6.',
    { timeout: 15_000 }
  )
  // The model got the original, the computed change and the unsaved state, without tools.
  const chat = server.requests.find((r) => r.path === '/api/chat')!.body as {
    messages: Array<{ role: string; content: string }>
    tools?: unknown[]
  }
  expect(chat.tools).toBeUndefined()
  expect(chat.messages[0]!.content).toContain('Reply in English')
  const user = chat.messages.find((m) => m.role === 'user')!.content
  expect(user).toContain('ORIGINAL (vanilla 26.3) FILE:')
  expect(user).toContain('- result.count: 6 -> 3')
  expect(user).toContain('The edits are not saved yet')
  // Editing again flags the explanation as out of date.
  await setEditorText(page, '{}')
  await expect(panel.getByTestId('data-explain-stale')).toBeVisible()
})

test('the AI chat proposes a new version of the open file, applied to the editor then saved', async () => {
  const changed = {
    type: 'minecraft:crafting_shaped',
    category: 'building',
    key: { '#': 'minecraft:stone' },
    pattern: ['###'],
    result: { count: 8, id: 'minecraft:stone_slab' }
  }
  server = await startServer((req, res) => {
    const body = req.body as { messages: Array<{ role: string }> }
    const last = body.messages[body.messages.length - 1]
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
    res.end(
      last?.role === 'tool'
        ? ollamaReply({ text: 'Crafting 3 stone now gives 8 slabs.' })
        : ollamaReply({ toolCalls: [{ name: 'edit_file', arguments: { json: changed } }] })
    )
  })
  const ctx = await setup('Chatted', 'data', { url: server.url, model: MODEL })
  launched = ctx.launched
  const { page } = launched
  await page.getByTestId('data-row-minecraft:stone_slab').click()
  await page.getByTestId('data-ai-open').click()
  const panel = page.getByTestId('data-agent')
  await expect(panel.getByTestId('data-agent-file')).toContainText('minecraft:stone_slab')
  await panel.getByTestId('agent-input').locator('textarea').fill('make it give 8 slabs')
  await panel.getByTestId('agent-send').click()

  const review = panel.getByTestId('data-proposal')
  await expect(review).toBeVisible({ timeout: 15_000 })
  await expect(review.getByTestId('data-proposal-changes')).toHaveText('- result.count: 6 -> 8')
  await expect(panel.getByTestId('agent-text')).toContainText('8 slabs')
  // The request carried the open file and the data tools only.
  const sent = server.requests.find((r) => r.path === '/api/chat')!.body as {
    messages: Array<{ role: string; content: string }>
    tools: Array<{ function: { name: string } }>
  }
  expect(sent.tools.map((t) => t.function.name)).toEqual(['edit_file', 'read_json', 'list_data'])
  expect(sent.messages.at(-1)!.content).toContain('File: data/minecraft/recipe/stone_slab.json')

  // Applying puts the text in the editor, unsaved; the user's save writes it.
  await review.getByTestId('data-proposal-apply').click()
  await expect(review.getByTestId('data-proposal-status')).toContainText('Applied to the editor')
  await expect(page.getByTestId('data-dirty')).toBeVisible()
  await page.getByTestId('data-save').click()
  await expect(page.getByTestId('data-dirty')).toHaveCount(0)
  const saved = JSON.parse(
    await readFile(await ctx.packFile('data/minecraft/recipe/stone_slab.json'), 'utf8')
  )
  expect(saved.result).toEqual({ id: 'minecraft:stone_slab', count: 8 })
})
