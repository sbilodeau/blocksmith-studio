/**
 * CHANGELOG.md helpers for the release workflow (see docs/releasing.md).
 *
 * The changelog keeps upcoming changes under a `## Unreleased` heading. A release:
 * - uses the text under that heading as its release notes (`unreleasedNotes`);
 * - turns it into a dated version section (`stampRelease`), leaving an empty `## Unreleased` on top.
 */

const UNRELEASED_RE = /^## Unreleased[ \t]*$/m

/**
 * @param {string} text
 * @returns {string}
 */
function normalize(text) {
  return text.replace(/\r\n?/g, '\n')
}

/**
 * Position of the `## Unreleased` heading line and of the end of its section (next level-2 heading or end of file).
 * @param {string} text normalized changelog
 * @returns {{ headingStart: number, bodyStart: number, end: number }}
 */
function unreleasedRange(text) {
  const match = UNRELEASED_RE.exec(text)
  if (!match) throw new Error('CHANGELOG.md has no "## Unreleased" heading')
  const headingStart = match.index
  const bodyStart = headingStart + match[0].length
  const next = /^## /m.exec(text.slice(bodyStart))
  const end = next ? bodyStart + next.index : text.length
  return { headingStart, bodyStart, end }
}

/**
 * The notes under `## Unreleased`, trimmed ('' when there are none).
 * @param {string} text
 * @returns {string}
 */
export function unreleasedNotes(text) {
  const normalized = normalize(text)
  const { bodyStart, end } = unreleasedRange(normalized)
  return normalized.slice(bodyStart, end).trim()
}

/**
 * Moves the `## Unreleased` notes under a new `## <version> - <date>` heading and leaves `## Unreleased` empty.
 * @param {string} text
 * @param {string} version for example `26.47.0`
 * @param {string} date `YYYY-MM-DD`
 * @returns {string}
 */
export function stampRelease(text, version, date) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Invalid version "${version}"`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Invalid date "${date}"`)
  const normalized = normalize(text)
  if (new RegExp(`^## ${version.replace(/\./g, '\\.')}( |$)`, 'm').test(normalized)) {
    throw new Error(`CHANGELOG.md already has a section for ${version}`)
  }
  const { headingStart, end } = unreleasedRange(normalized)
  const notes = unreleasedNotes(normalized)
  const section = `## Unreleased\n\n## ${version} - ${date}\n\n${notes ? `${notes}\n\n` : ''}`
  return normalized.slice(0, headingStart) + section + normalized.slice(end).replace(/^\n+/, '')
}
