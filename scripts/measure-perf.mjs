#!/usr/bin/env node
/**
 * Measures the app on a synthetic huge pack (docs/performance.md). Drives the built app with Playwright:
 *
 *   npm run build
 *   node scripts/measure-perf.mjs [--small 10000] [--large 2000] [--animated 50] [--workspace <dir>] [--json]
 *
 * `--workspace` reuses a workspace made by scripts/make-big-pack.mjs (otherwise a temp one is generated and
 * removed). Prints a Markdown table of timings in milliseconds. Each UI timing ends after two animation frames,
 * so it includes Vue's update, layout and paint of the new state.
 */
import { _electron as electron } from '@playwright/test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeBigPack } from './make-big-pack.mjs'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function parseArgs(argv) {
  const out = { small: 10_000, large: 2_000, animated: 50, workspace: undefined, json: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--small') out.small = Number(argv[++i])
    else if (a === '--large') out.large = Number(argv[++i])
    else if (a === '--animated') out.animated = Number(argv[++i])
    else if (a === '--workspace') out.workspace = resolve(argv[++i])
    else if (a === '--json') out.json = true
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
const root = await mkdtemp(join(tmpdir(), 'blocksmith-perf-ui-'))
const workspace = args.workspace ?? join(root, 'workspace')
const userData = join(root, 'userData')
const rows = []
const record = (name, ms) => {
  rows.push([name, ms])
  if (!args.json) console.error(`  ${name}: ${typeof ms === 'number' ? ms.toFixed(1) : ms}`)
}

const pack = await makeBigPack(workspace, {
  small: args.small,
  large: args.large,
  animated: args.animated
})
console.error(
  `pack: ${pack.files} textures, ${(pack.bytes / 2 ** 20).toFixed(0)} MiB at ${pack.folder}`
)

await mkdir(userData, { recursive: true })
await writeFile(
  join(userData, 'settings.json'),
  JSON.stringify({
    schemaVersion: 1,
    workspacePath: workspace,
    minecraftPaths: [],
    updates: { autoCheck: false }
  })
)

const env = {}
for (const [k, v] of Object.entries(process.env)) {
  if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v
}

/** Waits two animation frames in the page (the next paint after a state change). */
const FRAMES = () =>
  new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(undefined))))

