import { formatJson, parseDataPath } from '@shared/datapack'
import type { DataEntry } from '@shared/model/data'
import type { CreationData } from '../agent/creation-data'
import { gatherExplainSources, type ExplainSources } from '../agent/explain'
import type { ToolCall } from '@shared/ai/types'
import type { TextureEntry } from '@shared/model/pack'
import { createImage, drawLine, fillRect, parseHex, type RgbaImage } from '@shared/image'

/**
 * FR/EN evaluation scoring and Markdown report (PLAN 6.8 / 9.4). Pure functions: the runner feeds results in,
 * the CLI, the Vitest `ai-eval` project and Settings > "Test this model" all print the same summary.
 */

export type EvalLanguage = 'fr' | 'en'

export interface EvalResult {
  caseId: string
  language: EvalLanguage
  phrase: string
  pass: boolean
  calls: ToolCall[]
  latencyMs: number
  inputTokens?: number
  outputTokens?: number
  /** Cost of the request in USD, when the provider or the model price tells it. */
  costUsd?: number
  /** Provider or runtime error code when the run failed (counts as a failure). */
  error?: string
}

export interface LanguageScore {
  total: number
  passed: number
  /** 0-100, one decimal. */
  rate: number
}

export interface EvalThresholds {
  /** Minimum overall pass rate (percent). */
  minRate: number
  /** Maximum allowed |FR - EN| gap (percentage points). */
  maxGap: number
}

export const DEFAULT_THRESHOLDS: EvalThresholds = { minRate: 90, maxGap: 10 }

export interface EvalSummary {
  overall: LanguageScore
  fr: LanguageScore
  en: LanguageScore
  /** |FR rate - EN rate| in percentage points. */
  gap: number
  ok: boolean
  thresholds: EvalThresholds
  avgLatencyMs: number
  inputTokens: number
  outputTokens: number
  /** Sum of the known request costs (USD); undefined when no request had a cost. */
  costUsd?: number
}

function score(results: EvalResult[]): LanguageScore {
  const passed = results.filter((r) => r.pass).length
  const rate = results.length ? Math.round((passed / results.length) * 1000) / 10 : 0
  return { total: results.length, passed, rate }
}

export function summarize(
  results: EvalResult[],
  thresholds: EvalThresholds = DEFAULT_THRESHOLDS
): EvalSummary {
  const overall = score(results)
  const fr = score(results.filter((r) => r.language === 'fr'))
  const en = score(results.filter((r) => r.language === 'en'))
  const gap = Math.round(Math.abs(fr.rate - en.rate) * 10) / 10
  const latency = results.reduce((s, r) => s + r.latencyMs, 0)
  return {
    overall,
    fr,
    en,
    gap,
    ok: overall.total > 0 && overall.rate >= thresholds.minRate && gap <= thresholds.maxGap,
    thresholds,
    avgLatencyMs: results.length ? Math.round(latency / results.length) : 0,
    inputTokens: results.reduce((s, r) => s + (r.inputTokens ?? 0), 0),
    outputTokens: results.reduce((s, r) => s + (r.outputTokens ?? 0), 0),
    ...(results.some((r) => r.costUsd !== undefined)
      ? { costUsd: results.reduce((s, r) => s + (r.costUsd ?? 0), 0) }
      : {})
  }
}

function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

function callsLabel(r: EvalResult): string {
  if (r.error) return `error: ${r.error}`
  if (!r.calls.length) return '(no tool call)'
  return r.calls.map((c) => `${c.name}(${JSON.stringify(c.args)})`).join(', ')
}

/** Pads a Markdown table so columns line up in the raw source. */
function table(head: string[], rows: string[][]): string {
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)))
  const line = (cells: string[]): string =>
    `| ${cells.map((c, i) => c.padEnd(widths[i]!)).join(' | ')} |`
  return [
    line(head),
    `| ${widths.map((w) => '-'.repeat(w)).join(' | ')} |`,
    ...rows.map(line)
  ].join('\n')
}

