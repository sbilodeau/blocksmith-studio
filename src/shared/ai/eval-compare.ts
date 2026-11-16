import type { EvalReport } from './types'

/**
 * Side-by-side comparison of several FR/EN evaluation reports (PLAN M4): one row per model, best first, and the
 * requests at least one model missed. Pure: used by Settings > "Test models" and the `npm run test:ai` CLI.
 */

export interface ComparisonRow {
  label: string
  report: EvalReport
  /** 1 = best (highest overall rate, then smallest gap, then cheapest, then fastest). */
  rank: number
}

export function modelLabel(r: EvalReport): string {
  return `${r.model.providerId}/${r.model.modelId}`
}

/** Reports ordered best first. */
export function rankReports(reports: readonly EvalReport[]): ComparisonRow[] {
  const cost = (r: EvalReport): number => r.costUsd ?? Number.POSITIVE_INFINITY
  return [...reports]
    .sort(
      (a, b) =>
        b.overall.rate - a.overall.rate ||
        a.gap - b.gap ||
        cost(a) - cost(b) ||
        a.avgLatencyMs - b.avgLatencyMs
    )
    .map((report, i) => ({ label: modelLabel(report), report, rank: i + 1 }))
}

/** Requests ("case (fr)") missed by at least one model, with the models that missed each. */
export function missedRequests(
  reports: readonly EvalReport[]
): Array<{ key: string; caseId: string; language: 'fr' | 'en'; missedBy: string[] }> {
  const map = new Map<string, { caseId: string; language: 'fr' | 'en'; missedBy: string[] }>()
  for (const r of reports) {
    for (const f of r.failures) {
      const key = `${f.caseId} (${f.language})`
      const entry = map.get(key) ?? { caseId: f.caseId, language: f.language, missedBy: [] }
      entry.missedBy.push(modelLabel(r))
      map.set(key, entry)
    }
  }
  return [...map.entries()]
    .map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => b.missedBy.length - a.missedBy.length || a.key.localeCompare(b.key))
}

function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

/** Markdown table with cells padded so columns line up in the raw source. */
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

export function formatCost(costUsd: number | undefined): string {
  if (costUsd === undefined) return '-'
  return `$${costUsd < 0.01 ? costUsd.toFixed(4) : costUsd.toFixed(2)}`
}

export function comparisonMarkdown(reports: readonly EvalReport[]): string {
  const rows = rankReports(reports)
  const out = [
    `## AI FR/EN evaluation - ${reports.length} models compared`,
    '',
    table(
      [
        '#',
        'Model',
        'Overall',
        'French',
        'English',
        'Gap',
        'Latency',
        'Tokens in/out',
        'Cost',
        'Verdict'
      ],
      rows.map(({ rank, label, report: r }) => [
        String(rank),
        cell(label),
        `${r.overall.rate}% (${r.overall.passed}/${r.overall.total})`,
        `${r.fr.rate}%`,
        `${r.en.rate}%`,
        `${r.gap}`,
        `${r.avgLatencyMs} ms`,
        `${r.inputTokens}/${r.outputTokens}`,
        formatCost(r.costUsd),
        r.stopped ? 'stopped' : r.ok ? 'PASS' : 'FAIL'
      ])
    ),
    ''
  ]
  const missed = missedRequests(reports)
  if (missed.length > 0) {
    const labels = rows.map((r) => r.label)
    const stopped = new Set(rows.filter((r) => r.report.stopped).map((r) => r.label))
    out.push(
      '### Missed requests',
      '',
      table(
        ['Request', ...labels.map(cell)],
        missed.map((m) => [
          cell(m.key),
          // A stopped run may not have sent the request at all.
          ...labels.map((l) => (m.missedBy.includes(l) ? 'FAIL' : stopped.has(l) ? '?' : 'ok'))
        ])
      ),
      ''
    )
  }
  return out.join('\n')
}