let app
try {
  const launchStart = Date.now()
  app = await electron.launch({
    args: [repo],
    env: { ...env, BLOCKSMITH_USER_DATA: userData, NODE_ENV: 'production' }
  })
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1400, height: 900 }).catch(() => undefined)
  await page.waitForSelector(`[data-testid="pack-card-${pack.packId}"]`, { timeout: 120_000 })
  record('launch to pack card visible (packs.list, cold)', Date.now() - launchStart)

  // Open the pack tab (category overview).
  let t = Date.now()
  await page.getByTestId(`pack-open-${pack.packId}`).click()
  await page.waitForSelector('[data-testid="category-overview"] [data-testid^="overview-"]', {
    timeout: 120_000
  })
  record('open pack tab (overview shown)', Date.now() - t)

  // All textures grid (timed in the page: click to the second frame with tiles).
  const openGrid = await page.evaluate(async (frames) => {
    const wait = new Function(`return (${frames})()`)
    const t = performance.now()
    document.querySelector('[data-testid="cat-all"]').click()
    await wait()
    while (!document.querySelector('[data-testid="texture-grid"] [data-path]')) await wait()
    return performance.now() - t
  }, FRAMES.toString())
  record('open "All" grid (first paint)', openGrid)
  const dom = await page.evaluate(() => ({
    tiles: document.querySelectorAll('[data-testid="texture-grid"] [data-path]').length,
    nodes: document.getElementsByTagName('*').length,
    heap: performance.memory ? performance.memory.usedJSHeapSize / 2 ** 20 : NaN
  }))
  record('grid tiles in the DOM', dom.tiles)
  record('DOM elements', dom.nodes)
  record('renderer JS heap (MiB)', dom.heap)

  /** Scrolls through the whole grid, one viewport per frame, and returns frame statistics. */
  const scrollGrid = () =>
    page.evaluate(async () => {
      const el = document.querySelector('[data-testid="texture-grid"]')
      const frames = []
      el.scrollTop = 0
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      let last = performance.now()
      const start = last
      while (el.scrollTop + el.clientHeight < el.scrollHeight - 1) {
        el.scrollTop += el.clientHeight
        await new Promise((r) => requestAnimationFrame(r))
        const now = performance.now()
        frames.push(now - last)
        last = now
      }
      frames.sort((a, b) => a - b)
      return {
        total: performance.now() - start,
        count: frames.length,
        median: frames[Math.floor(frames.length / 2)] ?? 0,
        p95: frames[Math.floor(frames.length * 0.95)] ?? 0,
        max: frames[frames.length - 1] ?? 0
      }
    })
  const setSearch = (q) =>
    page.evaluate(
      ([frames, value]) => {
        const input = document.querySelector('[data-testid="grid-search"] input')
        input.value = value
        input.dispatchEvent(new Event('input', { bubbles: true }))
        return new Function(`return (${frames})()`)()
      },
      [FRAMES.toString(), q]
    )
  const rendererMemory = async () => {
    const metrics = await app.evaluate(({ app: a }) => a.getAppMetrics())
    const renderer = metrics.filter((m) => m.type === 'Tab' || m.type === 'Renderer')
    return renderer.reduce((sum, m) => sum + m.memory.workingSetSize, 0) / 1024
  }

  let scroll = await scrollGrid()
  record(`scroll whole grid (${scroll.count} viewport steps), total`, scroll.total)
  record('scroll frame, median', scroll.median)
  record('scroll frame, p95', scroll.p95)
  record('scroll frame, max', scroll.max)
  record('renderer working set after scrolling (MiB)', await rendererMemory())

  // Only the 512 px textures (thumbnail decoding).
  await setSearch('hd_')
  scroll = await scrollGrid()
  record(`scroll 512 px textures only (${scroll.count} steps), total`, scroll.total)
  record('scroll 512 px frame, median', scroll.median)
  record('scroll 512 px frame, p95', scroll.p95)
  record('scroll 512 px frame, max', scroll.max)
  await setSearch('')

  // Selection: click the first tile, shift-click a tile one viewport further, select all, Escape.
  // Repeated 5 times; the median is recorded.
  const median = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)]
  const runs = []
  for (let run = 0; run < 5; run++) {
    runs.push(
      await page.evaluate(async (frames) => {
        const wait = new Function(`return (${frames})()`)
        const el = document.querySelector('[data-testid="texture-grid"]')
        el.scrollTop = 0
        await wait()
        const click = (tile, init = {}) =>
          tile.dispatchEvent(new MouseEvent('click', { bubbles: true, ...init }))
        const tiles = () => [...el.querySelectorAll('[data-path]')]
        let t = performance.now()
        click(tiles()[0])
        await wait()
        const single = performance.now() - t
        el.scrollTop = el.clientHeight
        await wait()
        const list = tiles()
        t = performance.now()
        click(list[list.length - 1], { shiftKey: true })
        await wait()
        const range = performance.now() - t
        const key = (k, init = {}) =>
          el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...init }))
        t = performance.now()
        key('a', { ctrlKey: true })
        await wait()
        const all = performance.now() - t
        // A ctrl-click with everything selected (copies the whole selection).
        t = performance.now()
        click(tiles()[1], { ctrlKey: true })
        await wait()
        const toggle = performance.now() - t
        t = performance.now()
        key('Escape')
        await wait()
        const clear = performance.now() - t
        return { single, range, all, toggle, clear }
      }, FRAMES.toString())
    )
  }
  const sel = Object.fromEntries(
    Object.keys(runs[0]).map((k) => [k, median(runs.map((r) => r[k]))])
  )
  record('click one tile', sel.single)
  record('shift-click range (one viewport)', sel.range)
  record('select all (Ctrl+A)', sel.all)
  record('ctrl-click with all selected', sel.toggle)
  record('Escape (clear selection)', sel.clear)

  // Search typing, one character at a time.
  const search = await page.evaluate(async (frames) => {
    const wait = new Function(`return (${frames})()`)
    const input = document.querySelector('[data-testid="grid-search"] input')
    const times = []
    for (const q of ['h', 'hd', 'hd_', 'hd_0', 'hd_00', 'hd_000', 'hd_0005', '']) {
      const t = performance.now()
      input.value = q
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await wait()
      times.push(performance.now() - t)
    }
    return times
  }, FRAMES.toString())
  record('search keystroke, first ("h")', search[0])
  record('search keystroke, max', Math.max(...search))
  record('search keystroke, mean', search.reduce((a, b) => a + b, 0) / search.length)

  // Editor on a 512x512 texture.
  const hdName = `hd_${String(args.animated).padStart(5, '0')}`
  await setSearch('hd_')
  t = Date.now()
  await page.getByTestId(`tile-${hdName}`).dblclick()
  await page.waitForSelector('[data-testid="pixel-canvas"]')
  await page.waitForFunction(
    (name) => document.querySelector('[data-testid="editor-name"]')?.textContent?.trim() === name,
    hdName
  )
  await page.evaluate(FRAMES)
  record('open editor on 512x512', Date.now() - t)

  await page.getByTestId('tool-pencil').click()
  const box = await page.getByTestId('pixel-canvas').boundingBox()

  /** Paints a zigzag stroke with the mouse and returns frame statistics recorded in the page. */
  async function stroke(label) {
    await page.evaluate(() => {
      window.__frames = []
      window.__rafOn = true
      let last = performance.now()
      const loop = () => {
        const now = performance.now()
        window.__frames.push(now - last)
        last = now
        if (window.__rafOn) requestAnimationFrame(loop)
      }
      requestAnimationFrame(loop)
    })
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    const start = Date.now()
    await page.mouse.move(cx - 150, cy - 100)
    await page.mouse.down()
    for (let i = 0; i < 60; i++) {
      await page.mouse.move(cx - 150 + i * 5, cy - 100 + (i % 2) * 40)
    }
    await page.mouse.up()
    await page.evaluate(FRAMES)
    const total = Date.now() - start
    const f = await page.evaluate(() => {
      window.__rafOn = false
      const list = window.__frames.slice(1).sort((a, b) => a - b)
      return {
        median: list[Math.floor(list.length / 2)] ?? 0,
        p95: list[Math.floor(list.length * 0.95)] ?? 0,
        max: list[list.length - 1] ?? 0
      }
    })
    record(`paint stroke ${label}, 60 moves total`, total)
    record(`paint stroke ${label}, frame median`, f.median)
    record(`paint stroke ${label}, frame p95`, f.p95)
  }
  await stroke('at fit zoom')
  // Zoom to 32x around the center (the zoom-in button steps through the zoom levels).
  for (let i = 0; i < 20; i++) {
    const z = await page.evaluate(
      () => document.querySelector('[data-testid="editor-status"]')?.textContent ?? ''
    )
    if (/\b(32|40|48|64)\b/.test(z)) break
    await page.getByTestId('zoom-in').click()
  }
  await stroke('at 32x zoom')

  // Back to the grid (scroll restored, last edited tile brought into view).
  // Undo the strokes so leaving does not ask to save, then step 40 textures further with "next".
  for (let i = 0; i < 2; i++) await page.keyboard.press('ControlOrMeta+z')
  await page.waitForSelector('[data-testid="editor-dirty"]', { state: 'detached' })
  for (let i = 0; i < 40; i++) await page.getByTestId('editor-next').click()
  const lastName = (await page.getByTestId('editor-name').textContent())?.trim()
  t = Date.now()
  await page.getByTestId('editor-back').click()
  await page.waitForSelector(`[data-testid="tile-${lastName}"]`)
  await page.evaluate(FRAMES)
  record('editor back to grid', Date.now() - t)

  // Pack Doctor.
  t = Date.now()
  await page.getByTestId('pack-doctor-open').click()
  await page.waitForSelector('[data-testid="doctor-issues"], [data-testid="doctor-ok"]', {
    timeout: 120_000
  })
  record('Pack Doctor (open to result)', Date.now() - t)
  await page.keyboard.press('Escape')
  await page
    .waitForSelector('[data-testid="pack-doctor"]', { state: 'detached' })
    .catch(() => undefined)

  // Export.
  const out = join(root, 'export.zip')
  await app.evaluate(({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p })
  }, out)
  await page.getByTestId('export-open').click()
  t = Date.now()
  await page.getByTestId('export-run').click()
  await page.waitForSelector('[data-testid="report-dialog"]', { timeout: 300_000 })
  record('export (click to report)', Date.now() - t)
} finally {
  await app?.close().catch(() => undefined)
  await rm(root, { recursive: true, force: true })
}

if (args.json) {
  console.log(JSON.stringify(Object.fromEntries(rows), null, 2))
} else {
  const width = Math.max(...rows.map(([k]) => k.length), 9)
  console.log(`| ${'Operation'.padEnd(width)} | Value |`)
  console.log(`| ${'-'.repeat(width)} | ----: |`)
  for (const [k, v] of rows) {
    console.log(
      `| ${k.padEnd(width)} | ${(typeof v === 'number' ? v.toFixed(0) : v).padStart(5)} |`
    )
  }
}