/** Markdown report: summary table, then one row per case with FR / EN results side by side. */
export function toMarkdown(model: string, results: EvalResult[], summary: EvalSummary): string {
  const verdict = summary.ok ? 'PASS' : 'FAIL'
  const t = summary.thresholds
  const out: string[] = [
    `## AI FR/EN evaluation - ${cell(model)}: ${verdict}`,
    '',
    table(
      ['Language', 'Passed', 'Rate'],
      [
        [
          'Overall',
          `${summary.overall.passed}/${summary.overall.total}`,
          `${summary.overall.rate}%`
        ],
        ['French', `${summary.fr.passed}/${summary.fr.total}`, `${summary.fr.rate}%`],
        ['English', `${summary.en.passed}/${summary.en.total}`, `${summary.en.rate}%`]
      ]
    ),
    '',
    `FR-EN gap: ${summary.gap} points (max ${t.maxGap}). Minimum overall rate: ${t.minRate}%.`,
    `Average latency: ${summary.avgLatencyMs} ms. Tokens: ${summary.inputTokens} in, ${summary.outputTokens} out.${
      summary.costUsd !== undefined ? ` Cost: $${summary.costUsd.toFixed(4)}.` : ''
    }`,
    ''
  ]
  const ids = [...new Set(results.map((r) => r.caseId))]
  const rows = ids.map((id) => {
    const fr = results.find((r) => r.caseId === id && r.language === 'fr')
    const en = results.find((r) => r.caseId === id && r.language === 'en')
    const mark = (r?: EvalResult): string => (!r ? '-' : r.pass ? 'ok' : 'FAIL')
    const failed = [fr, en].filter((r): r is EvalResult => !!r && !r.pass)
    return [
      id,
      mark(fr),
      mark(en),
      cell(failed.map((r) => `${r.language}: ${callsLabel(r)}`).join('; '))
    ]
  })
  out.push(table(['Case', 'FR', 'EN', 'Calls when failed'], rows), '')
  return out.join('\n')
}

/**
 * Deterministic fixtures referenced by phrases.json. `sample16`: a 16x16 grey stone-like tile with a dark diagonal
 * stripe and a light top-left corner, so rotations and flips are visible and the palette has a few colors.
 */
export interface EvalSelectionTexture {
  path: string
  image: RgbaImage
}

/**
 * Selection fixtures of navigation cases. `sample_selection`: #1 stone (gray), #2 iron_ore and #3 gold_ore (gray
 * with tan / yellow spots), #4 oak_planks (brown with dark grain lines).
 */
export function evalSelection(name: string): EvalSelectionTexture[] {
  if (name !== 'sample_selection') throw new Error(`unknown eval selection ${name}`)
  const block = (n: string): string => `assets/minecraft/textures/block/${n}.png`
  const stone = createImage(16, 16, parseHex('#7f7f7f'))
  drawLine(stone, { x: 1, y: 12 }, { x: 12, y: 1 }, parseHex('#6b6b6b'))
  const ore = (spot: string): RgbaImage => {
    const img = createImage(16, 16, parseHex('#7f7f7f'))
    for (const [x, y] of [
      [3, 3],
      [10, 5],
      [6, 11],
      [12, 12]
    ] as const) {
      fillRect(img, { x, y, width: 2, height: 2 }, parseHex(spot))
    }
    return img
  }
  const planks = createImage(16, 16, parseHex('#a0784a'))
  for (const y of [3, 7, 11, 15]) drawLine(planks, { x: 0, y }, { x: 15, y }, parseHex('#6b4e2e'))
  return [
    { path: block('stone'), image: stone },
    { path: block('iron_ore'), image: ore('#d8af93') },
    { path: block('gold_ore'), image: ore('#fcee4b') },
    { path: block('oak_planks'), image: planks }
  ]
}

/**
 * Pack fixtures of creation cases. `sample_pack`: the sample_selection blocks (stone, iron_ore and gold_ore in
 * "blocks" and "ores", oak_planks), plus an iron pickaxe ("tools") and a diamond sword ("weapons"), all 16x16.
 */
export function evalPack(name: string): {
  textures: TextureEntry[]
  samples: EvalSelectionTexture[]
  kind?: 'data'
  data?: CreationData
} {
  if (name === 'sample_datapack') return evalDataPack()
  if (name !== 'sample_pack') throw new Error(`unknown eval pack ${name}`)
  const item = (n: string, color: string): EvalSelectionTexture => {
    const img = createImage(16, 16, [0, 0, 0, 0])
    drawLine(img, { x: 3, y: 12 }, { x: 12, y: 3 }, parseHex(color))
    return { path: `assets/minecraft/textures/item/${n}.png`, image: img }
  }
  const samples = [
    ...evalSelection('sample_selection'),
    item('iron_pickaxe', '#d8d8d8'),
    item('diamond_sword', '#4aedd9')
  ]
  const categories: Record<string, string[]> = {
    stone: ['blocks'],
    iron_ore: ['blocks', 'ores'],
    gold_ore: ['blocks', 'ores'],
    oak_planks: ['blocks'],
    iron_pickaxe: ['tools'],
    diamond_sword: ['weapons']
  }
  const textures = samples.map((s): TextureEntry => {
    const m = /textures\/(.+)\/([^/]+)\.png$/.exec(s.path)!
    return {
      path: s.path,
      namespace: 'minecraft',
      folder: m[1]!,
      name: m[2]!,
      width: 16,
      height: 16,
      animated: false,
      status: 'vanilla',
      categories: categories[m[2]!] ?? [],
      url: ''
    }
  })
  return { textures, samples }
}

