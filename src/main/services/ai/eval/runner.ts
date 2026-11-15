import { readFileSync } from 'fs'
import type { AgentEvent, AgentSettings, ModelRef, ToolCall } from '@shared/ai/types'
import { encodePng } from '@shared/image'
import { emptyBrief } from '@shared/model/brief'
import type { ProviderRegistry } from '../../contracts'
import { runEditorAgent } from '../agent'
import { EvalFileSchema, matchCalls, type EvalCase } from './match'
import { evalFixture, type EvalLanguage, type EvalResult } from './report'

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
  const base = evalFixture(c.fixture)
  const phrase = c[language]
  const settings: AgentSettings = {
    model: opts.model,
    thinking: false,
    maxIterations: opts.maxIterations ?? 3,
    imageMode: 'vision+grid'
  }
  const calls: ToolCall[] = []
  let inputTokens = 0
  let outputTokens = 0
  const emit = (e: AgentEvent): void => {
    if (e.type === 'tool_call') calls.push(e.call)
    if (e.type === 'usage') {
      inputTokens += e.inputTokens ?? 0
      outputTokens += e.outputTokens ?? 0
    }
  }
  const controller = new AbortController()
  const onAbort = (): void => controller.abort()
  opts.signal?.addEventListener('abort', onAbort)
  const started = Date.now()
  try {
    const result = await runEditorAgent(
      {
        runId: newId(),
        request: {
          packId: 'eval',
          message: phrase,
          model: opts.model,
          texture: { path: EVAL_TEXTURE, png: encodePng(base) },
          language
        },
        base,
        settings,
        brief: emptyBrief(),
        vanilla: null,
        history: []
      },
      { providers: opts.providers, newId, now: () => new Date() },
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
