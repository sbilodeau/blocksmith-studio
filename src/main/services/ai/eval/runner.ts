import { readFileSync } from 'fs'
import type { AgentEvent, AgentSettings, EvalReport, ModelRef, ToolCall } from '@shared/ai/types'
import { encodePng } from '@shared/image'
import { emptyBrief } from '@shared/model/brief'
import type { ProviderRegistry } from '../../contracts'
import {
  runCreationAgent,
  runDataAgent,
  runEditorAgent,
  runItemAgent,
  runNavigationAgent
} from '../agent'
import { EvalFileSchema, matchCalls, type EvalCase } from './match'
import {
  evalDataFile,
  evalFixture,
  evalItem,
  evalPack,
  evalSelection,
  summarize,
  toMarkdown,
  type EvalLanguage,
  type EvalResult
} from './report'
import phrases from '../../../../../resources/data/ai-eval/phrases.json'

/**
 * Runs the FR/EN evaluation cases against a real model through the same runtime as the editor agent: one fresh
 * request per (case, language), no conversation history, an empty style brief, nothing written to disk.
 * The tool calls the model makes (read tools included) are matched against the case expectations.
 */

export interface EvalRunOptions {
  providers: ProviderRegistry
  model: ModelRef
  cases: EvalCase[]
  languages?: EvalLanguage[]
  /** Round trips per request. The expectations are about the first calls, so a small budget is enough. */
  maxIterations?: number
  /** Parallel requests (keep low: cloud providers rate-limit). */
  concurrency?: number
  signal?: AbortSignal
  onResult?: (result: EvalResult, done: number, total: number) => void
}

const EVAL_TEXTURE = 'assets/minecraft/textures/block/eval_sample.png'

export function loadEvalCases(path: string): EvalCase[] {
  return EvalFileSchema.parse(JSON.parse(readFileSync(path, 'utf8'))).cases
}

/** Cases bundled with the app (Settings > "Test this model"). */
export function bundledEvalCases(): EvalCase[] {
  return EvalFileSchema.parse(phrases).cases
}

/** Quick test: one case per family (transform, drawing, color, memory, multi-step, selection). 18 requests. */
export const QUICK_CASE_IDS = [
  'rotate-left-90',
  'flip-horizontal',
  'pixel-top-left-red',
  'fill-quarter',
  'make-redder',
  'darker',
  'remember-theme',
  'rotate-and-flames',
  'nav-ores-darker'
]

/** Runs the cases and builds the report the renderer shows. */
export async function runEvalReport(
  opts: Omit<EvalRunOptions, 'cases'> & { quick: boolean; cases?: EvalCase[] }
): Promise<EvalReport> {
  const all = opts.cases ?? bundledEvalCases()
  const cases = opts.quick ? all.filter((c) => QUICK_CASE_IDS.includes(c.id)) : all
  const results = await runEval({ ...opts, cases })
  return buildEvalReport(opts.model, results, cases.length * (opts.languages?.length ?? 2))
}

/** The renderer / CLI report of one model from its results (`expected`: requests planned). */
export function buildEvalReport(
  model: ModelRef,
  results: EvalResult[],
  expected: number
): EvalReport {
  const summary = summarize(results)
  const stopped = results.length < expected
  return {
    model,
    overall: summary.overall,
    fr: summary.fr,
    en: summary.en,
    gap: summary.gap,
    ok: summary.ok && !stopped,
    avgLatencyMs: summary.avgLatencyMs,
    inputTokens: summary.inputTokens,
    outputTokens: summary.outputTokens,
    ...(summary.costUsd !== undefined ? { costUsd: summary.costUsd } : {}),
    stopped,
    failures: results
      .filter((r) => !r.pass)
      .map((r) => ({
        caseId: r.caseId,
        language: r.language,
        phrase: r.phrase,
        calls: r.calls.map((c) => `${c.name}(${JSON.stringify(c.args)})`).join(', '),
        ...(r.error ? { error: r.error } : {})
      })),
    markdown: toMarkdown(`${model.providerId}/${model.modelId}`, results, summary)
  }
}

/** "provider/model" or just "model" (Ollama Cloud). Model ids may contain ':' and '/'. */
export function parseModelRef(value: string, defaultProvider = 'ollama-cloud'): ModelRef {
  const slash = value.indexOf('/')
  if (slash > 0 && !value.slice(0, slash).includes(':')) {
    return { providerId: value.slice(0, slash), modelId: value.slice(slash + 1) }
  }
  return { providerId: defaultProvider, modelId: value }
}

let seq = 0
const newId = (): string => `eval-${Date.now().toString(36)}-${(seq++).toString(36)}`

