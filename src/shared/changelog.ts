/**
 * Reads CHANGELOG.md (bundled into the app at build time) for the "What's new" dialogs. The release workflow turns
 * `## Unreleased` into `## <version> - <date>` before building (see docs/releasing.md).
 */
export interface ChangelogSection {
  /** null for `## Unreleased`. */
  version: string | null
  date?: string
  /** Markdown under the heading, trimmed. */
  body: string
}

const HEADING_RE = /^## (Unreleased|(\d+(?:\.\d+)*))(?: - (\d{4}-\d{2}-\d{2}))?[ \t]*$/

export function parseChangelog(text: string): ChangelogSection[] {
  const sections: ChangelogSection[] = []
  let current: { section: ChangelogSection; lines: string[] } | null = null
  const flush = (): void => {
    if (!current) return
    current.section.body = current.lines.join('\n').trim()
    sections.push(current.section)
  }
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (line.startsWith('## ')) {
      flush()
      const m = HEADING_RE.exec(line)
      current = m
        ? {
            section: { version: m[2] ?? null, ...(m[3] ? { date: m[3] } : {}), body: '' },
            lines: []
          }
        : null
      continue
    }
    current?.lines.push(line)
  }
  flush()
  return sections
}

/** Numeric comparison of dotted versions (`26.47.0` > `26.9.3`); missing parts count as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d < 0 ? -1 : 1
  }
  return 0
}

/**
 * The non-empty sections released after `previous` up to `current`, newest first. Without `previous`, only the
 * section of `current`. A development build (no section for `current`) gets the Unreleased notes.
 */
export function sectionsSince(
  sections: readonly ChangelogSection[],
  previous: string | null,
  current: string
): ChangelogSection[] {
  const released = sections.filter((s) => s.version !== null && s.body)
  const picked = released.filter(
    (s) =>
      compareVersions(s.version!, current) <= 0 &&
      (previous
        ? compareVersions(s.version!, previous) > 0
        : compareVersions(s.version!, current) === 0)
  )
  if (picked.length > 0 || sections.some((s) => s.version === current)) {
    return picked.sort((a, b) => compareVersions(b.version!, a.version!))
  }
  const unreleased = sections.find((s) => s.version === null && s.body)
  return unreleased ? [unreleased] : []
}