export function evalFixture(name: string): RgbaImage {
  if (name !== 'sample16') throw new Error(`unknown eval fixture ${name}`)
  const img = createImage(16, 16, parseHex('#7f7f7f'))
  fillRect(img, { x: 0, y: 0, width: 4, height: 4 }, parseHex('#bdbdbd'))
  drawLine(img, { x: 2, y: 13 }, { x: 13, y: 2 }, parseHex('#3a3a3a'))
  fillRect(img, { x: 12, y: 12, width: 2, height: 2 }, parseHex('#5c4a2e'))
  return img
}

/** Vanilla-like data files of the "sample_datapack" eval pack (written for the eval, not copied from Minecraft). */
const EVAL_DATA: Record<string, unknown> = {
  'data/minecraft/recipe/oak_planks.json': {
    type: 'minecraft:crafting_shapeless',
    category: 'building',
    group: 'planks',
    ingredients: ['#minecraft:oak_logs'],
    result: { count: 4, id: 'minecraft:oak_planks' }
  },
  'data/minecraft/loot_table/blocks/diamond_ore.json': {
    type: 'minecraft:block',
    pools: [{ rolls: 1, entries: [{ type: 'minecraft:item', name: 'minecraft:diamond' }] }]
  },
  'data/minecraft/tags/block/base_stone_overworld.json': {
    values: ['minecraft:stone', 'minecraft:granite', 'minecraft:diorite', 'minecraft:andesite']
  }
}

const EVAL_ITEMS = [
  'oak_planks',
  'oak_log',
  'diamond',
  'diamond_ore',
  'stone',
  'saddle',
  'leather',
  'basalt',
  'stick'
]

/** A data pack (no textures) with a few vanilla data files, for creation cases that use write_json. */
function evalDataPack(): {
  textures: TextureEntry[]
  samples: EvalSelectionTexture[]
  kind: 'data'
  data: CreationData
} {
  const entries: DataEntry[] = Object.keys(EVAL_DATA).map((path) => {
    const info = parseDataPath(path)!
    return {
      path,
      namespace: info.namespace,
      kind: info.kind,
      id: info.id,
      ...(info.registry ? { registry: info.registry } : {}),
      status: 'vanilla'
    }
  })
  return {
    textures: [],
    samples: [],
    kind: 'data',
    data: {
      entries,
      ids: {
        items: EVAL_ITEMS.map((i) => `minecraft:${i}`),
        blocks: ['stone', 'granite', 'diorite', 'andesite', 'basalt', 'diamond_ore', 'oak_log'].map(
          (b) => `minecraft:${b}`
        ),
        tags: {
          item: ['minecraft:oak_logs', 'minecraft:planks'],
          block: ['minecraft:base_stone_overworld']
        }
      },
      read: async (path) => (path in EVAL_DATA ? formatJson(EVAL_DATA[path]) : null)
    }
  }
}

/** A file of the sample data pack open in the data editor, for "data" cases (the data agent). */
export async function evalDataFile(path: string): Promise<{
  text: string
  sources: ExplainSources
  entries: DataEntry[]
  read: (path: string) => Promise<string | null>
}> {
  const { data } = evalDataPack()
  if (!(path in EVAL_DATA)) throw new Error(`unknown eval data file ${path}`)
  const text = formatJson(EVAL_DATA[path])
  const sources = await gatherExplainSources(
    { packId: 'eval', path, text },
    {
      meta: async () => ({ name: 'Eval pack', kind: 'data', authoringVersion: '26.3' }),
      vanillaText: async (_, p) => (p in EVAL_DATA ? formatJson(EVAL_DATA[p]) : null),
      packText: async () => null,
      ids: async () => data.ids,
      names: async () => ({}),
      entries: async () => data.entries
    }
  )
  return { text, sources, entries: data.entries, read: data.read }
}