export async function runEvalCase(
  c: EvalCase,
  language: EvalLanguage,
  opts: Pick<EvalRunOptions, 'providers' | 'model' | 'maxIterations' | 'signal'>
): Promise<EvalResult> {
  const phrase = c[language]
  const settings: AgentSettings = {
    model: opts.model,
    thinking: 'off',
    maxIterations: opts.maxIterations ?? 3,
    imageMode: 'vision+grid'
  }
  const calls: ToolCall[] = []
  let inputTokens = 0
  let outputTokens = 0
  let costUsd: number | undefined
  const emit = (e: AgentEvent): void => {
    if (e.type === 'tool_call') calls.push(e.call)
    if (e.type === 'usage') {
      inputTokens += e.inputTokens ?? 0
      outputTokens += e.outputTokens ?? 0
      if (e.costUsd !== undefined) costUsd = (costUsd ?? 0) + e.costUsd
    }
  }
  const controller = new AbortController()
  const onAbort = (): void => controller.abort()
  opts.signal?.addEventListener('abort', onAbort)
  const started = Date.now()
  try {
    const deps = { providers: opts.providers, newId, now: () => new Date() }
    const pack = c.context === 'creation' ? evalPack(c.fixture) : undefined
    const dataFile = c.context === 'data' ? await evalDataFile(c.fixture) : undefined
    const itemPage = c.context === 'item' ? await evalItem(c.fixture) : undefined
    const result = itemPage
      ? await runItemAgent(
          {
            runId: newId(),
            request: {
              packId: 'eval',
              id: itemPage.item.id,
              item: { ...itemPage.item },
              message: phrase,
              model: opts.model,
              language
            },
            sources: itemPage.sources,
            readPng: itemPage.readPng,
            data: itemPage.data,
            settings,
            history: []
          },
          deps,
          emit,
          controller.signal
        )
      : dataFile
        ? await runDataAgent(
            {
              runId: newId(),
              request: {
                packId: 'eval',
                message: phrase,
                model: opts.model,
                path: c.fixture,
                text: dataFile.text,
                language
              },
              sources: dataFile.sources,
              entries: dataFile.entries,
              read: dataFile.read,
              settings,
              history: []
            },
            deps,
            emit,
            controller.signal
          )
        : pack
          ? await runCreationAgent(
              {
                runId: newId(),
                request: { packId: 'eval', message: phrase, model: opts.model, language },
                textures: pack.textures,
                samples: pack.samples,
                pack: {
                  name: 'Eval pack',
                  description: '',
                  ...(pack.kind ? { kind: pack.kind } : {})
                },
                ...(pack.data ? { data: pack.data } : {}),
                ...(pack.items ? { items: pack.items } : {}),
                settings,
                brief: emptyBrief(),
                history: []
              },
              deps,
              emit,
              controller.signal
            )
          : c.context === 'navigation'
            ? await runNavigationAgent(
                {
                  runId: newId(),
                  request: {
                    packId: 'eval',
                    message: phrase,
                    model: opts.model,
                    paths: evalSelection(c.fixture).map((t) => t.path),
                    language
                  },
                  textures: evalSelection(c.fixture),
                  settings,
                  brief: emptyBrief(),
                  history: []
                },
                deps,
                emit,
                controller.signal
              )
            : await runEditorAgent(
                {
                  runId: newId(),
                  request: {
                    packId: 'eval',
                    message: phrase,
                    model: opts.model,
                    texture: { path: EVAL_TEXTURE, png: encodePng(evalFixture(c.fixture)) },
                    language
                  },
                  base: evalFixture(c.fixture),
                  settings,
                  brief: emptyBrief(),
                  vanilla: null,
                  history: []
                },
                deps,
                emit,
                controller.signal
              )
    const error = result.reason === 'error' ? (result.error?.code ?? 'ai.agentFailed') : undefined
    return {
      caseId: c.id,
      language,
      phrase,
      pass: !error && matchCalls(calls, c.expect).pass,
      calls,
      latencyMs: Date.now() - started,
      inputTokens,
      outputTokens,
      ...(costUsd !== undefined ? { costUsd } : {}),
      ...(error ? { error } : {})
    }
  } finally {
    opts.signal?.removeEventListener('abort', onAbort)
  }
}

export async function runEval(opts: EvalRunOptions): Promise<EvalResult[]> {
  const languages = opts.languages ?? ['fr', 'en']
  const jobs = opts.cases.flatMap((c) => languages.map((l) => ({ c, l })))
  const results: EvalResult[] = new Array(jobs.length)
  let next = 0
  let done = 0
  const worker = async (): Promise<void> => {
    while (next < jobs.length && !opts.signal?.aborted) {
      const index = next++
      const { c, l } = jobs[index]!
      results[index] = await runEvalCase(c, l, opts)
      done++
      opts.onResult?.(results[index]!, done, jobs.length)
    }
  }
  const n = Math.max(1, Math.min(opts.concurrency ?? 3, jobs.length))
  await Promise.all(Array.from({ length: n }, worker))
  return results.filter(Boolean)
}
